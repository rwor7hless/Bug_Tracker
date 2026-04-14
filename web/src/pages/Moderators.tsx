import { useEffect, useState } from "react";
import PasswordInput from "../components/PasswordInput";

interface Moderator {
  id: string;
  telegramId: string;
  name?: string | null;
  createdAt: string;
}

interface User {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

interface BulkResult {
  id: string;
  username: string;
  password: string;
}

export default function Moderators() {
  const [mods, setMods] = useState<Moderator[]>([]);
  const [telegramId, setTelegramId] = useState("");
  const [name, setName] = useState("");
  const [modError, setModError] = useState("");

  const [users, setUsers] = useState<User[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [addUserError, setAddUserError] = useState("");
  const [addUserResult, setAddUserResult] = useState<{ username: string; password: string } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");

  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  async function loadMods() {
    const r = await fetch("/api/moderators");
    if (r.ok) setMods(await r.json());
  }

  async function loadUsers() {
    const r = await fetch("/api/users");
    if (r.ok) setUsers(await r.json());
  }

  useEffect(() => { loadMods(); loadUsers(); }, []);

  async function addMod(e: React.FormEvent) {
    e.preventDefault();
    setModError("");
    const r = await fetch("/api/moderators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramId, name }),
    });
    if (!r.ok) {
      const d = await r.json();
      setModError(d.error || "Ошибка");
      return;
    }
    setTelegramId("");
    setName("");
    loadMods();
  }

  async function removeMod(id: string) {
    if (!confirm("Удалить модератора?")) return;
    await fetch(`/api/moderators/${id}`, { method: "DELETE" });
    loadMods();
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setAddUserError("");
    setAddUserResult(null);
    setBulkResults(null);
    const r = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUsername }),
    });
    const d = await r.json();
    if (!r.ok) { setAddUserError(d.error || "Ошибка"); return; }
    setAddUserResult({ username: d.username, password: d.password });
    setNewUsername("");
    loadUsers();
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

  async function bulkReset() {
    if (!confirm("Сгенерировать новые пароли всем модераторам? Старые пароли перестанут работать.")) return;
    setBulkLoading(true);
    setBulkResults(null);
    setAddUserResult(null);
    const r = await fetch("/api/users/bulk-reset", { method: "POST" });
    setBulkLoading(false);
    if (!r.ok) return;
    setBulkResults(await r.json());
  }

  return (
    <div style={{ maxWidth: 580 }}>
      {/* === Telegram moderators === */}
      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>
        Модераторы Telegram
      </h2>

      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={addMod} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
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
          {modError && <p style={{ color: "var(--red)", fontSize: 13, width: "100%" }}>{modError}</p>}
        </form>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 36 }}>
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
            <button className="btn-danger" style={{ fontSize: 12 }} onClick={() => removeMod(m.id)}>
              Удалить
            </button>
          </div>
        ))}
        {mods.length === 0 && <p style={{ color: "var(--text-3)", fontSize: 14 }}>Нет модераторов.</p>}
      </div>

      {/* === Web panel users === */}
      <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>
        Пользователи панели
      </h2>

      {/* Create + bulk reset in one card */}
      <div className="card" style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* New user row */}
        <form onSubmit={addUser} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>Новый пользователь</label>
            <input
              placeholder="username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              required
            />
          </div>
          <button className="btn-primary" type="submit" style={{ whiteSpace: "nowrap" }}>
            Создать
          </button>
        </form>

        {/* Divider */}
        <div style={{ borderTop: "1px solid var(--border)" }} />

        {/* Bulk reset row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, color: "var(--text-2)" }}>Сбросить пароли всем модераторам</p>
          </div>
          <button
            className="btn-ghost"
            style={{ fontSize: 12, whiteSpace: "nowrap" }}
            onClick={bulkReset}
            disabled={bulkLoading}
          >
            {bulkLoading ? "Генерация..." : "Сгенерировать всем"}
          </button>
        </div>

        {/* Results */}
        {addUserError && <p style={{ color: "var(--red)", fontSize: 13 }}>{addUserError}</p>}
        {addUserResult && (
          <div style={{ background: "var(--surface2)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 13 }}>
            <p style={{ marginBottom: 4, fontWeight: 600 }}>Пользователь создан — сохраните пароль:</p>
            <p>Логин: <code style={{ userSelect: "all" }}>{addUserResult.username}</code></p>
            <p>Пароль: <code style={{ userSelect: "all" }}>{addUserResult.password}</code></p>
          </div>
        )}
        {bulkResults && (
          <div style={{ background: "var(--surface2)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 13 }}>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>Новые пароли — сохраните и раздайте:</p>
            {bulkResults.length === 0 ? (
              <p style={{ color: "var(--text-3)" }}>Нет модераторов для сброса.</p>
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
            <button
              className="btn-ghost"
              style={{ fontSize: 11, marginTop: 8 }}
              onClick={() => setBulkResults(null)}
            >
              Скрыть
            </button>
          </div>
        )}
      </div>

      {/* User list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {users.map((u) => (
          <div key={u.id} className="card" style={{ padding: "12px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 500 }}>{u.username}</p>
                <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                  {u.role === "ADMIN" ? "Администратор" : "Модератор"}
                </p>
              </div>
              {u.role !== "ADMIN" && (
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12 }}
                  onClick={() => {
                    setEditingId(editingId === u.id ? null : u.id);
                    setNewPassword("");
                    setPwError("");
                    setPwSuccess("");
                  }}
                >
                  {editingId === u.id ? "Отмена" : "Сменить пароль"}
                </button>
              )}
            </div>

            {editingId === u.id && (
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
                  onClick={() => changePassword(u.id)}
                >
                  Сохранить
                </button>
                {pwError && <p style={{ color: "var(--red)", fontSize: 12, width: "100%" }}>{pwError}</p>}
                {pwSuccess && <p style={{ color: "var(--green, #4caf50)", fontSize: 12, width: "100%" }}>{pwSuccess}</p>}
              </div>
            )}
          </div>
        ))}
        {users.length === 0 && <p style={{ color: "var(--text-3)", fontSize: 14 }}>Нет пользователей.</p>}
      </div>
    </div>
  );
}
