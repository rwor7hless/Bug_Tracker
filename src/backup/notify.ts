import { getBot } from "../bot/botInstance.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

async function send(chatId: string | null, text: string): Promise<void> {
  if (!chatId) return;
  const bot = getBot();
  if (!bot) {
    console.warn("[backup] notify skipped: bot not initialized");
    return;
  }
  try {
    await bot.telegram.sendMessage(chatId, text, { parse_mode: "HTML" });
  } catch (err) {
    console.error("[backup] failed to send Telegram notification:", err);
  }
}

export async function notifyFailure(
  chatId: string | null,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const text = [
    "<b>❌ Backup failed</b>",
    `<code>${escapeHtml(message)}</code>`,
  ].join("\n");
  await send(chatId, text);
}

export async function notifySuccess(
  chatId: string | null,
  meta: { key: string; size: number; durationMs: number },
): Promise<void> {
  const text = [
    "<b>✅ Backup uploaded</b>",
    `key: <code>${escapeHtml(meta.key)}</code>`,
    `size: ${formatBytes(meta.size)}`,
    `duration: ${formatDuration(meta.durationMs)}`,
  ].join("\n");
  await send(chatId, text);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
