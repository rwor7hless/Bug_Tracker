import db from "../src/db.js";
import { embed, vectorToSql } from "../src/embeddings.js";

async function main() {
  const tickets = await db.$queryRawUnsafe<{ id: string; title: string | null; description: string }[]>(
    `SELECT id, title, description FROM "Ticket" WHERE embedding IS NULL`
  );
  console.log(`Found ${tickets.length} tickets without embeddings`);

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    const text = [t.title, t.description].filter(Boolean).join(" ");
    const vec = await embed(text, "passage");
    const vecSql = vectorToSql(vec);
    await db.$executeRawUnsafe(`UPDATE "Ticket" SET embedding = '${vecSql}'::vector WHERE id = '${t.id}'`);
    process.stdout.write(`\r${i + 1}/${tickets.length}`);
  }
  console.log("\nDone.");
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
