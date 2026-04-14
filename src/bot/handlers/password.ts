import { Context } from "telegraf";

export async function passwordHandler(ctx: Context) {
  await ctx.reply(
    "🔑 Для получения пароля от веб-панели обратитесь к администратору.",
    { parse_mode: "HTML" }
  );
}
