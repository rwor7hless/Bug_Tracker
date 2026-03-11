import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

import bcrypt from "bcrypt";
import { authRoutes } from "./api/routes/auth.js";
import { ticketRoutes } from "./api/routes/tickets.js";
import { userRoutes } from "./api/routes/users.js";
import { moderatorRoutes } from "./api/routes/moderators.js";
import { startBot } from "./bot/index.js";
import db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "..", "..", "uploads");
await fs.mkdir(uploadsDir, { recursive: true });

// Auto-create/update admin from env
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
if (adminUsername && adminPassword) {
  const hash = await bcrypt.hash(adminPassword, 10);
  await db.user.upsert({
    where: { username: adminUsername },
    update: { passwordHash: hash, role: "ADMIN" },
    create: { username: adminUsername, passwordHash: hash, role: "ADMIN" },
  });
  console.log(`Admin user '${adminUsername}' ready`);
}

const app = Fastify({ logger: true });

await app.register(fastifyCookie);
await app.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || "changeme",
  cookie: { cookieName: "token", signed: false },
});
await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024, files: 10 } });

// API routes
await app.register(authRoutes);
await app.register(ticketRoutes);
await app.register(userRoutes);
await app.register(moderatorRoutes);

// Serve uploads
await app.register(fastifyStatic, { root: uploadsDir, prefix: "/uploads/", decorateReply: false });

// Serve React SPA
const webDistPath = path.join(__dirname, "..", "..", "web", "dist");
await app.register(fastifyStatic, { root: webDistPath, prefix: "/" });

app.setNotFoundHandler((_req, reply) => {
  reply.sendFile("index.html");
});

const port = parseInt(process.env.PORT || "3000");
await app.listen({ port, host: "0.0.0.0" });

startBot();
