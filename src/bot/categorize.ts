type Category = "CRASH" | "LAG" | "VISUAL" | "GAMEPLAY" | "OTHER";

const rules: { category: Category; keywords: string[] }[] = [
  {
    category: "CRASH",
    keywords: ["crash", "краш", "exception", "error", "ошибка", "вылет", "упал", "fatal", "stacktrace", "at java", "caused by"],
  },
  {
    category: "LAG",
    keywords: ["lag", "лаг", "tps", "fps", "freeze", "фриз", "тормоз", "задерж", "ping", "пинг", "rubber", "откат"],
  },
  {
    category: "VISUAL",
    keywords: ["visual", "текстур", "texture", "render", "рендер", "graphic", "график", "invisible", "невидим", "артефакт", "artifact", "отображ"],
  },
  {
    category: "GAMEPLAY",
    keywords: ["дюп", "dup", "exploit", "эксплойт", "баланс", "balance", "механик", "mechanic", "предмет", "item", "квест", "quest", "крафт", "craft"],
  },
];

export function detectCategory(text: string): Category {
  const lower = text.toLowerCase();
  for (const rule of rules) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.category;
  }
  return "OTHER";
}

const categoryLabel: Record<Category, string> = {
  CRASH: "Краш",
  LAG: "Лаги",
  VISUAL: "Визуал",
  GAMEPLAY: "Геймплей",
  OTHER: "Другое",
};

export function formatCategory(cat: Category): string {
  return `[${categoryLabel[cat]}]`;
}
