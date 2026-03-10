import { Context } from "telegraf";
import db from "../../db.js";
import { formatCategory } from "../categorize.js";
import { embed, vectorToSql } from "../../embeddings.js";

type Step =
  | "category"
  | "title"
  | "description"
  | "crash_prompt"
  | "crash_type"
  | "crash_link"
  | "crash_text"
  | "crash_file"
  | "bump_id"
  | "similar_check";

type Session = {
  step?: Step;
  title?: string;
  description?: string;
  category?: string;
  pendingCrashReport?: string;
  similarIds?: string[];
};

const CATS = [
  { label: "Краш",     value: "CRASH" },
  { label: "Лаги",     value: "LAG" },
  { label: "Визуал",   value: "VISUAL" },
  { label: "Геймплей", value: "GAMEPLAY" },
  { label: "Другое",   value: "OTHER" },
];

function catKb() {
  return {
    inline_keyboard: [
      CATS.slice(0, 2).map(c => ({ text: c.label, callback_data: "cat_" + c.value })),
      CATS.slice(2, 4).map(c => ({ text: c.label, callback_data: "cat_" + c.value })),
      [{ text: CATS[4].label, callback_data: "cat_" + CATS[4].value }],
      [{ text: "Назад", callback_data: "menu_back" }],
    ],
  };
}

// --- Vector duplicate detection ---
async function findSimilar(text: string, category: string) {
  try {
    const vec = await embed(text, "query");
    const vecSql = vectorToSql(vec);
    const rows = await db.$queryRawUnsafe<Array<{ id: string; similarity: number }>>(`
      SELECT id, 1 - (embedding <=> '${vecSql}'::vector) AS similarity
      FROM "Ticket"
      WHERE status IN ('OPEN', 'IN_PROGRESS')
        AND category = '${category}'
        AND embedding IS NOT NULL
      ORDER BY embedding <=> '${vecSql}'::vector
      LIMIT 5
    `);
    const ids = rows.filter((r) => r.similarity >= 0.75).map((r) => r.id);
    if (!ids.length) return [];
    return db.ticket.findMany({ where: { id: { in: ids } }, orderBy: { bumpCount: "desc" } });
  } catch {
    return [];
  }
}

// --- Session helpers ---
function clearSession(s: Session) {
  s.step = undefined;
  s.title = undefined;
  s.description = undefined;
  s.category = undefined;
  s.pendingCrashReport = undefined;
  s.similarIds = undefined;
}

async function checkSimilarAndProceed(ctx: Context, s: Session) {
  const similar = await findSimilar(s.title ? s.title + " " + s.description! : s.description!, s.category!);

  if (!similar.length) {
    await submitTicket(ctx, s.title, s.description!, s.category!, s.pendingCrashReport);
    clearSession(s);
    return;
  }

  s.similarIds = similar.map((t) => t.id);
  s.step = "similar_check";

  const lines = similar.map((t, i) => {
    const statusMark = t.status === "IN_PROGRESS" ? " [в работе]" : "";
    const label = (t as any).title || t.description.slice(0, 60);
    const desc = label.length > 70 ? label.slice(0, 70) + "…" : label;
    return `${i + 1}.${statusMark} <code>${t.id.slice(0, 8)}</code> bumps: ${t.bumpCount}\n   ${desc}`;
  });

  const buttons = similar.map((t, i) => {
    const label = (t as any).title || t.description.slice(0, 28);
    return [{ text: `${i + 1}. ${label.slice(0, 30)}`, callback_data: `similar_bump_${t.id}` }];
  });
  buttons.push([{ text: "Подходящих нет — создать новый", callback_data: "similar_none" }]);
  buttons.push([{ text: "Отмена", callback_data: "menu_back" }]);

  await ctx.reply(
    "<b>Найдены похожие тикеты:</b>\n\n" +
      lines.join("\n\n") +
      "\n\n<i>Выбери похожий, чтобы добавить bump, или создай новый:</i>",
    {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    }
  );
}

// --- Main menu ---
export async function showMainMenu(ctx: Context) {
  const c = ctx as any;
  if (!c.session) c.session = {};
  const s = c.session as Session;
  clearSession(s);
  return ctx.reply(
    "<b>Bug Report</b>\n\nЧто хочешь сделать?",
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Создать баг-репорт", callback_data: "menu_report" }],
          [{ text: "Список открытых багов", callback_data: "menu_list" }],
          [{ text: "Мои тикеты", callback_data: "menu_mytickets" }],
          [{ text: "Bump тикета", callback_data: "menu_bump" }],
          [{ text: "Пароль для панели", callback_data: "menu_password" }],
        ],
      },
    }
  );
}

// --- Text handler ---
export async function reportTextHandler(ctx: Context): Promise<boolean> {
  const c = ctx as any;
  if (!c.session) c.session = {};
  const s = c.session as Session;
  const text: string = c.message?.text?.trim() || "";

  if (s.step === "title") {
    if (text.length > 100) {
      await ctx.reply("Название слишком длинное. Максимум 100 символов. Попробуй ещё раз:");
      return true;
    }
    s.title = text;
    s.step = "description";
    await ctx.reply("Название принято.\n\nТеперь опиши баг подробно: что произошло, как воспроизвести:", {
      reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "menu_back" }]] },
    });
    return true;
  }

  if (s.step === "description") {
    s.description = text;
    s.step = "crash_prompt";
    await ctx.reply("Описание принято.\n\nЕсть лог / краш-репорт?", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Да", callback_data: "crash_yes" }, { text: "Нет", callback_data: "crash_no" }],
          [{ text: "Отмена", callback_data: "menu_back" }],
        ],
      },
    });
    return true;
  }

  if (s.step === "crash_link") {
    if (!text.startsWith("http")) {
      await ctx.reply("Укажи корректную ссылку (начинается с http):");
      return true;
    }
    s.pendingCrashReport = text;
    await checkSimilarAndProceed(ctx, s);
    return true;
  }

  if (s.step === "crash_text") {
    s.pendingCrashReport = text;
    await checkSimilarAndProceed(ctx, s);
    return true;
  }

  if (s.step === "bump_id") {
    const ticket = await db.ticket.findFirst({
      where: text.length < 36 ? { id: { startsWith: text } } : { id: text },
    });
    if (!ticket) {
      await ctx.reply("Тикет не найден.", {
        reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "menu_back" }]] },
      });
      return true;
    }
    const updated = await db.ticket.update({ where: { id: ticket.id }, data: { bumpCount: { increment: 1 } } });
    const from = ctx.from!;
    const who = from.username ? "@" + from.username : from.first_name;
    s.step = undefined;
    await ctx.reply(
      "Bump засчитан.\n\n" +
        "ID: <code>" + ticket.id.slice(0, 8) + "</code>\n" +
        ticket.description.slice(0, 80) + (ticket.description.length > 80 ? "…" : "") + "\n\n" +
        "Встречали: <b>" + updated.bumpCount + "</b> раз(а) · " + who,
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "menu_back" }]] },
      }
    );
    return true;
  }

  return false;
}

// --- Callback handler ---
export async function reportCallbackHandler(ctx: Context) {
  const c = ctx as any;
  const data: string = c.callbackQuery?.data || "";
  if (!c.session) c.session = {};
  const s = c.session as Session;
  await ctx.answerCbQuery();

  // Delegate admin_ callbacks
  if (data.startsWith("admin_")) {
    const { handleAdminCallback } = await import("./admin.js");
    await handleAdminCallback(ctx, data);
    return;
  }

  if (data === "menu_back") return showMainMenu(ctx);

  if (data === "menu_report") {
    s.step = "category"; s.description = undefined; s.category = undefined;
    return ctx.reply("<b>Новый баг-репорт</b>\n\nВыбери категорию:", { parse_mode: "HTML", reply_markup: catKb() });
  }

  if (data === "menu_list") {
    const tickets = await db.ticket.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] as any[] } },
      orderBy: { bumpCount: "desc" },
    });
    if (!tickets.length) {
      await ctx.reply("Открытых тикетов нет.", {
        reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "menu_back" }]] },
      });
      return;
    }

    // Group by category, already sorted by bumps
    const CAT_ORDER = ["CRASH", "LAG", "VISUAL", "GAMEPLAY", "OTHER"];
    const groups: Record<string, typeof tickets> = {};
    for (const t of tickets) {
      if (!groups[t.category]) groups[t.category] = [];
      groups[t.category].push(t);
    }

    const sections: string[] = [];
    for (const cat of CAT_ORDER) {
      const list = groups[cat];
      if (!list?.length) continue;
      const header = formatCategory(cat as any);
      const rows = list.map((t) => {
        const mark = (t.status as string) === "IN_PROGRESS" ? " [в работе]" : "";
        const label = (t as any).title || t.description.slice(0, 50);
        const text = label.length > 50 ? label.slice(0, 50) + "…" : label;
        return `  <code>${t.id.slice(0, 8)}</code>${mark} bumps:${t.bumpCount} — ${text}`;
      });
      sections.push(`<b>${header}</b>\n` + rows.join("\n"));
    }

    return ctx.reply("<b>Открытые баги:</b>\n\n" + sections.join("\n\n"), {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "menu_back" }]] },
    });
  }

  if (data === "menu_mytickets") {
    const telegramId = String(ctx.from?.id);
    const tickets = await db.ticket.findMany({
      where: { telegramId },
      orderBy: { createdAt: "desc" },
      take: 15,
    });
    if (!tickets.length) {
      await ctx.reply("У тебя пока нет тикетов.", {
        reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "menu_back" }]] },
      });
      return;
    }
    const statusLabel: Record<string, string> = {
      OPEN: "[открыт]",
      IN_PROGRESS: "[в работе]",
      RESOLVED: "[решён]",
      DUPLICATE: "[дубликат]",
    };
    const lines = tickets.map((t) => {
      const st = statusLabel[t.status] ?? t.status;
      const label = (t as any).title || t.description.slice(0, 55);
      const text = label.length > 55 ? label.slice(0, 55) + "…" : label;
      return `${st} <code>${t.id.slice(0, 8)}</code> bumps: ${t.bumpCount}\n   ${text}`;
    });
    return ctx.reply("<b>Мои тикеты:</b>\n\n" + lines.join("\n\n"), {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "menu_back" }]] },
    });
  }

  if (data === "menu_bump") {
    s.step = "bump_id";
    return ctx.reply("Введи ID тикета (первые 8 символов):", {
      reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "menu_back" }]] },
    });
  }

  if (data === "menu_password") {
    const { passwordHandler } = await import("./password.js");
    return passwordHandler(ctx);
  }

  if (data.startsWith("cat_") && s.step === "category") {
    const cat = data.slice(4);
    s.category = cat; s.step = "title";
    const catLabel = CATS.find(c => c.value === cat)?.label ?? cat;
    return ctx.reply(catLabel + "\n\nВведи краткое название бага (до 100 символов):", {
      reply_markup: { inline_keyboard: [[{ text: "К категориям", callback_data: "menu_report" }]] },
    });
  }

  if (data === "crash_yes" && s.step === "crash_prompt") {
    s.step = "crash_type";
    return ctx.reply("Как прикрепить лог?", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Ссылка (mclo.gs)", callback_data: "log_link" }, { text: "Текст", callback_data: "log_text" }],
          [{ text: "Файл (.log / .txt)", callback_data: "log_file" }],
          [{ text: "Отмена", callback_data: "menu_back" }],
        ],
      },
    });
  }

  if (data === "crash_no" && s.step === "crash_prompt") {
    s.pendingCrashReport = undefined;
    await checkSimilarAndProceed(ctx, s);
    return;
  }

  if (data === "log_link") { s.step = "crash_link"; return ctx.reply("Вставь ссылку на лог:"); }
  if (data === "log_text") { s.step = "crash_text"; return ctx.reply("Вставь текст лога:"); }
  if (data === "log_file") { s.step = "crash_file"; return ctx.reply("Отправь файл (.log или .txt):"); }

  // --- Similar tickets ---
  if (data.startsWith("similar_bump_") && s.step === "similar_check") {
    const ticketId = data.slice("similar_bump_".length);
    const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      await ctx.reply("Тикет не найден.");
      return showMainMenu(ctx);
    }
    const updated = await db.ticket.update({ where: { id: ticketId }, data: { bumpCount: { increment: 1 } } });
    clearSession(s);
    const from = ctx.from!;
    const who = from.username ? "@" + from.username : from.first_name;
    return ctx.reply(
      "Bump добавлен похожему тикету.\n\n" +
        "ID: <code>" + ticket.id.slice(0, 8) + "</code>\n" +
        ticket.description.slice(0, 80) + "\n\n" +
        "Встречали: <b>" + updated.bumpCount + "</b> раз(а) · " + who,
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "menu_back" }]] },
      }
    );
  }

  if (data === "similar_none" && s.step === "similar_check") {
    const title = s.title;
    const desc = s.description!;
    const cat = s.category!;
    const crash = s.pendingCrashReport;
    clearSession(s);
    await submitTicket(ctx, title, desc, cat, crash);
    return;
  }
}

// --- Document handler ---
export async function reportDocumentHandler(ctx: Context) {
  const c = ctx as any;
  if (!c.session) c.session = {};
  const s = c.session as Session;
  if (s.step !== "crash_file") return;
  const doc = c.message?.document;
  if (!doc) return;
  const fileId = doc.file_id;
  const fileName = doc.file_name ?? "log";
  try {
    const fileUrl = await ctx.telegram.getFileLink(fileId);
    const res = await fetch(fileUrl.href);
    const content = await res.text();
    if (content.length > 50000) return ctx.reply("Файл слишком большой. Используй ссылку.");
    s.pendingCrashReport = content;
  } catch {
    s.pendingCrashReport = "[Файл: " + fileName + ", id: " + fileId + "]";
  }
  await checkSimilarAndProceed(ctx, s);
}

// --- Submit ---
async function submitTicket(ctx: Context, title: string | undefined, description: string, category: string, crashReport?: string) {
  const from = ctx.from!;
  const reportedBy = from.username ? "@" + from.username : from.first_name;
  const telegramId = String(from.id);
  const ticket = await db.ticket.create({
    data: { title, description, crashReport, reportedBy, category: category as any, telegramId },
  });
  // Generate and store embedding asynchronously (don't block reply)
  const embText = [title, description].filter(Boolean).join(" ");
  embed(embText, "passage").then((vec) => {
    const vecSql = vectorToSql(vec);
    db.$executeRawUnsafe(`UPDATE "Ticket" SET embedding = '${vecSql}'::vector WHERE id = '${ticket.id}'`).catch(() => {});
  }).catch(() => {});
  const catFormatted = formatCategory(category as any);
  const logType = crashReport
    ? crashReport.startsWith("http") ? "ссылка" : crashReport.startsWith("[Файл") ? "файл" : "текст"
    : "нет";
  await ctx.reply(
    "Тикет создан.\n\n" +
      (title ? "Название: <b>" + title + "</b>\n" : "") +
      "ID: <code>" + ticket.id + "</code>\n" +
      "Категория: " + catFormatted + "\n" +
      "Лог: " + logType + "\n" +
      "Автор: " + reportedBy,
    {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "menu_back" }]] },
    }
  );
}
