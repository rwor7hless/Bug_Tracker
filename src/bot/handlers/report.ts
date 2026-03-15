import { Context } from "telegraf";
import db from "../../db.js";
import { formatCategory } from "../categorize.js";
import { embed, vectorToSql } from "../../embeddings.js";
import fs from "fs/promises";
import path from "path";
import { getUploadDir } from "../../api/routes/tickets.js";

const BOT_CATEGORY_PREFIX: Record<string, string> = {
  CRASH: "CRH", LAG: "LAG", VISUAL: "VIS", GAMEPLAY: "GME", OTHER: "BUG", SUGGESTION: "SUG",
};

async function assignBotTag(ticketId: string, category: string): Promise<string> {
  const prefix = BOT_CATEGORY_PREFIX[category] ?? "BUG";
  const last = await db.ticket.findFirst({
    where: { tag: { startsWith: prefix + "-" } },
    orderBy: { tagNumber: "desc" },
    select: { tagNumber: true },
  });
  const nextNum = (last?.tagNumber ?? 0) + 1;
  const tag = `${prefix}-${nextNum <= 999 ? String(nextNum).padStart(3, "0") : nextNum}`;
  await db.ticket.update({ where: { id: ticketId }, data: { tag, tagNumber: nextNum } });
  return tag;
}

type Step =
  | "category"
  | "title"
  | "description"
  | "urgency"
  | "crash_prompt"
  | "crash_type"
  | "crash_link"
  | "crash_text"
  | "crash_file"
  | "photos_collecting"
  | "bump_id"
  | "similar_check"
  | "search_query";

type Session = {
  step?: Step;
  title?: string;
  description?: string;
  category?: string;
  urgency?: string;
  pendingCrashReport?: string;
  pendingTicketId?: string;
  pendingPhotoFileIds?: string[];
  similarIds?: string[];
  listPage?: number;
  listTickets?: string;
  menuMsgId?: number;
  chatId?: number;
};

const CATS = [
  { label: "Краш",        value: "CRASH" },
  { label: "Лаги",        value: "LAG" },
  { label: "Визуал",      value: "VISUAL" },
  { label: "Геймплей",    value: "GAMEPLAY" },
  { label: "Другое",      value: "OTHER" },
  { label: "📝 Предложение", value: "SUGGESTION" },
];

function catKb() {
  return {
    inline_keyboard: [
      CATS.slice(0, 2).map(c => ({ text: c.label, callback_data: "cat_" + c.value })),
      CATS.slice(2, 4).map(c => ({ text: c.label, callback_data: "cat_" + c.value })),
      [{ text: CATS[4].label, callback_data: "cat_" + CATS[4].value }],
      [{ text: CATS[5].label, callback_data: "cat_" + CATS[5].value }],
      [{ text: "Назад", callback_data: "menu_back" }],
    ],
  };
}

// --- Single-message helper ---
// Always edits the existing menu message in-place.
// If editing fails (message deleted / too old), deletes the stale message and sends a fresh one.
async function botSend(ctx: Context, s: Session, text: string, extra: any) {
  const c = ctx as any;

  // Prefer the message that triggered the callback, fall back to session-tracked message.
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
      // Edit failed (message deleted or too old) — remove stale keyboard and send fresh message.
      await tryDelete(ctx, targetChatId, targetMsgId);
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

async function tryDelete(ctx: Context, chatId: number, messageId: number) {
  try {
    await ctx.telegram.deleteMessage(chatId, messageId);
  } catch {}
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
  s.urgency = undefined;
  s.pendingCrashReport = undefined;
  s.pendingTicketId = undefined;
  s.pendingPhotoFileIds = undefined;
  s.similarIds = undefined;
  s.listPage = undefined;
  s.listTickets = undefined;
  // menuMsgId and chatId are preserved intentionally
}

const LIST_PAGE_SIZE = 5;

async function showTicketList(ctx: Context, s: Session, tickets: any[], page: number, title: string) {
  const total = tickets.length;
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  const pageTickets = tickets.slice(page * LIST_PAGE_SIZE, (page + 1) * LIST_PAGE_SIZE);
  const CAT_ORDER = ["CRASH", "LAG", "VISUAL", "GAMEPLAY", "OTHER", "SUGGESTION"];

  const groups: Record<string, typeof pageTickets> = {};
  for (const t of pageTickets) {
    if (!groups[t.category]) groups[t.category] = [];
    groups[t.category].push(t);
  }
  const sections: string[] = [];
  for (const cat of CAT_ORDER) {
    const list = groups[cat];
    if (!list?.length) continue;
    const header = formatCategory(cat as any);
    const rows = list.map((t: any) => {
      const mark = t.status === "IN_PROGRESS" ? " [в работе]" : "";
      const label = t.title || t.description.slice(0, 50);
      const text = label.length > 50 ? label.slice(0, 50) + "…" : label;
      const ref = t.tag ?? t.id.slice(0, 8);
      return `  <code>${ref}</code>${mark} bumps:${t.bumpCount} — ${text}`;
    });
    sections.push(`<b>${header}</b>\n` + rows.join("\n"));
  }

  const nav: any[] = [];
  if (totalPages > 1) {
    const row: any[] = [];
    if (page > 0) row.push({ text: "← Назад", callback_data: `list_page_${page - 1}` });
    row.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
    if (page < totalPages - 1) row.push({ text: "Вперёд →", callback_data: `list_page_${page + 1}` });
    nav.push(row);
  }
  nav.push([
    { text: "🔍 Поиск", callback_data: "menu_search" },
    { text: "↑ Bump", callback_data: "menu_bump" },
  ]);
  nav.push([{ text: "В меню", callback_data: "menu_back" }]);

  return botSend(
    ctx, s,
    `<b>${title}</b> (${total})\n\n` + (sections.join("\n\n") || "Нет тикетов."),
    { parse_mode: "HTML", reply_markup: { inline_keyboard: nav } }
  );
}

async function showUrgencyPrompt(ctx: Context, s: Session) {
  s.step = "urgency";
  await botSend(ctx, s, "Укажи срочность:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🟢 Обычная", callback_data: "urgency_NORMAL" }],
        [{ text: "🟡 Высокая", callback_data: "urgency_HIGH" }],
        [{ text: "🔴 Критичная", callback_data: "urgency_CRITICAL" }],
        [{ text: "Отмена", callback_data: "menu_back" }],
      ],
    },
  });
}

async function showCrashPrompt(ctx: Context, s: Session) {
  s.step = "crash_prompt";
  await botSend(ctx, s, "Есть лог / краш-репорт?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Да", callback_data: "crash_yes" }, { text: "Нет", callback_data: "crash_no" }],
        [{ text: "Отмена", callback_data: "menu_back" }],
      ],
    },
  });
}

async function checkSimilarAfterDescription(ctx: Context, s: Session) {
  const similar = await findSimilar(s.title ? s.title + " " + s.description! : s.description!, s.category!);

  if (!similar.length) {
    await showUrgencyPrompt(ctx, s);
    return;
  }

  s.similarIds = similar.map((t) => t.id);
  s.step = "similar_check";

  const lines = similar.map((t, i) => {
    const statusMark = t.status === "IN_PROGRESS" ? " [в работе]" : "";
    const label = (t as any).title || t.description.slice(0, 60);
    const desc = label.length > 70 ? label.slice(0, 70) + "…" : label;
    const ref = (t as any).tag ?? t.id.slice(0, 8);
    return `${i + 1}.${statusMark} <code>${ref}</code> bumps: ${t.bumpCount}\n   ${desc}`;
  });

  const buttons = similar.map((t, i) => {
    const label = (t as any).title || t.description.slice(0, 28);
    return [{ text: `${i + 1}. ${label.slice(0, 30)}`, callback_data: `similar_bump_${t.id}` }];
  });
  buttons.push([{ text: "Подходящих нет — создать новый", callback_data: "similar_none" }]);
  buttons.push([{ text: "Отмена", callback_data: "menu_back" }]);

  await botSend(
    ctx, s,
    "<b>Найдены похожие тикеты:</b>\n\n" +
      lines.join("\n\n") +
      "\n\n<i>Выбери похожий, чтобы добавить bump, или создай новый:</i>",
    { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
  );
}

// --- Main menu ---
export async function showMainMenu(ctx: Context) {
  const c = ctx as any;
  if (!c.session) c.session = {};
  const s = c.session as Session;
  clearSession(s);
  return botSend(
    ctx, s,
    "🐛 <b>Bug Tracker</b>",
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📝 Создать репорт", callback_data: "menu_report" }],
          [{ text: "📋 Тикеты", callback_data: "menu_list_0" }],
          [{ text: "🔑 Пароль для панели", callback_data: "menu_password" }],
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

  const userMsgId: number | undefined = c.message?.message_id;
  const userChatId: number | undefined = c.message?.chat?.id;
  if (userMsgId && userChatId) {
    tryDelete(ctx, userChatId, userMsgId);
  }

  if (s.step === "title") {
    if (text.length > 100) {
      await botSend(ctx, s, "Название слишком длинное. Максимум 100 символов. Попробуй ещё раз:", {
        reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "menu_back" }]] },
      });
      return true;
    }
    s.title = text;
    s.step = "description";
    const descPrompt = s.category === "SUGGESTION"
      ? "Название принято.\n\nОпиши предложение подробно: что именно ты хочешь улучшить и почему это важно:"
      : "Название принято.\n\nТеперь опиши баг подробно: что произошло, как воспроизвести:";
    await botSend(ctx, s, descPrompt, {
      reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "menu_back" }]] },
    });
    return true;
  }

  if (s.step === "description") {
    s.description = text;
    await checkSimilarAfterDescription(ctx, s);
    return true;
  }

  if (s.step === "crash_link") {
    if (!text.startsWith("http")) {
      await botSend(ctx, s, "Укажи корректную ссылку (начинается с http):", {
        reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "menu_back" }]] },
      });
      return true;
    }
    s.pendingCrashReport = text;
    await submitTicket(ctx, s, s.title, s.description!, s.category!, s.pendingCrashReport);
    return true;
  }

  if (s.step === "crash_text") {
    s.pendingCrashReport = text;
    await submitTicket(ctx, s, s.title, s.description!, s.category!, s.pendingCrashReport);
    return true;
  }

  if (s.step === "search_query") {
    s.step = undefined;
    let results: any[];

    const TAG_PREFIXES_BOT = new Set(["CRH", "LAG", "VIS", "GME", "BUG", "SUG"]);
    const tagMatch = text.trim().match(/^([A-Z]{2,4})-(\d*)$/i);
    if (tagMatch && TAG_PREFIXES_BOT.has(tagMatch[1].toUpperCase())) {
      const tagQuery = tagMatch[1].toUpperCase() + "-" + tagMatch[2];
      results = await db.ticket.findMany({
        where: { tag: { startsWith: tagQuery } },
        orderBy: { bumpCount: "desc" },
      });
    } else {
      const allTickets = await db.ticket.findMany({
        where: { status: { in: ["OPEN", "IN_PROGRESS"] as any[] } },
        orderBy: { bumpCount: "desc" },
      });
      const tokens = text.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 2);
      results = allTickets.filter((t: any) => {
        const haystack = [(t.title || ""), t.description].join(" ").toLowerCase();
        return tokens.some((tok: string) => haystack.includes(tok));
      });
    }

    if (!results.length) {
      await botSend(ctx, s, "По запросу <b>" + text + "</b> ничего не найдено.", {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "menu_back" }]] },
      });
      return true;
    }
    s.listTickets = JSON.stringify(results.map((t: any) => t.id));
    s.listPage = 0;
    await showTicketList(ctx, s, results, 0, `Результаты: «${text}»`);
    return true;
  }

  if (s.step === "bump_id") {
    const isTag = /^[A-Z]{2,4}-\d+$/i.test(text);
    const ticket = isTag
      ? await db.ticket.findUnique({ where: { tag: text.toUpperCase() } })
      : await db.ticket.findFirst({
          where: text.length < 36 ? { id: { startsWith: text } } : { id: text },
        });
    if (!ticket) {
      await botSend(ctx, s, "Тикет не найден.", {
        reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "menu_back" }]] },
      });
      return true;
    }
    const updated = await db.ticket.update({ where: { id: ticket.id }, data: { bumpCount: { increment: 1 } } });
    const from = ctx.from!;
    const who = from.username ? "@" + from.username : from.first_name;
    s.step = undefined;
    await botSend(
      ctx, s,
      "Bump засчитан.\n\n" +
        "🏷 <code>" + ((ticket as any).tag ?? ticket.id.slice(0, 8)) + "</code>\n" +
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

  if (data.startsWith("admin_")) {
    const { handleAdminCallback } = await import("./admin.js");
    await handleAdminCallback(ctx, data);
    return;
  }

  if (data === "noop") return;
  if (data === "menu_back") return showMainMenu(ctx);

  if (data === "menu_report") {
    s.step = "category"; s.description = undefined; s.category = undefined;
    return botSend(ctx, s, "<b>Новый баг-репорт</b>\n\nВыбери категорию:", { parse_mode: "HTML", reply_markup: catKb() });
  }

  if (data.startsWith("menu_list_")) {
    const page = parseInt(data.slice("menu_list_".length)) || 0;
    const tickets = await db.ticket.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] as any[] } },
      orderBy: { bumpCount: "desc" },
    });
    if (!tickets.length) {
      await botSend(ctx, s, "Открытых тикетов нет.", {
        reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "menu_back" }]] },
      });
      return;
    }
    s.listTickets = JSON.stringify(tickets.map((t) => t.id));
    s.listPage = page;
    return showTicketList(ctx, s, tickets, page, "Открытые баги");
  }

  if (data.startsWith("list_page_")) {
    const page = parseInt(data.slice("list_page_".length)) || 0;
    const ids: string[] = s.listTickets ? JSON.parse(s.listTickets) : [];
    if (!ids.length) return showMainMenu(ctx);
    const tickets = await db.ticket.findMany({
      where: { id: { in: ids } },
      orderBy: { bumpCount: "desc" },
    });
    const ordered = ids.map(id => tickets.find(t => t.id === id)).filter(Boolean) as typeof tickets;
    s.listPage = page;
    return showTicketList(ctx, s, ordered, page, "Открытые баги");
  }

  if (data === "menu_search") {
    s.step = "search_query";
    return botSend(ctx, s, "Введи поисковый запрос:", {
      reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "menu_back" }]] },
    });
  }

  if (data === "menu_bump") {
    s.step = "bump_id";
    return botSend(ctx, s, "Введи тег тикета (например <code>BUG-001</code>) или первые 8 символов ID:", {
      parse_mode: "HTML",
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
    const titlePrompt = cat === "SUGGESTION"
      ? catLabel + "\n\nКратко опиши своё предложение (до 100 символов):"
      : catLabel + "\n\nВведи краткое название бага (до 100 символов):";
    return botSend(ctx, s, titlePrompt, {
      reply_markup: { inline_keyboard: [[{ text: "К категориям", callback_data: "menu_report" }]] },
    });
  }

  if (data === "crash_yes" && s.step === "crash_prompt") {
    s.step = "crash_type";
    return botSend(ctx, s, "Как прикрепить лог?", {
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
    await submitTicket(ctx, s, s.title, s.description!, s.category!, undefined);
    return;
  }

  if (data === "log_link") { s.step = "crash_link"; return botSend(ctx, s, "Вставь ссылку на лог:", { reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "menu_back" }]] } }); }
  if (data === "log_text") { s.step = "crash_text"; return botSend(ctx, s, "Вставь текст лога:", { reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "menu_back" }]] } }); }
  if (data === "log_file") { s.step = "crash_file"; return botSend(ctx, s, "Отправь файл (.log или .txt):", { reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "menu_back" }]] } }); }

  // --- Photos ---
  if (data === "photos_done" && s.step === "photos_collecting") {
    const fileIds = s.pendingPhotoFileIds ?? [];
    if (fileIds.length === 0) {
      clearSession(s);
      return showMainMenu(ctx);
    }
    const ticketId = s.pendingTicketId!;
    const uploadDir = getUploadDir();
    await fs.mkdir(uploadDir, { recursive: true });

    let saved = 0;
    for (let i = 0; i < fileIds.length; i++) {
      try {
        const fileUrl = await ctx.telegram.getFileLink(fileIds[i]);
        const res = await fetch(fileUrl.href);
        if (!res.ok) continue;
        const buffer = Buffer.from(await res.arrayBuffer());
        const filename = `${ticketId}-${Date.now()}-${i}.jpg`;
        await fs.writeFile(path.join(uploadDir, filename), buffer);
        await db.ticketPhoto.create({ data: { ticketId, filename, order: i } });
        saved++;
      } catch {}
    }

    clearSession(s);
    return botSend(ctx, s, `Прикреплено ${saved} фото. Тикет сохранён.`, {
      reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "menu_back" }]] },
    });
  }

  // --- Similar tickets ---
  if (data.startsWith("similar_bump_") && s.step === "similar_check") {
    const ticketId = data.slice("similar_bump_".length);
    const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      await botSend(ctx, s, "Тикет не найден.", {
        reply_markup: { inline_keyboard: [[{ text: "В меню", callback_data: "menu_back" }]] },
      });
      return showMainMenu(ctx);
    }
    const updated = await db.ticket.update({ where: { id: ticketId }, data: { bumpCount: { increment: 1 } } });
    clearSession(s);
    const from = ctx.from!;
    const who = from.username ? "@" + from.username : from.first_name;
    return botSend(
      ctx, s,
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
    s.similarIds = undefined;
    await showUrgencyPrompt(ctx, s);
    return;
  }

  if (data.startsWith("urgency_") && s.step === "urgency") {
    const urgency = data.slice("urgency_".length);
    s.urgency = urgency;
    // SUGGESTION skips crash report
    if (s.category === "SUGGESTION") {
      await submitTicket(ctx, s, s.title, s.description!, s.category!, undefined);
    } else {
      await showCrashPrompt(ctx, s);
    }
    return;
  }
}

// --- Photo handler ---
export async function reportPhotoHandler(ctx: Context) {
  const c = ctx as any;
  if (!c.session) c.session = {};
  const s = c.session as Session;
  if (s.step !== "photos_collecting") return;

  const photo = c.message?.photo as Array<{ file_id: string }> | undefined;
  if (!photo?.length) return;

  const userMsgId: number | undefined = c.message?.message_id;
  const userChatId: number | undefined = c.message?.chat?.id;
  if (userMsgId && userChatId) tryDelete(ctx, userChatId, userMsgId);

  if (!s.pendingPhotoFileIds) s.pendingPhotoFileIds = [];
  if (s.pendingPhotoFileIds.length >= 10) return;

  // Take the largest available photo (last in array)
  const largest = photo[photo.length - 1];
  s.pendingPhotoFileIds.push(largest.file_id);

  const count = s.pendingPhotoFileIds.length;
  await botSend(ctx, s,
    `Фото добавлено (${count}/10).\n\nОтправь ещё или нажми «Готово»:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: `✓ Готово (${count} фото)`, callback_data: "photos_done" }],
          [{ text: "Пропустить без фото", callback_data: "menu_back" }],
        ],
      },
    }
  );
}

// --- Document handler ---
export async function reportDocumentHandler(ctx: Context) {
  const c = ctx as any;
  if (!c.session) c.session = {};
  const s = c.session as Session;
  if (s.step !== "crash_file") return;
  const doc = c.message?.document;
  if (!doc) return;

  const userMsgId: number | undefined = c.message?.message_id;
  const userChatId: number | undefined = c.message?.chat?.id;
  if (userMsgId && userChatId) {
    tryDelete(ctx, userChatId, userMsgId);
  }

  const fileId = doc.file_id;
  const fileName = doc.file_name ?? "log";
  try {
    const fileUrl = await ctx.telegram.getFileLink(fileId);
    const res = await fetch(fileUrl.href);
    const content = await res.text();
    if (content.length > 50000) {
      await botSend(ctx, s, "Файл слишком большой. Используй ссылку.", {
        reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "menu_back" }]] },
      });
      return;
    }
    s.pendingCrashReport = content;
  } catch {
    s.pendingCrashReport = "[Файл: " + fileName + ", id: " + fileId + "]";
  }
  await submitTicket(ctx, s, s.title, s.description!, s.category!, s.pendingCrashReport);
}

// --- Submit ---
async function submitTicket(ctx: Context, s: Session, title: string | undefined, description: string, category: string, crashReport?: string) {
  const from = ctx.from!;
  const reportedBy = from.username ? "@" + from.username : from.first_name;
  const telegramId = String(from.id);
  const urgency = (s.urgency ?? "NORMAL") as any;
  const ticket = await db.ticket.create({
    data: { title, description, crashReport, reportedBy, category: category as any, telegramId, urgency },
  });

  const tag = await assignBotTag(ticket.id, category).catch(() => null);

  const embText = [title, description].filter(Boolean).join(" ");
  embed(embText, "passage").then((vec) => {
    const vecSql = vectorToSql(vec);
    db.$executeRawUnsafe(`UPDATE "Ticket" SET embedding = '${vecSql}'::vector WHERE id = '${ticket.id}'`).catch(() => {});
  }).catch(() => {});

  const catFormatted = formatCategory(category as any);
  const logType = crashReport
    ? crashReport.startsWith("http") ? "ссылка" : crashReport.startsWith("[Файл") ? "файл" : "текст"
    : "нет";
  const ticketRef = tag ?? ticket.id.slice(0, 8);

  // Transition to photo collection
  s.pendingTicketId = ticket.id;
  s.pendingPhotoFileIds = [];
  s.step = "photos_collecting";

  await botSend(
    ctx, s,
    "Тикет создан!\n\n" +
      (title ? "Название: <b>" + title + "</b>\n" : "") +
      "🏷 <code>" + ticketRef + "</code>\n" +
      "Категория: " + catFormatted + "\n" +
      "Лог: " + logType + "\n" +
      "Автор: " + reportedBy +
      "\n\nМожешь прикрепить скриншоты (до 10 фото):",
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Пропустить (без фото)", callback_data: "menu_back" }],
        ],
      },
    }
  );
}
