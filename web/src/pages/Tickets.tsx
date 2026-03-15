import { useEffect, useRef, useState } from "react";
import TicketCard from "../components/TicketCard";
import { useAuth } from "../components/AuthContext";

interface TicketPhoto { id: string; filename: string; order: number; }

interface Ticket {
  id: string;
  tag?: string | null;
  title?: string | null;
  description: string;
  crashReport?: string | null;
  resolveComment?: string | null;
  status: "OPEN" | "IN_PROGRESS" | "DUPLICATE" | "RESOLVED";
  category: string;
  urgency: "NORMAL" | "HIGH" | "CRITICAL";
  duplicateOf?: string | null;
  bumpCount: number;
  reportedBy: string;
  createdAt: string;
  photosDeleted?: boolean;
  photos: TicketPhoto[];
}

const CATEGORIES = [
  { value: "CRASH",      label: "🔴 Краш" },
  { value: "LAG",        label: "⚡ Лаги" },
  { value: "VISUAL",     label: "👁 Визуал" },
  { value: "GAMEPLAY",   label: "🎮 Геймплей" },
  { value: "OTHER",      label: "📌 Другое" },
  { value: "SUGGESTION", label: "💡 Предложение" },
];

const STATUS_FILTERS = [
  { value: "OPEN",        label: "Открытые" },
  { value: "IN_PROGRESS", label: "В работе" },
  { value: "DUPLICATE",   label: "Дубликаты" },
  { value: "RESOLVED",    label: "Решённые" },
];

const PAGE_SIZE = 10;

function UrgencyPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="urgency-picker">
      <button type="button" className={`u-normal${value === "NORMAL" ? " active" : ""}`} onClick={() => onChange("NORMAL")}>
        🟢 Обычная
      </button>
      <button type="button" className={`u-high${value === "HIGH" ? " active" : ""}`} onClick={() => onChange("HIGH")}>
        ⚡ Высокая
      </button>
      <button type="button" className={`u-critical${value === "CRITICAL" ? " active" : ""}`} onClick={() => onChange("CRITICAL")}>
        🔴 Критичная
      </button>
    </div>
  );
}

function TicketForm({
  title, setTitle, description, setDescription, crash, setCrash,
  cat, setCat, urgency, setUrgency, isCreate,
}: {
  title: string; setTitle: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  crash: string; setCrash: (v: string) => void;
  cat: string; setCat: (v: string) => void;
  urgency: string; setUrgency: (v: string) => void;
  isCreate: boolean;
}) {
  return (
    <>
      <div className="field">
        <span className="field-label">Категория</span>
        <div className="chip-scroll" style={{ flexWrap: "wrap" }}>
          {CATEGORIES.map((c) => (
            <button key={c.value} type="button" className={"tag-btn" + (cat === c.value ? " active" : "")} onClick={() => setCat(c.value)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Срочность</span>
        <UrgencyPicker value={urgency} onChange={setUrgency} />
      </div>

      <div className="field">
        <span className="field-label">Название *</span>
        <input placeholder="Краткое название…" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} />
      </div>

      <div className="field">
        <span className="field-label">Описание <span>(необязательно)</span></span>
        <textarea
          placeholder={isCreate ? "Что случилось? Как воспроизвести?" : undefined}
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={4}
        />
      </div>

      <div className="field">
        <span className="field-label">Лог / ссылка <span>(необязательно)</span></span>
        <textarea placeholder="Текст лога или ссылка (mclo.gs, pastebin…)" value={crash} onChange={e => setCrash(e.target.value)} rows={3} />
      </div>
    </>
  );
}

export default function Tickets() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [status, setStatus] = useState<string>("OPEN");
  const [sort, setSort] = useState("bumps");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newCategory, setNewCategory] = useState("OTHER");
  const [newUrgency, setNewUrgency] = useState("NORMAL");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCrash, setNewCrash] = useState("");
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Similar-hint state
  const [similarHint, setSimilarHint] = useState<Ticket[]>([]);
  const [similarHintLoading, setSimilarHintLoading] = useState(false);
  const [bumpingHintId, setBumpingHintId] = useState<string | null>(null);

  // Edit form
  const [editTicket, setEditTicket] = useState<Ticket | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCrash, setEditCrash] = useState("");
  const [editCategory, setEditCategory] = useState("OTHER");
  const [editUrgency, setEditUrgency] = useState("NORMAL");
  const [saving, setSaving] = useState(false);

  const URGENCY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2 };

  async function load() {
    setLoading(true);
    const apiSort = sort === "urgency" ? "date" : sort;
    const params = new URLSearchParams({ sort: apiSort });
    if (status) params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    if (category) params.set("category", category);
    const r = await fetch(`/api/tickets?${params}`);
    if (r.ok) {
      const data: Ticket[] = await r.json();
      if (sort === "urgency") {
        data.sort((a, b) => (URGENCY_ORDER[a.urgency] ?? 2) - (URGENCY_ORDER[b.urgency] ?? 2));
      }
      setTickets(data);
    }
    setLoading(false);
  }

  useEffect(() => { setPage(1); }, [status, sort, search, category]);
  useEffect(() => { load(); }, [status, sort, search, category]);

  // Debounced similar-hint check — triggers after title input
  useEffect(() => {
    if (!showCreate || !newTitle.trim()) { setSimilarHint([]); return; }
    setSimilarHintLoading(true);
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ text: newTitle.trim(), category: newCategory });
      const r = await fetch(`/api/tickets/similar?${params}`);
      setSimilarHintLoading(false);
      if (r.ok) setSimilarHint(await r.json());
    }, 3000);
    return () => { clearTimeout(timer); setSimilarHintLoading(false); };
  }, [newTitle, newCategory, showCreate]);

  function closeCreate() {
    setShowCreate(false);
    setNewPhotos([]);
    setSimilarHint([]);
    setSimilarHintLoading(false);
    setNewTitle(""); setNewDescription(""); setNewCrash("");
    setNewCategory("OTHER"); setNewUrgency("NORMAL");
  }

  async function bumpFromHint(id: string) {
    setBumpingHintId(id);
    await fetch(`/api/tickets/${id}/bump`, { method: "POST" });
    setBumpingHintId(null);
    closeCreate();
    load();
  }

  async function createTicket() {
    if (!newTitle.trim()) return;
    setCreating(true);
    const r = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newTitle.trim() || undefined,
        description: newDescription.trim(),
        crashReport: newCrash.trim() || undefined,
        category: newCategory,
        urgency: newUrgency,
      }),
    });
    if (r.ok && newPhotos.length > 0) {
      const ticket = await r.json();
      const fd = new FormData();
      for (const f of newPhotos) fd.append("photos", f);
      await fetch(`/api/tickets/${ticket.id}/photos`, { method: "POST", body: fd });
    }
    setCreating(false);
    closeCreate();
    load();
  }

  function openEdit(t: Ticket) {
    setEditTicket(t);
    setEditTitle(t.title ?? "");
    setEditDescription(t.description);
    setEditCrash(t.crashReport ?? "");
    setEditCategory(t.category);
    setEditUrgency(t.urgency ?? "NORMAL");
  }

  async function saveEdit() {
    if (!editTicket) return;
    setSaving(true);
    await fetch(`/api/tickets/${editTicket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editTitle.trim() || undefined,
        description: editDescription.trim(),
        crashReport: editCrash.trim() || undefined,
        category: editCategory,
        urgency: editUrgency,
      }),
    });
    setSaving(false);
    setEditTicket(null);
    load();
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setNewPhotos(prev => [...prev, ...files].slice(0, 10));
    e.target.value = "";
  }

  async function bump(id: string) {
    await fetch(`/api/tickets/${id}/bump`, { method: "POST" });
    load();
  }
  async function inProgress(id: string) {
    await fetch(`/api/tickets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "IN_PROGRESS" }) });
    load();
  }
  async function resolve(id: string, resolveComment?: string) {
    await fetch(`/api/tickets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "RESOLVED", ...(resolveComment ? { resolveComment } : {}) }) });
    load();
  }
  async function duplicate(id: string, originalId: string) {
    await fetch(`/api/tickets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "DUPLICATE", duplicateOf: originalId }) });
    load();
  }
  async function reopen(id: string) {
    await fetch(`/api/tickets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "OPEN", duplicateOf: null }) });
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

  // Shared form for create / edit modal
  return (
    <div>
      {/* ── Filter bar ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {/* Row 1: search + create */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              placeholder="Поиск… (CRH-001, текст)"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={() => setShowCreate(true)} style={{ flexShrink: 0, padding: "9px 16px" }}>
            + Новый
          </button>
        </div>

        {/* Row 2: status chips + category select + sort */}
        <div className="filter-row2" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="chip-scroll" style={{ flex: 1 }}>
            <button type="button" className={"tag-btn" + (!status ? " active" : "")} onClick={() => setStatus("")}>Все</button>
            {STATUS_FILTERS.map(s => (
              <button key={s.value} type="button" className={"tag-btn" + (status === s.value ? " active" : "")} onClick={() => setStatus(s.value)}>
                {s.label}
              </button>
            ))}
          </div>
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setPage(1); }}
            style={{ width: "auto", minWidth: 0, padding: "6px 28px 6px 10px", fontSize: 13, flexShrink: 0 }}
          >
            <option value="">Все категории</option>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <div className="sort-toggle" style={{ flexShrink: 0 }}>
            <button type="button" className={sort === "bumps" ? "active" : ""} onClick={() => setSort("bumps")}>↑ Bumps</button>
            <button type="button" className={sort === "date" ? "active" : ""} onClick={() => setSort("date")}>Дата</button>
            <button type="button" className={sort === "urgency" ? "active" : ""} onClick={() => setSort("urgency")}>🔴 Срочность</button>
          </div>
          <button className="btn-ghost" onClick={load} disabled={loading} style={{ padding: "5px 10px", minHeight: 32, flexShrink: 0, fontSize: 16 }} title="Обновить">
            {loading ? "…" : "↻"}
          </button>
        </div>
      </div>

      {/* ── Ticket count ── */}
      {!loading && (
        <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 12 }}>
          {tickets.length > 0 ? `${tickets.length} тикет${tickets.length === 1 ? "" : tickets.length < 5 ? "а" : "ов"}` : "Тикетов нет"}
        </p>
      )}
      {loading && <p style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 12 }}>Загрузка…</p>}

      {/* ── List ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pageTickets.map(t => (
          <TicketCard
            key={t.id}
            ticket={t}
            isAdmin={isAdmin}
            currentUsername={user?.username}
            onBump={bump}
            onInProgress={inProgress}
            onResolve={resolve}
            onReopen={reopen}
            onDuplicate={duplicate}
            onDelete={del}
            onPhotoDelete={isAdmin ? deletePhoto : undefined}
            onEdit={openEdit}
          />
        ))}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn-ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: "6px 14px" }}>←</button>
          <span style={{ fontSize: 13, color: "var(--text-2)", minWidth: 60, textAlign: "center" }}>{page} / {totalPages}</span>
          <button className="btn-ghost" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ padding: "6px 14px" }}>→</button>
        </div>
      )}

      {/* ── Create modal ── */}
      {showCreate && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) closeCreate(); }}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Новый тикет</span>
              <button className="btn-ghost" onClick={closeCreate} style={{ padding: "4px 10px", minHeight: 30 }}>✕</button>
            </div>

            <TicketForm
              title={newTitle} setTitle={setNewTitle}
              description={newDescription} setDescription={setNewDescription}
              crash={newCrash} setCrash={setNewCrash}
              cat={newCategory} setCat={setNewCategory}
              urgency={newUrgency} setUrgency={setNewUrgency}
              isCreate={true}
            />

            {/* Similar hint */}
            {(similarHintLoading || similarHint.length > 0) && (
              <div className="similar-hint">
                {similarHintLoading ? (
                  <span className="similar-hint-searching">🔍 Ищем похожие тикеты…</span>
                ) : (
                  <>
                    <span className="similar-hint-title">⚠️ Похожие тикеты — возможно, уже есть такой баг:</span>
                    <div className="similar-hint-list">
                      {similarHint.map(t => (
                        <div key={t.id} className="similar-hint-row">
                          <code className="similar-hint-tag">{t.tag ?? t.id.slice(0, 8)}</code>
                          <span className="similar-hint-desc">{(t.title || t.description).slice(0, 70)}{(t.title || t.description).length > 70 ? "…" : ""}</span>
                          <span className="similar-hint-bumps">↑{t.bumpCount}</span>
                          <button
                            className="btn-ghost similar-hint-bump"
                            onClick={() => bumpFromHint(t.id)}
                            disabled={bumpingHintId === t.id}
                          >
                            {bumpingHintId === t.id ? "…" : "Bump"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Photos */}
            <div className="field">
              <span className="field-label">Скриншоты <span>(до 10 фото)</span></span>
              <input ref={photoInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handlePhotoSelect} />
              {newPhotos.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {newPhotos.map((f, i) => {
                    const url = URL.createObjectURL(f);
                    return (
                      <div key={i} style={{ position: "relative" }}>
                        <img src={url} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} onLoad={() => URL.revokeObjectURL(url)} />
                        <button
                          onClick={() => setNewPhotos(p => p.filter((_, j) => j !== i))}
                          style={{ position: "absolute", top: -6, right: -6, background: "#dc2626", border: "none", borderRadius: "50%", width: 18, height: 18, color: "#fff", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "auto", padding: 0 }}
                        >✕</button>
                      </div>
                    );
                  })}
                </div>
              )}
              {newPhotos.length < 10 && (
                <button className="btn-ghost" type="button" onClick={() => photoInputRef.current?.click()} style={{ alignSelf: "flex-start", fontSize: 12, minHeight: 32 }}>
                  + Фото
                </button>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-ghost" onClick={closeCreate}>Отмена</button>
              <button className="btn-primary" onClick={createTicket} disabled={creating || !newTitle.trim()} style={{ padding: "8px 22px" }}>
                {creating ? "Создаём…" : "Создать"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit modal ── */}
      {editTicket && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setEditTicket(null); }}>
          <div className="modal">
            <div className="modal-header">
              <span className="modal-title">Редактировать</span>
              <button className="btn-ghost" onClick={() => setEditTicket(null)} style={{ padding: "4px 10px", minHeight: 30 }}>✕</button>
            </div>

            <TicketForm
              title={editTitle} setTitle={setEditTitle}
              description={editDescription} setDescription={setEditDescription}
              crash={editCrash} setCrash={setEditCrash}
              cat={editCategory} setCat={setEditCategory}
              urgency={editUrgency} setUrgency={setEditUrgency}
              isCreate={false}
            />

            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setEditTicket(null)}>Отмена</button>
              <button className="btn-primary" onClick={saveEdit} disabled={saving || !editDescription.trim()} style={{ padding: "8px 22px" }}>
                {saving ? "Сохраняем…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
