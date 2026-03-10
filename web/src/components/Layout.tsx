import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <header style={{
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        padding: "0 28px",
        display: "flex",
        alignItems: "center",
        gap: 28,
        height: 54,
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--accent)", letterSpacing: "-0.02em" }}>
          Bug Tracker
        </span>

        <nav style={{ display: "flex", gap: 4 }}>
          <NavLink to="/" end style={({ isActive }) => ({
            color: isActive ? "var(--text)" : "var(--text-2)",
            fontSize: 14,
            padding: "4px 10px",
            borderRadius: "var(--radius)",
            background: isActive ? "var(--surface2)" : "transparent",
            transition: "all 0.15s",
          })}>Тикеты</NavLink>

          {user?.role === "ADMIN" && (
            <>
              <NavLink to="/moderators" style={({ isActive }) => ({
                color: isActive ? "var(--text)" : "var(--text-2)",
                fontSize: 14,
                padding: "4px 10px",
                borderRadius: "var(--radius)",
                background: isActive ? "var(--surface2)" : "transparent",
                transition: "all 0.15s",
              })}>Модераторы</NavLink>
              <NavLink to="/statistics" style={({ isActive }) => ({
                color: isActive ? "var(--text)" : "var(--text-2)",
                fontSize: 14,
                padding: "4px 10px",
                borderRadius: "var(--radius)",
                background: isActive ? "var(--surface2)" : "transparent",
                transition: "all 0.15s",
              })}>Статистика</NavLink>
            </>
          )}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--text-3)" }}>{user?.username}</span>
          <button className="btn-ghost" onClick={handleLogout} style={{ fontSize: 13, padding: "5px 12px" }}>
            Выйти
          </button>
        </div>
      </header>

      <main style={{ flex: 1, padding: "28px 24px", maxWidth: 900, margin: "0 auto", width: "100%" }}>
        <Outlet />
      </main>
    </div>
  );
}
