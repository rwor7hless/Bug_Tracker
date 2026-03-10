import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import db from "../../db.js";
import { Status } from "@prisma/client";

async function notifyOwner(ticketId: string, message: string) {
  const { getBot } = await import("../../bot/botInstance.js");
  const bot = getBot();
  if (!bot) return;
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: { telegramId: true } });
  if (!ticket?.telegramId) return;
  bot.telegram.sendMessage(ticket.telegramId, message, { parse_mode: "HTML" }).catch(() => {});
}

export async function ticketRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { status?: string; sort?: string; search?: string };
  }>("/api/tickets", { preHandler: requireAuth }, async (req) => {
    const { status, sort, search } = req.query;

    const where: any = {};
    if (status && Object.values(Status).includes(status as Status)) {
      where.status = status as Status;
    }
    if (search) {
      where.OR = [
        { description: { contains: search, mode: "insensitive" } },
        { crashReport: { contains: search, mode: "insensitive" } },
      ];
    }

    const orderBy: any =
      sort === "bumps" ? { bumpCount: "desc" } : { createdAt: "desc" };

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

    const total = byStatusRaw.reduce((a, b) => a + b._count.id, 0);

    return { total, byStatus, byCategory, recentResolved };
  });

  app.post<{ Body: { description: string; crashReport?: string; category?: string; reportedBy?: string } }>(
    "/api/tickets",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { description, crashReport, category } = req.body;
      const jwtUser = (req as any).user as { username: string } | undefined;
      const reportedBy = req.body.reportedBy || jwtUser?.username || "web";
      if (!description)
        return reply.code(400).send({ error: "description required" });

      return db.ticket.create({
        data: { description, crashReport, reportedBy, ...(category ? { category: category as any } : {}) },
      });
    }
  );

  app.patch<{
    Params: { id: string };
    Body: { status?: string; duplicateOf?: string };
  }>("/api/tickets/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params;
    const { status, duplicateOf } = req.body;

    const data: any = {};
    if (status && Object.values(Status).includes(status as Status)) {
      data.status = status as Status;
    }
    if (duplicateOf !== undefined) data.duplicateOf = duplicateOf;

    const ticket = await db.ticket.update({ where: { id }, data }).catch(() => null);
    if (!ticket) return reply.code(404).send({ error: "Not found" });

    // Notify ticket owner on status change
    if (data.status === "RESOLVED") {
      await notifyOwner(
        id,
        `Тикет <code>${id.slice(0, 8)}</code> закрыт.\n\n` +
        `${ticket.description.slice(0, 100)}\n\n` +
        `Спасибо за репорт.`
      );
    } else if (data.status === "IN_PROGRESS") {
      await notifyOwner(
        id,
        `Тикет <code>${id.slice(0, 8)}</code> взят в работу.\n\n` +
        `${ticket.description.slice(0, 100)}`
      );
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
