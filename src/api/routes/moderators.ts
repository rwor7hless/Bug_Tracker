import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import db from "../../db.js";

export async function moderatorRoutes(app: FastifyInstance) {
  app.get("/api/moderators", { preHandler: requireAuth }, async () => {
    return db.moderator.findMany({ orderBy: { createdAt: "desc" } });
  });

  app.post<{ Body: { telegramId: string; name?: string } }>(
    "/api/moderators",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { telegramId, name } = req.body;
      if (!telegramId) return reply.code(400).send({ error: "telegramId required" });

      const mod = await db.moderator
        .create({ data: { telegramId, name } })
        .catch(() => null);
      if (!mod) return reply.code(409).send({ error: "Already exists" });
      return mod;
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/moderators/:id",
    { preHandler: requireAuth },
    async (req, reply) => {
      await db.moderator.delete({ where: { id: req.params.id } }).catch(() => null);
      return reply.code(204).send();
    }
  );
}
