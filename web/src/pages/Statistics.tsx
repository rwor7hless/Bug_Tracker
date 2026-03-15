import { useEffect, useState } from "react";

interface Stats {
  total: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  recentResolved: number;
}

const STATUS_META: { key: string; label: string; color: string }[] = [
  { key: "OPEN",        label: "Открыто",   color: "#f59e0b" },
  { key: "IN_PROGRESS", label: "В работе",  color: "#3b82f6" },
  { key: "DUPLICATE",   label: "Дубликаты", color: "#8b5cf6" },
  { key: "RESOLVED",    label: "Решено",    color: "#22c55e" },
];

const CATEGORY_META: { key: string; label: string }[] = [
  { key: "CRASH",      label: "Краш" },
  { key: "LAG",        label: "Лаги" },
  { key: "VISUAL",     label: "Визуал" },
  { key: "GAMEPLAY",   label: "Геймплей" },
  { key: "OTHER",      label: "Другое" },
  { key: "SUGGESTION", label: "Предложение" },
];

export default function Statistics() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setStats(d); setLoading(false); });
  }, []);

  if (loading) return <p style={{ color: "var(--text-3)", fontSize: 14 }}>Загрузка…</p>;
  if (!stats) return <p style={{ color: "var(--text-3)", fontSize: 14 }}>Ошибка загрузки статистики.</p>;

  const safeTotal = stats.total || 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: 0 }}>Статистика</h2>

      {/* Kanban cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {STATUS_META.map((s) => (
          <div key={s.key} className="card" style={{ textAlign: "center", padding: "16px 12px" }}>
            <div style={{ fontSize: 30, fontWeight: 800, color: s.color, lineHeight: 1 }}>
              {stats.byStatus[s.key] ?? 0}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6 }}>{s.label}</div>
          </div>
        ))}
        <div className="card" style={{ textAlign: "center", padding: "16px 12px" }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: "var(--text)", lineHeight: 1 }}>{stats.total}</div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6 }}>Всего</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "16px 12px" }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: "#22c55e", lineHeight: 1 }}>{stats.recentResolved}</div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6 }}>Решено за 7д</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* By category */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "var(--text)" }}>
            По категориям
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {CATEGORY_META.map(({ key, label }) => {
              const count = stats.byCategory[key] ?? 0;
              const pct = Math.round((count / safeTotal) * 100);
              return (
                <div key={key}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5, color: "var(--text-2)" }}>
                    <span>{label}</span>
                    <span style={{ color: "var(--text-3)" }}>{count} ({pct}%)</span>
                  </div>
                  <div style={{ background: "var(--surface2)", borderRadius: 4, height: 7, overflow: "hidden" }}>
                    <div
                      style={{
                        width: pct + "%",
                        height: "100%",
                        background: "var(--accent)",
                        borderRadius: 4,
                        transition: "width 0.5s ease",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* By status */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "var(--text)" }}>
            По статусам
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {STATUS_META.map(({ key, label, color }) => {
              const count = stats.byStatus[key] ?? 0;
              const pct = Math.round((count / safeTotal) * 100);
              return (
                <div key={key}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5, color: "var(--text-2)" }}>
                    <span>{label}</span>
                    <span style={{ color: "var(--text-3)" }}>{count} ({pct}%)</span>
                  </div>
                  <div style={{ background: "var(--surface2)", borderRadius: 4, height: 7, overflow: "hidden" }}>
                    <div
                      style={{
                        width: pct + "%",
                        height: "100%",
                        background: color,
                        borderRadius: 4,
                        transition: "width 0.5s ease",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
