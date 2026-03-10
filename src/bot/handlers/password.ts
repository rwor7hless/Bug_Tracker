import { Context } from "telegraf";
import db from "../../db.js";
import bcrypt from "bcrypt";
import crypto from "crypto";

export async function passwordHandler(ctx: Context) {
  const from = ctx.from!;
  // Use TG username or fallback to first_name
  const username = from.username ?? `tg_${from.id}`;

  const newPassword = crypto.randomBytes(8).toString("hex");
  const passwordHash = await bcrypt.hash(newPassword, 10);

  await db.user.upsert({
    where: { username },
    update: { passwordHash },
    create: { username, passwordHash },
  });

  await ctx.reply(
    `<b>Данные для входа на веб-панель:</b>\n\n` +
    `Логин: <code>${username}</code>\n` +
    `Пароль: <code>${newPassword}</code>\n\n` +
    `Пароль одноразовый — при необходимости вызови /password снова.`,
    { parse_mode: "HTML" }
  );
}
