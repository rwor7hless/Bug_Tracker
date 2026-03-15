import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "ADMIN";

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

        {/* Nav — scrollable on mobile, hides scrollbar */}
        <nav style={{ display: "flex", gap: 2, overflowX: "auto", scrollbarWidth: "none", flex: 1, msOverflowStyle: "none" } as React.CSSProperties}>
          <NavLink to="/" end style={navLink}>Тикеты</NavLink>
          {isAdmin && <NavLink to="/moderators" style={navLink}>Модераторы</NavLink>}
          {isAdmin && <NavLink to="/statistics" style={navLink}>Статистика</NavLink>}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: "var(--text-3)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.username}
          </span>
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
