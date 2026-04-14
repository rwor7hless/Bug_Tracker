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

      const caller = (req as any).user;
      if (caller?.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });

      const password = crypto.randomBytes(8).toString("hex");
      const passwordHash = await bcrypt.hash(password, 10);

      const user = await db.user
        .create({ data: { username, passwordHash } })
        .catch(() => null);
      if (!user) return reply.code(409).send({ error: "Username already exists" });

      return { id: user.id, username: user.username, password };
    }
  );

  app.patch<{ Params: { id: string }; Body: { password: string } }>(
    "/api/users/:id/password",
    { preHandler: requireAuth },
    async (req, reply) => {
      const caller = (req as any).user;
      if (caller?.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });

      const { password } = req.body;
      if (!password || password.length < 6)
        return reply.code(400).send({ error: "Пароль должен быть не менее 6 символов" });

      const passwordHash = await bcrypt.hash(password, 10);
      const updated = await db.user
        .update({ where: { id: req.params.id }, data: { passwordHash } })
        .catch(() => null);
      if (!updated) return reply.code(404).send({ error: "User not found" });

      return { ok: true };
    }
  );

  // Bulk-reset passwords for all MODERATOR users (admin only)
  app.post(
    "/api/users/bulk-reset",
    { preHandler: requireAuth },
    async (req, reply) => {
      const caller = (req as any).user;
      if (caller?.role !== "ADMIN") return reply.code(403).send({ error: "Forbidden" });

      const moderators = await db.user.findMany({ where: { role: "MODERATOR" } });
      const results: { id: string; username: string; password: string }[] = [];

      for (const u of moderators) {
        const password = crypto.randomBytes(8).toString("hex");
        const passwordHash = await bcrypt.hash(password, 10);
        await db.user.update({ where: { id: u.id }, data: { passwordHash } });
        results.push({ id: u.id, username: u.username, password });
      }

      return results;
    }
  );

  // Self-service password change (any authenticated user)
  app.patch<{ Body: { oldPassword: string; newPassword: string } }>(
    "/api/users/me/password",
    { preHandler: requireAuth },
    async (req, reply) => {
      const caller = (req as any).user;
      const { oldPassword, newPassword } = req.body;

      if (!oldPassword || !newPassword)
        return reply.code(400).send({ error: "Заполните все поля" });
      if (newPassword.length < 6)
        return reply.code(400).send({ error: "Новый пароль должен быть не менее 6 символов" });

      const user = await db.user.findUnique({ where: { id: caller.id } });
      if (!user) return reply.code(404).send({ error: "User not found" });

      const valid = await bcrypt.compare(oldPassword, user.passwordHash);
      if (!valid) return reply.code(400).send({ error: "Неверный текущий пароль" });

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await db.user.update({ where: { id: user.id }, data: { passwordHash } });

      return { ok: true };
    }
  );
}
