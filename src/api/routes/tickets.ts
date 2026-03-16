import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import db from "../../db.js";
import { embed, vectorToSql } from "../../embeddings.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getUploadDir(): string {
  return path.join(__dirname, "..", "..", "..", "..", "uploads");
}

const VALID_STATUSES = ["OPEN", "IN_PROGRESS", "DUPLICATE", "RESOLVED"];
const VALID_CATEGORIES = ["CRASH", "LAG", "VISUAL", "GAMEPLAY", "OTHER", "SUGGESTION"];
const VALID_URGENCIES = ["NORMAL", "HIGH", "CRITICAL"];

// --- Tag helpers ---
const CATEGORY_PREFIX: Record<string, string> = {
  CRASH:      "CRH",
  LAG:        "LAG",
  VISUAL:     "VIS",
  GAMEPLAY:   "GME",
  OTHER:      "BUG",
  SUGGESTION: "SUG",
};
const TAG_PREFIXES = new Set(Object.values(CATEGORY_PREFIX));

function formatTag(prefix: string, num: number): string {
  return `${prefix}-${num <= 999 ? String(num).padStart(3, "0") : num}`;
}

async function assignTag(ticketId: string, category: string): Promise<string> {
  const prefix = CATEGORY_PREFIX[category] ?? "BUG";
  const last = await db.ticket.findFirst({
    where: { tag: { startsWith: prefix + "-" } },
    orderBy: { tagNumber: "desc" },
    select: { tagNumber: true },
  });
  const nextNum = (last?.tagNumber ?? 0) + 1;
  const tag = formatTag(prefix, nextNum);
  await db.ticket.update({ where: { id: ticketId }, data: { tag, tagNumber: nextNum } });
  return tag;
}

/** Resolve a user-supplied identifier (tag like BUG-001, short UUID, or full UUID) to a full ticket id. */
async function resolveTicketId(ref: string): Promise<string | null> {
  if (/^[A-Z]{2,4}-\d+$/i.test(ref)) {
    const t = await db.ticket.findUnique({ where: { tag: ref.toUpperCase() }, select: { id: true } });
    return t?.id ?? null;
  }
  if (ref.length < 36) {
    const t = await db.ticket.findFirst({ where: { id: { startsWith: ref } }, select: { id: true } });
    return t?.id ?? null;
  }
  return ref;
}

async function notifyModerators(ticketId: string, message: string, excludeTelegramId?: string | null) {
  const { getBot } = await import("../../bot/botInstance.js");
  const bot = getBot();
  if (!bot) return;
  const moderators = await db.moderator.findMany({ select: { telegramId: true } });
  for (const mod of moderators) {
    if (excludeTelegramId && mod.telegramId === excludeTelegramId) continue;
    bot.telegram.sendMessage(mod.telegramId, message, { parse_mode: "HTML" }).catch(() => {});
  }
}

const PHOTO_INCLUDE = { photos: { orderBy: { order: "asc" as const } } };

export async function ticketRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { text: string; category?: string } }>(
    "/api/tickets/similar",
    { preHandler: requireAuth },
    async (req) => {
      const { text, category } = req.query;
      if (!text?.trim()) return [];
      try {
        const vec = await embed(text.trim(), "query");
        const vecSql = vectorToSql(vec);
        const categoryClause = category && VALID_CATEGORIES.includes(category)
          ? `AND category = '${category}'`
          : "";
        const rows = await db.$queryRawUnsafe<Array<{ id: string; similarity: number }>>(`
          SELECT id, 1 - (embedding <=> '${vecSql}'::vector) AS similarity
          FROM "Ticket"
          WHERE status IN ('OPEN', 'IN_PROGRESS')
            AND embedding IS NOT NULL
            ${categoryClause}
          ORDER BY embedding <=> '${vecSql}'::vector
          LIMIT 5
        `);
        const ids = rows.filter(r => r.similarity >= 0.75).map(r => r.id);
        if (!ids.length) return [];
        return db.ticket.findMany({ where: { id: { in: ids } }, orderBy: { bumpCount: "desc" } });
      } catch {
        return [];
      }
    }
  );

  app.get<{
    Querystring: { status?: string; sort?: string; search?: string; category?: string };
  }>("/api/tickets", { preHandler: requireAuth }, async (req) => {
    const { status, sort, search, category } = req.query;
    const categoryFilter = category && VALID_CATEGORIES.includes(category) ? category : null;

    if (search?.trim()) {
      const statusFilter = status && VALID_STATUSES.includes(status) ? status : null;
      const orderBy: any = sort === "bumps" ? { bumpCount: "desc" } : { createdAt: "desc" };

      // Tag search: matches "CRH-", "BUG-001", "LAG-12", etc.
      const tagSearch = search.trim().match(/^([A-Z]{2,4})-(\d*)$/i);
      if (tagSearch && TAG_PREFIXES.has(tagSearch[1].toUpperCase())) {
        const prefix = tagSearch[1].toUpperCase();
        const num = tagSearch[2];
        const tagQuery = num ? `${prefix}-${num}` : `${prefix}-`;
        const where: any = { tag: { startsWith: tagQuery } };
        if (statusFilter) where.status = statusFilter;
        if (categoryFilter) where.category = categoryFilter;
        return db.ticket.findMany({ where, orderBy, include: PHOTO_INCLUDE });
      }

      // Vector similarity search (threshold 0.65)
      try {
        const vec = await embed(search.trim(), "query");
        const vecSql = vectorToSql(vec);
        const statusClause = statusFilter ? `AND status = '${statusFilter}'` : "";
        const categoryClause = categoryFilter ? `AND category = '${categoryFilter}'` : "";
        const rows = await db.$queryRawUnsafe<any[]>(`
          SELECT id, 1 - (embedding <=> '${vecSql}'::vector) AS _sim
          FROM "Ticket"
          WHERE embedding IS NOT NULL ${statusClause} ${categoryClause}
            AND 1 - (embedding <=> '${vecSql}'::vector) >= 0.65
          ORDER BY embedding <=> '${vecSql}'::vector
          LIMIT 50
        `);
        const ids: string[] = rows.map((r) => r.id);
        if (ids.length) {
          const tickets = await db.ticket.findMany({
            where: { id: { in: ids } },
            include: PHOTO_INCLUDE,
          });
          // Re-order by original similarity order
          const byId = Object.fromEntries(tickets.map((t) => [t.id, t]));
          return ids.map((id) => byId[id]).filter(Boolean);
        }
        return [];
      } catch {
        // pgvector not available — fall back to token search
      }

      // Fallback: token OR search on title/description
      const STOP_WORDS = new Set(["у", "в", "с", "к", "и", "а", "но", "на", "по", "за", "из", "от", "до", "об", "со", "не", "ни", "то", "же", "ли", "бы"]);
      const tokens = search.trim().toLowerCase().split(/\s+/).filter((t: string) => t.length >= 2 && !STOP_WORDS.has(t));
      const where: any = {};
      if (statusFilter) where.status = statusFilter;
      if (categoryFilter) where.category = categoryFilter;
      where.OR = (tokens.length ? tokens : [search]).flatMap((token: string) => [
        { title: { contains: token, mode: "insensitive" } },
        { description: { contains: token, mode: "insensitive" } },
        { crashReport: { contains: token, mode: "insensitive" } },
      ]);
      return db.ticket.findMany({ where, orderBy, include: PHOTO_INCLUDE });
    }

    // No search — normal filter
    const where: any = {};
    if (status && VALID_STATUSES.includes(status)) where.status = status;
    if (categoryFilter) where.category = categoryFilter;
    const orderBy: any = sort === "bumps" ? { bumpCount: "desc" } : { createdAt: "desc" };
    return db.ticket.findMany({ where, orderBy, include: PHOTO_INCLUDE });
  });

  app.get("/api/stats", { preHandler: requireAuth }, async () => {
    const [byStatusRaw, byCategoryRaw, recentResolved] = await Promise.all([
      db.ticket.groupBy({ by: ["status"], _count: { id: true } }),
      db.ticket.groupBy({ by: ["category"], _count: { id: true } }),
      db.ticket.count({
        where: {
          status: "RESOLVED",
          updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const s of byStatusRaw) byStatus[s.status] = s._count.id;

    const byCategory: Record<string, number> = {};
    for (const c of byCategoryRaw) byCategory[c.category] = c._count.id;

    const total = byStatusRaw.reduce((a: number, b: any) => a + b._count.id, 0);

    return { total, byStatus, byCategory, recentResolved };
  });

  app.post<{ Body: { title: string; description?: string; crashReport?: string; category?: string; reportedBy?: string } }>(
    "/api/tickets",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { title, description, crashReport, category } = req.body;
      const jwtUser = (req as any).user as { username: string } | undefined;
      const reportedBy = req.body.reportedBy || jwtUser?.username || "web";
      if (!title) return reply.code(400).send({ error: "title required" });

      const cat = (category as any) || "OTHER";
      const ticket = await db.ticket.create({
        data: { title, description: description ?? "", crashReport, reportedBy, category: cat },
        include: PHOTO_INCLUDE,
      });

      // Assign tag synchronously (fast DB op)
      const tag = await assignTag(ticket.id, cat).catch(() => null);

      // Generate embedding asynchronously
      const embText = [title, description].filter(Boolean).join(" ") || title;
      embed(embText, "passage").then((vec) => {
        const vecSql = vectorToSql(vec);
        db.$executeRawUnsafe(`UPDATE "Ticket" SET embedding = '${vecSql}'::vector WHERE id = '${ticket.id}'`).catch(() => {});
      }).catch(() => {});

      return { ...ticket, tag };
    }
  );

  app.patch<{
    Params: { id: string };
    Body: {
      status?: string; duplicateOf?: string; resolveComment?: string;
      title?: string; description?: string; crashReport?: string;
      category?: string; urgency?: string;
    };
  }>("/api/tickets/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params;
    const { status, duplicateOf, resolveComment, title, description, crashReport, category, urgency } = req.body;
    const jwtUser = (req as any).user as { id: string; username: string; role: string };

    // Resolve duplicateOf: accept tag (BUG-001), short UUID, or full UUID
    let resolvedDuplicateOf: string | undefined | null = duplicateOf;
    if (duplicateOf) {
      const resolved = await resolveTicketId(duplicateOf);
      resolvedDuplicateOf = resolved ?? duplicateOf;
    }

    const existing = await db.ticket.findUnique({ where: { id }, select: { reportedBy: true } });
    if (!existing) return reply.code(404).send({ error: "Not found" });

    // Moderators can only edit their own tickets
    const isAdmin = jwtUser.role === "ADMIN";
    const isOwner = existing.reportedBy === jwtUser.username;
    if (!isAdmin && !isOwner && (title !== undefined || description !== undefined || crashReport !== undefined || category || urgency)) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const data: any = {};
    // Status changes — admin only
    if (isAdmin) {
      if (status && VALID_STATUSES.includes(status)) data.status = status;
      if (duplicateOf !== undefined) data.duplicateOf = resolvedDuplicateOf;
      if (resolveComment !== undefined) data.resolveComment = resolveComment;
    }
    // Content fields — admin or ticket owner
    if (isAdmin || isOwner) {
      if (title !== undefined) data.title = title;
      if (description !== undefined) data.description = description;
      if (crashReport !== undefined) data.crashReport = crashReport;
      if (category && VALID_CATEGORIES.includes(category)) data.category = category;
      if (urgency && VALID_URGENCIES.includes(urgency)) data.urgency = urgency;
    }

    const ticket = await db.ticket.update({ where: { id }, data }).catch(() => null);
    if (!ticket) return reply.code(404).send({ error: "Not found" });

    // Regenerate embedding if title or description changed
    if (title !== undefined || description !== undefined) {
      const updatedTicket = ticket as any;
      const embText = [updatedTicket.title, updatedTicket.description].filter(Boolean).join(" ");
      embed(embText, "passage").then((vec) => {
        const vecSql = vectorToSql(vec);
        db.$executeRawUnsafe(`UPDATE "Ticket" SET embedding = '${vecSql}'::vector WHERE id = '${id}'`).catch(() => {});
      }).catch(() => {});
    }

    // Bump original when marking as duplicate
    if (data.status === "DUPLICATE" && resolvedDuplicateOf) {
      await db.ticket.update({
        where: { id: resolvedDuplicateOf },
        data: { bumpCount: { increment: 1 } },
      }).catch(() => {});
    }

    const ticketTitle = (ticket as any).title || ticket.description.slice(0, 60);
    if (data.status === "RESOLVED") {
      const comment = resolveComment?.trim();
      const resolveMsg =
        `Тикет <code>${(ticket as any).tag ?? id.slice(0, 8)}</code> закрыт.\n\n` +
        `<b>${ticketTitle}</b>` +
        (comment ? `\n\n<b>Комментарий:</b> ${comment}` : "") +
        `\n\nСпасибо за репорт.`;
      await notifyModerators(id, resolveMsg);
    } else if (data.status === "IN_PROGRESS") {
      const inProgressMsg =
        `Тикет <code>${(ticket as any).tag ?? id.slice(0, 8)}</code> взят в работу.\n\n` +
        `<b>${ticketTitle}</b>`;
      await notifyModerators(id, inProgressMsg);
    }

    return ticket;
  });

  app.post<{ Params: { id: string } }>(
    "/api/tickets/:id/bump",
    { preHandler: requireAuth },
    async (req, reply) => {
      const ticket = await db.ticket
        .update({
          where: { id: req.params.id },
          data: { bumpCount: { increment: 1 } },
        })
        .catch(() => null);
      if (!ticket) return reply.code(404).send({ error: "Not found" });
      return ticket;
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/tickets/:id",
    { preHandler: requireAuth },
    async (req, reply) => {
      const ticket = await db.ticket.findUnique({
        where: { id: req.params.id },
        include: { photos: true },
      });
      if (ticket) {
        const uploadDir = getUploadDir();
        for (const photo of ticket.photos) {
          await fs.unlink(path.join(uploadDir, photo.filename)).catch(() => {});
        }
        await db.ticket.delete({ where: { id: req.params.id } });
      }
      return reply.code(204).send();
    }
  );

  // --- Photo upload ---
  app.post<{ Params: { id: string } }>(
    "/api/tickets/:id/photos",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { id } = req.params;
      const ticket = await db.ticket.findUnique({ where: { id }, select: { id: true } });
      if (!ticket) return reply.code(404).send({ error: "Not found" });

      const uploadDir = getUploadDir();
      await fs.mkdir(uploadDir, { recursive: true });

      const parts = (req as any).files();
      const created: any[] = [];
      let order = await db.ticketPhoto.count({ where: { ticketId: id } });

      for await (const part of parts) {
        if (created.length >= 10) { part.resume(); continue; }
        const ext = path.extname(part.filename || ".jpg").toLowerCase() || ".jpg";
        const filename = `${id}-${Date.now()}-${order}${ext}`;
        const filepath = path.join(uploadDir, filename);
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        await fs.writeFile(filepath, Buffer.concat(chunks));
        const photo = await db.ticketPhoto.create({ data: { ticketId: id, filename, order } });
        created.push(photo);
        order++;
      }

      return { photos: created };
    }
  );

  // --- Delete single photo ---
  app.delete<{ Params: { id: string; photoId: string } }>(
    "/api/tickets/:id/photos/:photoId",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { photoId } = req.params;
      const photo = await db.ticketPhoto.findUnique({ where: { id: photoId } });
      if (!photo) return reply.code(404).send({ error: "Not found" });
      const uploadDir = getUploadDir();
      await fs.unlink(path.join(uploadDir, photo.filename)).catch(() => {});
      await db.ticketPhoto.delete({ where: { id: photoId } });
      return reply.code(204).send();
    }
  );

  // --- Comments ---
  app.get<{ Params: { id: string } }>(
    "/api/tickets/:id/comments",
    { preHandler: requireAuth },
    async (req, reply) => {
      const ticket = await db.ticket.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!ticket) return reply.code(404).send({ error: "Not found" });
      return db.ticketComment.findMany({
        where: { ticketId: req.params.id },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { username: true, role: true } } },
      });
    }
  );

  app.post<{ Params: { id: string }; Body: { body: string } }>(
    "/api/tickets/:id/comments",
    { preHandler: requireAuth },
    async (req, reply) => {
      const jwtUser = (req as any).user as { id: string; username: string; role: string };
      const { body } = req.body;
      if (!body?.trim()) return reply.code(400).send({ error: "body required" });

      const ticket = await db.ticket.findUnique({
        where: { id: req.params.id },
        select: { id: true, tag: true, title: true, description: true, telegramId: true, reportedBy: true },
      });
      if (!ticket) return reply.code(404).send({ error: "Not found" });

      const comment = await db.ticketComment.create({
        data: { ticketId: ticket.id, userId: jwtUser.id, body: body.trim() },
        include: { user: { select: { username: true, role: true } } },
      });

      // Notify ticket reporter via Telegram when admin posts a comment
      if (jwtUser.role === "ADMIN") {
        let recipientTelegramId: string | null = (ticket as any).telegramId ?? null;
        if (!recipientTelegramId) {
          const reporter = await (db.user.findUnique as any)({
            where: { username: (ticket as any).reportedBy },
            select: { telegramId: true },
          });
          recipientTelegramId = reporter?.telegramId ?? null;
        }
        if (recipientTelegramId) {
          const { getBot } = await import("../../bot/botInstance.js");
          const bot = getBot();
          const ticketRef = (ticket as any).tag ?? ticket.id.slice(0, 8);
          const ticketTitle = ticket.title || ticket.description.slice(0, 60);
          bot?.telegram.sendMessage(
            recipientTelegramId,
            `💬 Комментарий разработчика к тикету <code>${ticketRef}</code>\n<b>${ticketTitle}</b>\n\n${body.trim()}`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
      }

      return comment;
    }
  );
}
