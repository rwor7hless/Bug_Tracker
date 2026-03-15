import { Context } from "telegraf";
import db from "../../db.js";
import bcrypt from "bcrypt";
import { getBot } from "../botInstance.js";
import { sendDailyDigest } from "../digest.js";

type AdminSession = {
  isAdmin?: boolean;
  adminStep?: "await_password" | "await_resolve_id" | "await_reopen_id";
  menuMsgId?: number;
  chatId?: number;
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

async function adminSend(ctx: Context, session: AdminSession, text: string, extra?: any) {
  const c = ctx as any;

  const cbMsg = c.callbackQuery?.message;
  const targetChatId: number | undefined = cbMsg?.chat?.id ?? session.chatId;
  const targetMsgId: number | undefined = cbMsg?.message_id ?? session.menuMsgId;

  if (targetChatId && targetMsgId) {
    try {
      await ctx.telegram.editMessageText(targetChatId, targetMsgId, undefined, text, extra);
      session.menuMsgId = targetMsgId;
      session.chatId = targetChatId;
      return;
    } catch (e: any) {
      if (e?.description?.includes("message is not modified")) return;
      await tryDelete(ctx, targetChatId, targetMsgId);
      session.menuMsgId = undefined;
    }
  }

  const chatId = targetChatId ?? c.message?.chat?.id ?? c.chat?.id;
  if (chatId) {
    const msg = await ctx.telegram.sendMessage(chatId, text, extra);
    session.menuMsgId = msg.message_id;
    session.chatId = chatId;
  }
}

async function tryDelete(ctx: Context, chatId: number, messageId: number) {
  try { await ctx.telegram.deleteMessage(chatId, messageId); } catch {}
}

async function showAdminMenu(ctx: Context, session: AdminSession) {
  return adminSend(ctx, session, "🛠 <b>Режим администратора</b>", {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📊 Дайджест", callback_data: "admin_digest" }, { text: "← Выйти", callback_data: "admin_out" }],
      ],
    },
  });
}

export async function adminHandler(ctx: Context) {
  if (!(ctx as any).session) (ctx as any).session = {};
  const session = (ctx as any).session as AdminSession;

  if (session.isAdmin) return showAdminMenu(ctx, session);

  session.adminStep = "await_password";
  return adminSend(ctx, session, "Введи пароль администратора:");
}

// Called from text middleware in index.ts — handles password + ID inputs
export async function adminTextStep(ctx: Context): Promise<boolean> {
  const session = (ctx as any).session as AdminSession;
  if (!session) return false;
  const c = ctx as any;
  const text: string = c.message?.text?.trim() || "";

  // Delete user's message to keep chat clean
  const userMsgId: number | undefined = c.message?.message_id;
  const userChatId: number | undefined = c.message?.chat?.id;
  if (userMsgId && userChatId) {
    tryDelete(ctx, userChatId, userMsgId);
  }

  if (session.adminStep === "await_password") {
    session.adminStep = undefined;

    const adminUser = await db.user.findFirst({ where: { role: "ADMIN" } });
    if (!adminUser || !(await bcrypt.compare(text, adminUser.passwordHash))) {
      await adminSend(ctx, session, "Неверный пароль.");
      return true;
    }

    session.isAdmin = true;
    await showAdminMenu(ctx, session);
    return true;
  }

  if (session.adminStep === "await_resolve_id") {
    session.adminStep = undefined;

    const isTag = /^[A-Z]{2,4}-\d+$/i.test(text);
    const ticket = isTag
      ? await db.ticket.findUnique({ where: { tag: text.toUpperCase() } })
      : await db.ticket.findFirst({
          where: text.length < 36 ? { id: { startsWith: text } } : { id: text },
        });
    if (!ticket) {
      await adminSend(ctx, session, "Тикет не найден.", {
        reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "admin_menu" }]] },
      });
      return true;
    }

    await db.ticket.update({ where: { id: ticket.id }, data: { status: "RESOLVED" } });
    await notifyTicketOwner(
      ticket.id,
      `Тикет <code>${(ticket as any).tag ?? ticket.id.slice(0, 8)}</code> закрыт.\n\n${ticket.description.slice(0, 100)}\n\nСпасибо за репорт.`
    );
    await adminSend(
      ctx, session,
      `Закрыто: <code>${(ticket as any).tag ?? ticket.id.slice(0, 8)}</code> — ${ticket.description.slice(0, 60)}`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Меню", callback_data: "admin_menu" }]] } }
    );
    return true;
  }

  if (session.adminStep === "await_reopen_id") {
    session.adminStep = undefined;

    const isTag = /^[A-Z]{2,4}-\d+$/i.test(text);
    const ticket = isTag
      ? await db.ticket.findUnique({ where: { tag: text.toUpperCase() } })
      : await db.ticket.findFirst({
          where: text.length < 36 ? { id: { startsWith: text } } : { id: text },
        });
    if (!ticket) {
      await adminSend(ctx, session, "Тикет не найден.", {
        reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "admin_menu" }]] },
      });
      return true;
    }

    await db.ticket.update({ where: { id: ticket.id }, data: { status: "OPEN", duplicateOf: null } });
    await adminSend(
      ctx, session,
      `Переоткрыто: <code>${(ticket as any).tag ?? ticket.id.slice(0, 8)}</code> — ${ticket.description.slice(0, 60)}`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Меню", callback_data: "admin_menu" }]] } }
    );
    return true;
  }

  return false;
}

// Called from reportCallbackHandler for admin_ prefixed callbacks
export async function handleAdminCallback(ctx: Context, data: string) {
  const session = (ctx as any).session as AdminSession;

  if (!session?.isAdmin) {
    await adminSend(ctx, session ?? {}, "Только для администраторов. Войди через /admin.");
    return;
  }

  if (data === "admin_menu") {
    await showAdminMenu(ctx, session);
    return;
  }

  if (data === "admin_resolve") {
    session.adminStep = "await_resolve_id";
    await adminSend(ctx, session, "Введи тег или ID тикета для закрытия:", {
      reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "admin_menu" }]] },
    });
    return;
  }

  if (data === "admin_reopen") {
    session.adminStep = "await_reopen_id";
    await adminSend(ctx, session, "Введи тег или ID тикета для переоткрытия:", {
      reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "admin_menu" }]] },
    });
    return;
  }

  if (data === "admin_digest") {
    const bot = getBot();
    if (!bot) { await adminSend(ctx, session, "Бот не инициализирован."); return; }
    try {
      await sendDailyDigest(bot, String(ctx.chat!.id));
    } catch (e) {
      await adminSend(ctx, session, "Ошибка при отправке дайджеста.");
      console.error(e);
    }
    return;
  }

  if (data === "admin_out") {
    session.isAdmin = false;
    session.adminStep = undefined;
    session.menuMsgId = undefined;
    session.chatId = undefined;
    await adminSend(ctx, session, "Вышел из режима администратора.");
    return;
  }
}

// Legacy command handlers (kept for /resolve, /reopen, /adminout commands)
export async function adminPasswordStep(ctx: Context): Promise<boolean> {
  return adminTextStep(ctx);
}

export async function resolveHandler(ctx: Context) {
  if (!(ctx as any).session) (ctx as any).session = {};
  const session = (ctx as any).session as AdminSession;
  if (!session?.isAdmin) return ctx.reply("Только для администраторов. Войди через /admin.");
  session.adminStep = "await_resolve_id";
  return adminSend(ctx, session, "Введи тег или ID тикета для закрытия:");
}

export async function reopenHandler(ctx: Context) {
  if (!(ctx as any).session) (ctx as any).session = {};
  const session = (ctx as any).session as AdminSession;
  if (!session?.isAdmin) return ctx.reply("Только для администраторов. Войди через /admin.");
  session.adminStep = "await_reopen_id";
  return adminSend(ctx, session, "Введи тег или ID тикета для переоткрытия:");
}

export async function adminoutHandler(ctx: Context) {
  if (!(ctx as any).session) (ctx as any).session = {};
  const session = (ctx as any).session as AdminSession;
  if (session) { session.isAdmin = false; session.adminStep = undefined; }
  return ctx.reply("Вышел из режима администратора.");
}
