import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import crypto from "crypto";

const db = new PrismaClient();

async function main() {
  const username = process.argv[2];
  const reset = process.argv.includes("--reset");

  if (!username) {
    console.error("Usage: npx tsx scripts/create-user.ts <username> [--reset]");
    process.exit(1);
  }

  const password = crypto.randomBytes(8).toString("hex");
  const passwordHash = await bcrypt.hash(password, 10);

  if (reset) {
    const existing = await db.user.findUnique({ where: { username } });
    if (!existing) {
      console.error(`User '${username}' not found`);
      process.exit(1);
    }
    await db.user.update({ where: { username }, data: { passwordHash } });
    console.log(`✅ Password reset for '${username}': ${password}`);
  } else {
    await db.user.create({ data: { username, passwordHash } });
    console.log(`✅ User '${username}' created. Password: ${password}`);
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
