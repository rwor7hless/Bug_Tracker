import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../components/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <form onSubmit={handleSubmit} style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "36px 32px",
        width: 360,
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⚔</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.03em" }}>
            Bug Tracker
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4 }}>Minecraft · Панель управления</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>Логин</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            required
            autoFocus
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>Пароль</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </div>

        {error && (
          <div style={{
            background: "var(--red-dim)",
            border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: "var(--radius)",
            padding: "8px 12px",
            color: "var(--red)",
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <button className="btn-primary" type="submit" disabled={loading} style={{ padding: "10px 14px", fontSize: 14 }}>
          {loading ? "Входим…" : "Войти"}
        </button>

        <p style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center" }}>
          Пароль — через Telegram бота: <code style={{ color: "var(--text-2)" }}>/password</code>
        </p>
      </form>
    </div>
  );
}
