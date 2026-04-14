import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import db from "../../db.js";
import bcrypt from "bcrypt";
import crypto from "crypto";

export async function moderatorRoutes(app: FastifyInstance) {
  // List all moderators (Users with role MODERATOR)
  app.get("/api/moderators", { preHandler: requireAuth }, async () => {
    return db.user.findMany({
      where: { role: "MODERATOR" },
      select: { id: true, username: true, telegramId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  });

  // Create moderator: web-panel account + optional Telegram ID
  app.post<{ Body: { username: string; telegramId?: string } }>(
    "/api/moderators",
    { preHandler: requireAuth },
    async (req, reply) => {
      const caller = (req as any).user;
      if (caller?.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });

      const { username, telegramId } = req.body;
      if (!username) return reply.code(400).send({ error: "username required" });

      const password = crypto.randomBytes(8).toString("hex");
      const passwordHash = await bcrypt.hash(password, 10);

      const user = await db.user
        .create({
          data: {
            username,
            passwordHash,
            role: "MODERATOR",
            telegramId: telegramId || null,
          },
        })
        .catch(() => null);

      if (!user) return reply.code(409).send({ error: "Логин или Telegram ID уже занят" });

      return { id: user.id, username: user.username, telegramId: user.telegramId, password };
    }
  );

  // Update telegramId for a moderator
  app.patch<{ Params: { id: string }; Body: { telegramId: string | null } }>(
    "/api/moderators/:id/telegram",
    { preHandler: requireAuth },
    async (req, reply) => {
      const caller = (req as any).user;
      if (caller?.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });

      const updated = await db.user
        .update({
          where: { id: req.params.id },
          data: { telegramId: req.body.telegramId || null },
          select: { id: true, username: true, telegramId: true },
        })
        .catch(() => null);

      if (!updated) return reply.code(404).send({ error: "Not found" });
      return updated;
    }
  );

  // Delete moderator
  app.delete<{ Params: { id: string } }>(
    "/api/moderators/:id",
    { preHandler: requireAuth },
    async (req, reply) => {
      const caller = (req as any).user;
      if (caller?.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });

      await db.user.delete({ where: { id: req.params.id } }).catch(() => null);
      return reply.code(204).send();
    }
  );
}
