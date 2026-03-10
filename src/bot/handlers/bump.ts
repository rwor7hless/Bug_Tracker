import { Context } from "telegraf";
import db from "../../db.js";

export async function bumpHandler(ctx: Context) {
  const text = (ctx as any).message?.text as string;
  const arg = text.split(" ")[1]?.trim();

  if (!arg) return ctx.reply("Использование: /bump &lt;id тикета&gt;", { parse_mode: "HTML" });

  // Support short ID (first 8 chars) or full UUID
  const ticket = await db.ticket.findFirst({
    where: arg.length < 36
      ? { id: { startsWith: arg } }
      : { id: arg },
  });

  if (!ticket) return ctx.reply("❌ Тикет не найден.");

  const updated = await db.ticket.update({
    where: { id: ticket.id },
    data: { bumpCount: { increment: 1 } },
  });

  const from = ctx.from!;
  const who = from.username ? `@${from.username}` : from.first_name;

  return ctx.reply(
    `👆 <b>Bump засчитан!</b>\n\n` +
    `🆔 <code>${ticket.id.slice(0, 8)}</code>\n` +
    `📝 ${ticket.description.slice(0, 80)}${ticket.description.length > 80 ? "…" : ""}\n\n` +
    `👥 Встречали: <b>${updated.bumpCount}</b> раз(а)\n` +
    `✍️ Забампил: ${who}`,
    { parse_mode: "HTML" }
  );
}
