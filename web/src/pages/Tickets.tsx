import { useEffect, useRef, useState } from "react";
import TicketCard from "../components/TicketCard";
import { useAuth } from "../components/AuthContext";

interface TicketPhoto {
  id: string;
  filename: string;
  order: number;
}

interface Ticket {
  id: string;
  tag?: string | null;
  title?: string | null;
  description: string;
  crashReport?: string | null;
  resolveComment?: string | null;
  status: "OPEN" | "IN_PROGRESS" | "DUPLICATE" | "RESOLVED";
  category: string;
  duplicateOf?: string | null;
  bumpCount: number;
  reportedBy: string;
  createdAt: string;
  photos: TicketPhoto[];
}

const CATEGORIES = [
  { value: "CRASH",    label: "Краш" },
  { value: "LAG",      label: "Лаги" },
  { value: "VISUAL",   label: "Визуал" },
  { value: "GAMEPLAY", label: "Геймплей" },
  { value: "OTHER",    label: "Другое" },
] as const;

const ALL_STATUSES = ["OPEN", "IN_PROGRESS", "DUPLICATE", "RESOLVED"] as const;
const statusLabel: Record<string, string> = {
  OPEN: "Открытые",
  IN_PROGRESS: "В работе",
  DUPLICATE: "Дубликаты",
  RESOLVED: "Решённые",
};

const PAGE_SIZE = 10;

export default function Tickets() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [status, setStatus] = useState<string>("OPEN");
  const [sort, setSort] = useState("date");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const [showCreate, setShowCreate] = useState(false);
  const [newCategory, setNewCategory] = useState("OTHER");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCrash, setNewCrash] = useState("");
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ sort });
    params.set("status", status);
    if (search) params.set("search", search);
    const r = await fetch(`/api/tickets?${params}`);
    if (r.ok) setTickets(await r.json());
    setLoading(false);
  }

  useEffect(() => { setPage(1); }, [status, sort, search]);
  useEffect(() => { load(); }, [status, sort, search]);

  async function createTicket() {
    if (!newDescription.trim()) return;
    setCreating(true);
    const r = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newTitle.trim() || undefined,
        description: newDescription.trim(),
        crashReport: newCrash.trim() || undefined,
        category: newCategory,
      }),
    });
    if (r.ok && newPhotos.length > 0) {
      const ticket = await r.json();
      const fd = new FormData();
      for (const f of newPhotos) fd.append("photos", f);
      await fetch(`/api/tickets/${ticket.id}/photos`, { method: "POST", body: fd });
    }
    setCreating(false);
    setShowCreate(false);
    setNewTitle("");
    setNewDescription("");
    setNewCrash("");
    setNewCategory("OTHER");
    setNewPhotos([]);
    load();
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setNewPhotos(prev => {
      const combined = [...prev, ...files].slice(0, 10);
      return combined;
    });
    e.target.value = "";
  }

  function removePreviewPhoto(index: number) {
    setNewPhotos(prev => prev.filter((_, i) => i !== index));
  }

  async function bump(id: string) {
    await fetch(`/api/tickets/${id}/bump`, { method: "POST" });
    load();
  }

  async function inProgress(id: string) {
    await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    });
    load();
  }

  async function resolve(id: string, resolveComment?: string) {
    await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "RESOLVED", ...(resolveComment ? { resolveComment } : {}) }),
    });
    load();
  }

  async function duplicate(id: string, originalId: string) {
    await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DUPLICATE", duplicateOf: originalId }),
    });
    load();
  }

  async function reopen(id: string) {
    await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "OPEN", duplicateOf: null }),
    });
    load();
  }

  async function del(id: string) {
    if (!confirm("Удалить тикет?")) return;
    await fetch(`/api/tickets/${id}`, { method: "DELETE" });
    load();
  }

  async function deletePhoto(ticketId: string, photoId: string) {
    await fetch(`/api/tickets/${ticketId}/photos/${photoId}`, { method: "DELETE" });
    load();
  }

  const totalPages = Math.max(1, Math.ceil(tickets.length / PAGE_SIZE));
  const pageTickets = tickets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              className={status === s ? "btn-primary" : "btn-ghost"}
              onClick={() => setStatus(s)}
              style={{ fontSize: 13 }}
            >
              {statusLabel[s]}
            </button>
          ))}
        </div>

        <select style={{ width: "auto", fontSize: 13 }} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="date">По дате</option>
          <option value="bumps">По bumps</option>
        </select>

        <input
          placeholder="Поиск… (или CRH-, BUG-001)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 200, fontSize: 13 }}
        />

        <button className="btn-ghost" onClick={load} disabled={loading} style={{ padding: "7px 10px" }}>↻</button>

        <button
          className="btn-primary"
          onClick={() => setShowCreate(true)}
          style={{ marginLeft: "auto", padding: "7px 16px" }}
        >
          + Создать тикет
        </button>
      </div>

      {loading && <p style={{ color: "var(--text-3)", fontSize: 14 }}>Загрузка…</p>}
      {!loading && tickets.length === 0 && <p style={{ color: "var(--text-3)", fontSize: 14 }}>Тикетов нет.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {pageTickets.map((t) => (
          <TicketCard
            key={t.id}
            ticket={t}
            isAdmin={isAdmin}
            onBump={bump}
            onInProgress={inProgress}
            onResolve={resolve}
            onReopen={reopen}
            onDuplicate={duplicate}
            onDelete={del}
            onPhotoDelete={isAdmin ? deletePhoto : undefined}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 20, alignItems: "center" }}>
          <button className="btn-ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: "5px 12px" }}>←</button>
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>{page} / {totalPages}</span>
          <button className="btn-ghost" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ padding: "5px 12px" }}>→</button>
        </div>
      )}

      {showCreate && (
        <div
          className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowCreate(false); setNewPhotos([]); } }}
        >
          <div className="modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="modal-title">Новый тикет</span>
              <button className="btn-ghost" onClick={() => { setShowCreate(false); setNewPhotos([]); }} style={{ padding: "4px 10px" }}>✕</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>Категория</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    className={"tag-btn" + (newCategory === c.value ? " active" : "")}
                    onClick={() => setNewCategory(c.value)}
                    type="button"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>
                Название <span style={{ color: "var(--text-3)" }}>(необязательно)</span>
              </label>
              <input
                placeholder="Краткое название бага…"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                maxLength={100}
                style={{ fontSize: 13 }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>Описание *</label>
              <textarea
                placeholder="Опиши баг подробно: что произошло, как воспроизвести…"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={4}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>
                Лог / ссылка <span style={{ color: "var(--text-3)" }}>(необязательно)</span>
              </label>
              <textarea
                placeholder="Текст лога или ссылка (mclo.gs, pastebin…)"
                value={newCrash}
                onChange={(e) => setNewCrash(e.target.value)}
                rows={3}
              />
            </div>

            {/* Photo upload */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>
                Скриншоты <span style={{ color: "var(--text-3)" }}>(необязательно, до 10 фото)</span>
              </label>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={handlePhotoSelect}
              />
              {newPhotos.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {newPhotos.map((f, i) => {
                    const url = URL.createObjectURL(f);
                    return (
                      <div key={i} style={{ position: "relative" }}>
                        <img
                          src={url}
                          alt=""
                          style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border)" }}
                          onLoad={() => URL.revokeObjectURL(url)}
                        />
                        <button
                          onClick={() => removePreviewPhoto(i)}
                          style={{
                            position: "absolute", top: -6, right: -6,
                            background: "var(--danger, #dc2626)", border: "none", borderRadius: "50%",
                            width: 18, height: 18, cursor: "pointer", color: "#fff",
                            fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center",
                            lineHeight: 1,
                          }}
                        >✕</button>
                      </div>
                    );
                  })}
                </div>
              )}
              {newPhotos.length < 10 && (
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12, alignSelf: "flex-start" }}
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                >
                  + Добавить фото
                </button>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-ghost" onClick={() => { setShowCreate(false); setNewPhotos([]); }}>Отмена</button>
              <button
                className="btn-primary"
                onClick={createTicket}
                disabled={creating || !newDescription.trim()}
                style={{ padding: "8px 20px" }}
              >
                {creating ? "Создаём…" : "Создать"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
