import { Context } from "telegraf";
import db from "../../db.js";
import bcrypt from "bcrypt";
import crypto from "crypto";

export async function passwordHandler(ctx: Context) {
  const from = ctx.from!;
  const username = from.username ?? `tg_${from.id}`;

  const newPassword = crypto.randomBytes(8).toString("hex");
  const passwordHash = await bcrypt.hash(newPassword, 10);

  await db.user.upsert({
    where: { username },
    update: { passwordHash },
    create: { username, passwordHash },
  });

  const c = ctx as any;
  const s = c.session ?? {};
  const text =
    `🔑 <b>Данные для входа:</b>\n\n` +
    `Логин: <code>${username}</code>\n` +
    `Пароль: <code>${newPassword}</code>\n\n` +
    `<i>Пароль одноразовый — при следующем входе запроси снова.</i>`;
  const extra = {
    parse_mode: "HTML" as const,
    reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "menu_back" }]] },
  };

  // Try to edit the existing menu message; fall back to sending new
  const cbMsg = c.callbackQuery?.message;
  const targetChatId: number | undefined = cbMsg?.chat?.id ?? s.chatId;
  const targetMsgId: number | undefined = cbMsg?.message_id ?? s.menuMsgId;

  if (targetChatId && targetMsgId) {
    try {
      await ctx.telegram.editMessageText(targetChatId, targetMsgId, undefined, text, extra);
      s.menuMsgId = targetMsgId;
      s.chatId = targetChatId;
      return;
    } catch (e: any) {
      if (e?.description?.includes("message is not modified")) return;
      try { await ctx.telegram.deleteMessage(targetChatId, targetMsgId); } catch {}
      s.menuMsgId = undefined;
    }
  }

  const chatId = targetChatId ?? c.message?.chat?.id ?? c.chat?.id;
  if (chatId) {
    const msg = await ctx.telegram.sendMessage(chatId, text, extra);
    s.menuMsgId = msg.message_id;
    s.chatId = chatId;
  }
}
