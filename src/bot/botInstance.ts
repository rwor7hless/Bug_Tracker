import { Telegraf } from "telegraf";

let _bot: Telegraf | null = null;

export function setBot(b: Telegraf): void {
  _bot = b;
}

export function getBot(): Telegraf | null {
  return _bot;
}
