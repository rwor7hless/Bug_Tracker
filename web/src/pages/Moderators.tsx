import { useEffect, useState } from "react";

interface Moderator {
  id: string;
  telegramId: string;
  name?: string | null;
  createdAt: string;
}

export default function Moderators() {
  const [mods, setMods] = useState<Moderator[]>([]);
  const [telegramId, setTelegramId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const r = await fetch("/api/moderators");
    if (r.ok) setMods(await r.json());
  }

  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const r = await fetch("/api/moderators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramId, name }),
    });
    if (!r.ok) {
      const d = await r.json();
      setError(d.error || "Ошибка");
      return;
    }
    setTelegramId("");
    setName("");
    load();
  }

  async function remove(id: string) {
    if (!confirm("Удалить модератора?")) return;
    await fetch(`/api/moderators/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div style={{ maxWidth: 580 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20, color: "var(--text)" }}>
        Модераторы Telegram
      </h2>

      <div className="card" style={{ marginBottom: 20 }}>
        <form onSubmit={add} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>Telegram ID *</label>
            <input
              placeholder="123456789"
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
              required
            />
          </div>
          <div style={{ flex: "1 1 160px", display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>Имя</label>
            <input
              placeholder="@username"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button className="btn-primary" type="submit" style={{ whiteSpace: "nowrap" }}>
            Добавить
          </button>
          {error && <p style={{ color: "var(--red)", fontSize: 13, width: "100%" }}>{error}</p>}
        </form>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {mods.map((m) => (
          <div
            key={m.id}
            className="card"
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}
          >
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 500 }}>{m.name || "—"}</p>
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>ID: {m.telegramId}</p>
            </div>
            <button className="btn-danger" style={{ fontSize: 12 }} onClick={() => remove(m.id)}>
              Удалить
            </button>
          </div>
        ))}
        {mods.length === 0 && <p style={{ color: "var(--text-3)", fontSize: 14 }}>Нет модераторов.</p>}
      </div>
    </div>
  );
}
