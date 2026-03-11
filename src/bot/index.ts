import { Telegraf, session } from "telegraf";
import db from "../db.js";
import { showMainMenu, reportTextHandler, reportCallbackHandler, reportDocumentHandler, reportPhotoHandler } from "./handlers/report.js";
import { passwordHandler } from "./handlers/password.js";
import { adminHandler, adminPasswordStep, resolveHandler, reopenHandler, adminoutHandler } from "./handlers/admin.js";
import { setBot } from "./botInstance.js";

export function startBot() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.warn("BOT_TOKEN not set, bot disabled");
    return;
  }

  const bot = new Telegraf(token);
  setBot(bot);
  bot.use(session({ defaultSession: () => ({}) }));

  // Check moderator access
  bot.use(async (ctx, next) => {
    const telegramId = String(ctx.from?.id);
    const allowed = await db.moderator.findUnique({ where: { telegramId } });
    if (!allowed) {
      await ctx.reply("Доступ запрещён. Обратитесь к администратору.");
      return;
    }
    return next();
  });

  bot.command("start", showMainMenu);
  bot.command("password", passwordHandler);
  bot.command("admin", adminHandler);
  bot.command("resolve", resolveHandler);
  bot.command("reopen", reopenHandler);
  bot.command("adminout", adminoutHandler);

  // Text: admin password step first, then report FSM
  bot.on("text", async (ctx, next) => {
    const handled = await adminPasswordStep(ctx);
    if (!handled) return next();
  });
  bot.on("text", reportTextHandler as any);

  bot.on("callback_query", reportCallbackHandler as any);
  bot.on("document", reportDocumentHandler as any);
  bot.on("photo", reportPhotoHandler as any);

  bot.launch();
  console.log("Bot started");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
