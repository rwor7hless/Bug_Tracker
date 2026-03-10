import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import db from "../../db.js";
import bcrypt from "bcrypt";
import crypto from "crypto";

export async function userRoutes(app: FastifyInstance) {
  app.get("/api/users", { preHandler: requireAuth }, async () => {
    return db.user.findMany({
      select: { id: true, username: true, role: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  });

  app.post<{ Body: { username: string } }>(
    "/api/users",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { username } = req.body;
      if (!username) return reply.code(400).send({ error: "username required" });

      const password = crypto.randomBytes(8).toString("hex");
      const passwordHash = await bcrypt.hash(password, 10);

      const user = await db.user
        .create({ data: { username, passwordHash } })
        .catch(() => null);
      if (!user) return reply.code(409).send({ error: "Username already exists" });

      return { id: user.id, username: user.username, password };
    }
  );
}
