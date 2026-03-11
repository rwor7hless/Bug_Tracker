import { Context } from "telegraf";
import db from "../../db.js";

export async function bumpHandler(ctx: Context) {
  const text = (ctx as any).message?.text as string;
  const arg = text.split(" ")[1]?.trim();

  if (!arg) return ctx.reply("Использование: /bump &lt;тег или ID&gt;\nПример: /bump BUG-001", { parse_mode: "HTML" });

  let ticket: Awaited<ReturnType<typeof db.ticket.findFirst>> = null;

  if (/^[A-Z]{2,4}-\d+$/i.test(arg)) {
    // Tag lookup: BUG-001, CRH-042, etc.
    ticket = await db.ticket.findUnique({ where: { tag: arg.toUpperCase() } });
  } else if (arg.length < 36) {
    // Short UUID prefix
    ticket = await db.ticket.findFirst({ where: { id: { startsWith: arg } } });
  } else {
    ticket = await db.ticket.findUnique({ where: { id: arg } });
  }

  if (!ticket) return ctx.reply("❌ Тикет не найден.");

  const updated = await db.ticket.update({
    where: { id: ticket.id },
    data: { bumpCount: { increment: 1 } },
  });

  const from = ctx.from!;
  const who = from.username ? `@${from.username}` : from.first_name;
  const ticketRef = (ticket as any).tag ?? ticket.id.slice(0, 8);

  return ctx.reply(
    `👆 <b>Bump засчитан!</b>\n\n` +
    `🏷 <code>${ticketRef}</code>\n` +
    `📝 ${ticket.description.slice(0, 80)}${ticket.description.length > 80 ? "…" : ""}\n\n` +
    `👥 Встречали: <b>${updated.bumpCount}</b> раз(а)\n` +
    `✍️ Забампил: ${who}`,
    { parse_mode: "HTML" }
  );
}
