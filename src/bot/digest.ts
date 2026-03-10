import { Telegraf } from "telegraf";
import db from "../db.js";
import { formatCategory } from "./categorize.js";

export async function sendDailyDigest(bot: Telegraf, chatId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [newTickets, statusGroups] = await Promise.all([
    db.ticket.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { bumpCount: "desc" },
      take: 20,
    }),
    db.ticket.groupBy({ by: ["status"], _count: { id: true } }),
  ]);

  const topBumped = await db.ticket.findMany({
    where: { status: { in: ["OPEN", "IN_PROGRESS"] as any[] } },
    orderBy: { bumpCount: "desc" },
    take: 5,
  });

  const statusMap: Record<string, number> = {};
  for (const s of statusGroups) statusMap[s.status] = s._count.id;

  let msg = "<b>Дайджест</b> · " + new Date().toLocaleDateString("ru-RU") + "\n\n";

  msg += `Открыто: ${statusMap["OPEN"] ?? 0}  В работе: ${statusMap["IN_PROGRESS"] ?? 0}  Решено: ${statusMap["RESOLVED"] ?? 0}  Дубл.: ${statusMap["DUPLICATE"] ?? 0}\n\n`;

  if (newTickets.length) {
    msg += `<b>Новые за 24ч (${newTickets.length}):</b>\n`;
    for (const t of newTickets.slice(0, 10)) {
      msg += `  <code>${t.id.slice(0, 8)}</code> ${formatCategory(t.category as any)} bumps:${t.bumpCount} — ${t.description.slice(0, 55)}\n`;
    }
    if (newTickets.length > 10) msg += `  … ещё ${newTickets.length - 10}\n`;
    msg += "\n";
  } else {
    msg += "Новых тикетов за 24ч нет.\n\n";
  }

  if (topBumped.length) {
    msg += "<b>Топ по bumps:</b>\n";
    for (const t of topBumped) {
      const mark = (t.status as string) === "IN_PROGRESS" ? " [в работе]" : "";
      msg += `  <code>${t.id.slice(0, 8)}</code>${mark} bumps:${t.bumpCount} — ${t.description.slice(0, 50)}\n`;
    }
  }

  await bot.telegram.sendMessage(chatId, msg, { parse_mode: "HTML" });
}
