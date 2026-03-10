import { Context } from "telegraf";
import db from "../../db.js";
import bcrypt from "bcrypt";
import { getBot } from "../botInstance.js";
import { sendDailyDigest } from "../digest.js";

type AdminSession = {
  isAdmin?: boolean;
  adminStep?: "await_password" | "await_resolve_id" | "await_reopen_id";
};

export async function notifyTicketOwner(ticketId: string, message: string) {
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: { telegramId: true } });
  if (!ticket?.telegramId) return;
  const bot = getBot();
  if (!bot) return;
  try {
    await bot.telegram.sendMessage(ticket.telegramId, message, { parse_mode: "HTML" });
  } catch (e) {
    console.error("Failed to notify ticket owner:", e);
  }
}

async function showAdminMenu(ctx: Context) {
  return ctx.reply(
    "Меню администратора:",
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Закрыть тикет",      callback_data: "admin_resolve" },
            { text: "Переоткрыть тикет",  callback_data: "admin_reopen" },
          ],
          [{ text: "Дайджест", callback_data: "admin_digest" }],
          [{ text: "Выйти",    callback_data: "admin_out" }],
        ],
      },
    }
  );
}

export async function adminHandler(ctx: Context) {
  const session = (ctx as any).session as AdminSession;
  if (!session) (ctx as any).session = {};

  if ((ctx as any).session.isAdmin) return showAdminMenu(ctx);

  (ctx as any).session.adminStep = "await_password";
  return ctx.reply("Введи пароль администратора:");
}

// Called from text middleware in index.ts — handles password + ID inputs
export async function adminTextStep(ctx: Context): Promise<boolean> {
  const session = (ctx as any).session as AdminSession;
  if (!session) return false;
  const text: string = (ctx as any).message?.text?.trim() || "";

  if (session.adminStep === "await_password") {
    session.adminStep = undefined;

    const adminUser = await db.user.findFirst({ where: { role: "ADMIN" } });
    if (!adminUser || !(await bcrypt.compare(text, adminUser.passwordHash))) {
      await ctx.reply("Неверный пароль.");
      return true;
    }

    session.isAdmin = true;
    await showAdminMenu(ctx);
    return true;
  }

  if (session.adminStep === "await_resolve_id") {
    session.adminStep = undefined;

    const ticket = await db.ticket.findFirst({
      where: text.length < 36 ? { id: { startsWith: text } } : { id: text },
    });
    if (!ticket) {
      await ctx.reply("Тикет не найден.");
      await showAdminMenu(ctx);
      return true;
    }

    await db.ticket.update({ where: { id: ticket.id }, data: { status: "RESOLVED" } });
    await notifyTicketOwner(
      ticket.id,
      `Тикет <code>${ticket.id.slice(0, 8)}</code> закрыт.\n\n${ticket.description.slice(0, 100)}\n\nСпасибо за репорт.`
    );
    await ctx.reply(`Закрыто: <code>${ticket.id.slice(0, 8)}</code> — ${ticket.description.slice(0, 60)}`, { parse_mode: "HTML" });
    await showAdminMenu(ctx);
    return true;
  }

  if (session.adminStep === "await_reopen_id") {
    session.adminStep = undefined;

    const ticket = await db.ticket.findFirst({
      where: text.length < 36 ? { id: { startsWith: text } } : { id: text },
    });
    if (!ticket) {
      await ctx.reply("Тикет не найден.");
      await showAdminMenu(ctx);
      return true;
    }

    await db.ticket.update({ where: { id: ticket.id }, data: { status: "OPEN", duplicateOf: null } });
    await ctx.reply(`Переоткрыто: <code>${ticket.id.slice(0, 8)}</code> — ${ticket.description.slice(0, 60)}`, { parse_mode: "HTML" });
    await showAdminMenu(ctx);
    return true;
  }

  return false;
}

// Called from reportCallbackHandler for admin_ prefixed callbacks
export async function handleAdminCallback(ctx: Context, data: string) {
  const session = (ctx as any).session as AdminSession;

  if (!session?.isAdmin) {
    await ctx.reply("Только для администраторов. Войди через /admin.");
    return;
  }

  if (data === "admin_menu") {
    await showAdminMenu(ctx);
    return;
  }

  if (data === "admin_resolve") {
    session.adminStep = "await_resolve_id";
    await ctx.reply("Введи ID тикета для закрытия:", {
      reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "admin_menu" }]] },
    });
    return;
  }

  if (data === "admin_reopen") {
    session.adminStep = "await_reopen_id";
    await ctx.reply("Введи ID тикета для переоткрытия:", {
      reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "admin_menu" }]] },
    });
    return;
  }

  if (data === "admin_digest") {
    const bot = getBot();
    if (!bot) { await ctx.reply("Бот не инициализирован."); return; }
    try {
      await sendDailyDigest(bot, String(ctx.chat!.id));
    } catch (e) {
      await ctx.reply("Ошибка при отправке дайджеста.");
      console.error(e);
    }
    return;
  }

  if (data === "admin_out") {
    session.isAdmin = false;
    session.adminStep = undefined;
    await ctx.reply("Вышел из режима администратора.");
    return;
  }
}

// Legacy command handlers (kept for /resolve, /reopen, /adminout commands)
export async function adminPasswordStep(ctx: Context): Promise<boolean> {
  return adminTextStep(ctx);
}

export async function resolveHandler(ctx: Context) {
  const session = (ctx as any).session as AdminSession;
  if (!session?.isAdmin) return ctx.reply("Только для администраторов. Войди через /admin.");
  session.adminStep = "await_resolve_id";
  return ctx.reply("Введи ID тикета для закрытия:");
}

export async function reopenHandler(ctx: Context) {
  const session = (ctx as any).session as AdminSession;
  if (!session?.isAdmin) return ctx.reply("Только для администраторов. Войди через /admin.");
  session.adminStep = "await_reopen_id";
  return ctx.reply("Введи ID тикета для переоткрытия:");
}

export async function adminoutHandler(ctx: Context) {
  const session = (ctx as any).session as AdminSession;
  if (session) { session.isAdmin = false; session.adminStep = undefined; }
  return ctx.reply("Вышел из режима администратора.");
}
