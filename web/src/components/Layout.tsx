import { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import PasswordInput from "./PasswordInput";

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("Новые пароли не совпадают");
      return;
    }
    if (newPassword.length < 6) {
      setError("Новый пароль должен быть не менее 6 символов");
      return;
    }
    const r = await fetch("/api/users/me/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    const d = await r.json();
    if (!r.ok) { setError(d.error || "Ошибка"); return; }
    setSuccess(true);
    setTimeout(onClose, 1200);
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ width: 320, padding: 24 }}>
        <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Сменить пароль</p>
        {success ? (
          <p style={{ color: "var(--green, #4caf50)", fontSize: 14 }}>Пароль успешно изменён</p>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>Текущий пароль</label>
              <PasswordInput value={oldPassword} onChange={setOldPassword} required autoFocus />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>Новый пароль</label>
              <PasswordInput value={newPassword} onChange={setNewPassword} placeholder="Минимум 6 символов" required />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>Повторите новый пароль</label>
              <PasswordInput value={confirmPassword} onChange={setConfirmPassword} required />
            </div>
            {error && <p style={{ color: "var(--red)", fontSize: 12 }}>{error}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button type="button" className="btn-ghost" style={{ fontSize: 13 }} onClick={onClose}>
                Отмена
              </button>
              <button type="submit" className="btn-primary" style={{ fontSize: 13 }}>
                Сохранить
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "ADMIN";
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  const navLink = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
    color: isActive ? "var(--text)" : "var(--text-2)",
    fontSize: 14,
    fontWeight: isActive ? 600 : 400,
    padding: "5px 10px",
    borderRadius: "var(--radius)",
    background: isActive ? "var(--surface2)" : "transparent",
    transition: "color 0.13s, background 0.13s",
    whiteSpace: "nowrap",
    display: "inline-block",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}

      <header style={{
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        padding: "0 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 52,
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: "var(--accent)", letterSpacing: "-0.03em", flexShrink: 0, marginRight: 4 }}>
          🐛 MC Bugs
        </span>

        <nav style={{ display: "flex", gap: 2, overflowX: "auto", scrollbarWidth: "none", flex: 1, msOverflowStyle: "none" } as React.CSSProperties}>
          <NavLink to="/" end style={navLink}>Тикеты</NavLink>
          {isAdmin && <NavLink to="/moderators" style={navLink}>Модераторы</NavLink>}
          {isAdmin && <NavLink to="/statistics" style={navLink}>Статистика</NavLink>}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            className="btn-ghost"
            onClick={() => setShowPasswordModal(true)}
            style={{
              fontSize: 12,
              padding: "5px 10px",
              minHeight: 32,
              maxWidth: 120,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--text-3)",
            }}
            title="Сменить пароль"
          >
            {user?.username}
          </button>
          <button
            className="btn-ghost"
            onClick={handleLogout}
            style={{ fontSize: 12, padding: "5px 10px", minHeight: 32 }}
          >
            Выйти
          </button>
        </div>
      </header>

      <main style={{ flex: 1, padding: "20px 16px", maxWidth: 960, margin: "0 auto", width: "100%" }}>
        <Outlet />
      </main>
    </div>
  );
}
