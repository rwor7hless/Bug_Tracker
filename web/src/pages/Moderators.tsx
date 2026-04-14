import { useEffect, useState } from "react";
import PasswordInput from "../components/PasswordInput";

interface Moderator {
  id: string;
  username: string;
  telegramId: string | null;
  createdAt: string;
}

interface BulkResult {
  id: string;
  username: string;
  password: string;
}

export default function Moderators() {
  const [mods, setMods] = useState<Moderator[]>([]);

  // Add form
  const [username, setUsername] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [addError, setAddError] = useState("");
  const [addResult, setAddResult] = useState<{ username: string; password: string } | null>(null);

  // Bulk reset
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Per-user password change
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");

  // Per-user telegram edit
  const [editingTgId, setEditingTgId] = useState<string | null>(null);
  const [newTgId, setNewTgId] = useState("");

  async function load() {
    const r = await fetch("/api/moderators");
    if (r.ok) setMods(await r.json());
  }

  useEffect(() => { load(); }, []);

  async function addMod(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    setAddResult(null);
    setBulkResults(null);
    const r = await fetch("/api/moderators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, telegramId: telegramId || undefined }),
    });
    const d = await r.json();
    if (!r.ok) { setAddError(d.error || "Ошибка"); return; }
    setAddResult({ username: d.username, password: d.password });
    setUsername("");
    setTelegramId("");
    load();
  }

  async function removeMod(id: string) {
    if (!confirm("Удалить модератора?")) return;
    await fetch(`/api/moderators/${id}`, { method: "DELETE" });
    load();
  }

  async function changePassword(userId: string) {
    setPwError("");
    setPwSuccess("");
    const r = await fetch(`/api/users/${userId}/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword }),
    });
    const d = await r.json();
    if (!r.ok) { setPwError(d.error || "Ошибка"); return; }
    setPwSuccess("Пароль изменён");
    setNewPassword("");
    setTimeout(() => { setEditingId(null); setPwSuccess(""); }, 1500);
  }

  async function saveTelegram(userId: string) {
    await fetch(`/api/moderators/${userId}/telegram`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramId: newTgId || null }),
    });
    setEditingTgId(null);
    load();
  }

  async function bulkReset() {
    if (!confirm("Сгенерировать новые пароли всем модераторам? Старые перестанут работать.")) return;
    setBulkLoading(true);
    setBulkResults(null);
    setAddResult(null);
    const r = await fetch("/api/users/bulk-reset", { method: "POST" });
    setBulkLoading(false);
    if (!r.ok) return;
    setBulkResults(await r.json());
  }

  return (
    <div style={{ maxWidth: 580 }}>
      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>
        Модераторы
      </h2>

      {/* Add + bulk in one card */}
      <div className="card" style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <form onSubmit={addMod} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 150px", display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>Логин *</label>
            <input
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div style={{ flex: "1 1 150px", display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>Telegram ID</label>
            <input
              placeholder="123456789"
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
            />
          </div>
          <button className="btn-primary" type="submit" style={{ whiteSpace: "nowrap" }}>
            Добавить
          </button>
        </form>

        <div style={{ borderTop: "1px solid var(--border)" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <p style={{ fontSize: 13, color: "var(--text-2)", flex: 1 }}>Сбросить пароли всем</p>
          <button
            className="btn-ghost"
            style={{ fontSize: 12, whiteSpace: "nowrap" }}
            onClick={bulkReset}
            disabled={bulkLoading}
          >
            {bulkLoading ? "Генерация..." : "Сгенерировать всем"}
          </button>
        </div>

        {addError && <p style={{ color: "var(--red)", fontSize: 13 }}>{addError}</p>}
        {addResult && (
          <div style={{ background: "var(--surface2)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 13 }}>
            <p style={{ marginBottom: 4, fontWeight: 600 }}>Добавлен — сохраните пароль:</p>
            <p>Логин: <code style={{ userSelect: "all" }}>{addResult.username}</code></p>
            <p>Пароль: <code style={{ userSelect: "all" }}>{addResult.password}</code></p>
          </div>
        )}
        {bulkResults && (
          <div style={{ background: "var(--surface2)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 13 }}>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>Новые пароли — раздайте модераторам:</p>
            {bulkResults.length === 0 ? (
              <p style={{ color: "var(--text-3)" }}>Нет модераторов.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", color: "var(--text-2)", fontWeight: 500, paddingBottom: 6, fontSize: 12 }}>Логин</th>
                    <th style={{ textAlign: "left", color: "var(--text-2)", fontWeight: 500, paddingBottom: 6, fontSize: 12 }}>Пароль</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkResults.map((r) => (
                    <tr key={r.id}>
                      <td style={{ paddingBottom: 4, paddingRight: 16 }}>{r.username}</td>
                      <td><code style={{ userSelect: "all" }}>{r.password}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button className="btn-ghost" style={{ fontSize: 11, marginTop: 8 }} onClick={() => setBulkResults(null)}>
              Скрыть
            </button>
          </div>
        )}
      </div>

      {/* Moderator list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {mods.map((m) => (
          <div key={m.id} className="card" style={{ padding: "12px 16px" }}>
            {/* Main row */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 500 }}>{m.username}</p>
                {editingTgId === m.id ? (
                  <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                    <input
                      placeholder="Telegram ID"
                      value={newTgId}
                      onChange={(e) => setNewTgId(e.target.value)}
                      style={{ fontSize: 12, padding: "3px 8px", width: 130 }}
                      autoFocus
                    />
                    <button className="btn-primary" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => saveTelegram(m.id)}>OK</button>
                    <button className="btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setEditingTgId(null)}>✕</button>
                  </div>
                ) : (
                  <p
                    style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2, cursor: "pointer" }}
                    title="Нажмите чтобы изменить Telegram ID"
                    onClick={() => { setEditingTgId(m.id); setNewTgId(m.telegramId ?? ""); }}
                  >
                    {m.telegramId ? `TG: ${m.telegramId}` : "Telegram ID не задан"}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {/* Key icon — toggle password form */}
                <button
                  className="btn-ghost"
                  title={editingId === m.id ? "Отмена" : "Сменить пароль"}
                  style={{ padding: "5px 8px", color: editingId === m.id ? "var(--accent)" : "var(--text-3)" }}
                  onClick={() => {
                    setEditingId(editingId === m.id ? null : m.id);
                    setNewPassword("");
                    setPwError("");
                    setPwSuccess("");
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="7.5" cy="15.5" r="5.5"/>
                    <path d="M21 2l-9.6 9.6"/>
                    <path d="M15.5 7.5l3 3L22 7l-3-3"/>
                  </svg>
                </button>
                <button className="btn-danger" style={{ fontSize: 12 }} onClick={() => removeMod(m.id)}>
                  Удалить
                </button>
              </div>
            </div>

            {/* Password change form */}
            {editingId === m.id && (
              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>Новый пароль</label>
                  <PasswordInput
                    value={newPassword}
                    onChange={setNewPassword}
                    placeholder="Минимум 6 символов"
                    autoFocus
                  />
                </div>
                <button
                  className="btn-primary"
                  style={{ fontSize: 12, whiteSpace: "nowrap" }}
                  onClick={() => changePassword(m.id)}
                >
                  Сохранить
                </button>
                {pwError && <p style={{ color: "var(--red)", fontSize: 12, width: "100%" }}>{pwError}</p>}
                {pwSuccess && <p style={{ color: "var(--green, #4caf50)", fontSize: 12, width: "100%" }}>{pwSuccess}</p>}
              </div>
            )}
          </div>
        ))}
        {mods.length === 0 && <p style={{ color: "var(--text-3)", fontSize: 14 }}>Нет модераторов.</p>}
      </div>
    </div>
  );
}
