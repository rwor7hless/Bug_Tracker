import { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import db from "../../db.js";

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { username: string; password: string } }>(
    "/api/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string" },
            password: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body;
      const user = await db.user.findUnique({ where: { username } });
      if (!user) return reply.code(401).send({ error: "Invalid credentials" });

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return reply.code(401).send({ error: "Invalid credentials" });

      const token = app.jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        { expiresIn: "7d" }
      );

      reply
        .setCookie("token", token, {
          httpOnly: true,
          path: "/",
          maxAge: 60 * 60 * 24 * 7,
        })
        .send({ ok: true, role: user.role });
    }
  );

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie("token", { path: "/" }).send({ ok: true });
  });

  app.get("/api/auth/me", async (req, reply) => {
    try {
      await req.jwtVerify();
      return (req as any).user;
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
