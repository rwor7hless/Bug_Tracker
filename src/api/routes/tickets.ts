import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import db from "../../db.js";
import { embed, vectorToSql } from "../../embeddings.js";

const VALID_STATUSES = ["OPEN", "IN_PROGRESS", "DUPLICATE", "RESOLVED"];

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

export async function ticketRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { status?: string; sort?: string; search?: string };
  }>("/api/tickets", { preHandler: requireAuth }, async (req) => {
    const { status, sort, search } = req.query;

    // If search query provided — use vector similarity search
    if (search?.trim()) {
      const statusFilter = status && VALID_STATUSES.includes(status) ? status : null;

      try {
        const vec = await embed(search.trim(), "query");
        const vecSql = vectorToSql(vec);
        const statusClause = statusFilter ? `AND status = '${statusFilter}'` : "";
        // Return tickets ordered by cosine similarity, threshold 0.55
        const rows = await db.$queryRawUnsafe<any[]>(`
          SELECT *, 1 - (embedding <=> '${vecSql}'::vector) AS _sim
          FROM "Ticket"
          WHERE embedding IS NOT NULL ${statusClause}
            AND 1 - (embedding <=> '${vecSql}'::vector) >= 0.55
          ORDER BY embedding <=> '${vecSql}'::vector
          LIMIT 50
        `);
        // Remove internal _sim field before returning
        return rows.map(({ _sim: _s, ...t }: { _sim: number; [k: string]: unknown }) => t);
      } catch {
        // pgvector not available — fall back to token search
      }

      // Fallback: token OR search
      const STOP_WORDS = new Set(["у", "в", "с", "к", "и", "а", "но", "на", "по", "за", "из", "от", "до", "об", "со", "не", "ни", "то", "же", "ли", "бы"]);
      const tokens = search.trim().toLowerCase().split(/\s+/).filter((t: string) => t.length >= 2 && !STOP_WORDS.has(t));
      const where: any = {};
      if (statusFilter) where.status = statusFilter;
      where.OR = (tokens.length ? tokens : [search]).flatMap((token: string) => [
        { title: { contains: token, mode: "insensitive" } },
        { description: { contains: token, mode: "insensitive" } },
        { crashReport: { contains: token, mode: "insensitive" } },
      ]);
      const orderBy: any = sort === "bumps" ? { bumpCount: "desc" } : { createdAt: "desc" };
      return db.ticket.findMany({ where, orderBy });
    }

    // No search — normal filter
    const where: any = {};
    if (status && VALID_STATUSES.includes(status)) where.status = status;
    const orderBy: any = sort === "bumps" ? { bumpCount: "desc" } : { createdAt: "desc" };
    return db.ticket.findMany({ where, orderBy });
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

  app.post<{ Body: { title?: string; description: string; crashReport?: string; category?: string; reportedBy?: string } }>(
    "/api/tickets",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { title, description, crashReport, category } = req.body;
      const jwtUser = (req as any).user as { username: string } | undefined;
      const reportedBy = req.body.reportedBy || jwtUser?.username || "web";
      if (!description)
        return reply.code(400).send({ error: "description required" });

      const ticket = await db.ticket.create({
        data: { title, description, crashReport, reportedBy, ...(category ? { category: category as any } : {}) },
      });

      // Generate embedding asynchronously
      const embText = [title, description].filter(Boolean).join(" ");
      embed(embText, "passage").then((vec) => {
        const vecSql = vectorToSql(vec);
        db.$executeRawUnsafe(`UPDATE "Ticket" SET embedding = '${vecSql}'::vector WHERE id = '${ticket.id}'`).catch(() => {});
      }).catch(() => {});

      return ticket;
    }
  );

  app.patch<{
    Params: { id: string };
    Body: { status?: string; duplicateOf?: string; resolveComment?: string };
  }>("/api/tickets/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params;
    const { status, duplicateOf, resolveComment } = req.body;

    const data: any = {};
    if (status && VALID_STATUSES.includes(status)) {
      data.status = status;
    }
    if (duplicateOf !== undefined) data.duplicateOf = duplicateOf;
    if (resolveComment !== undefined) data.resolveComment = resolveComment;

    const ticket = await db.ticket.update({ where: { id }, data }).catch(() => null);
    if (!ticket) return reply.code(404).send({ error: "Not found" });

    const ticketTitle = (ticket as any).title || ticket.description.slice(0, 60);
    if (data.status === "RESOLVED") {
      const comment = resolveComment?.trim();
      const resolveMsg =
        `Тикет <code>${id.slice(0, 8)}</code> закрыт.\n\n` +
        `<b>${ticketTitle}</b>` +
        (comment ? `\n\n<b>Комментарий:</b> ${comment}` : "") +
        `\n\nСпасибо за репорт.`;
      await notifyModerators(id, resolveMsg);
    } else if (data.status === "IN_PROGRESS") {
      const inProgressMsg =
        `Тикет <code>${id.slice(0, 8)}</code> взят в работу.\n\n` +
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
      await db.ticket.delete({ where: { id: req.params.id } }).catch(() => null);
      return reply.code(204).send();
    }
  );
}
