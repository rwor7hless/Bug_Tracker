import { useEffect, useState } from "react";

interface TicketPhoto { id: string; filename: string; order: number; }

interface Ticket {
  id: string; tag?: string | null; title?: string | null; description: string;
  crashReport?: string | null; resolveComment?: string | null;
  status: "OPEN" | "IN_PROGRESS" | "PATCH_PENDING" | "DUPLICATE" | "RESOLVED";
  category: string; urgency: "NORMAL" | "HIGH" | "CRITICAL";
  photosDeleted?: boolean;
  duplicateOf?: string | null; bumpCount: number;
  reportedBy: string; createdAt: string; photos?: TicketPhoto[];
}

interface Comment {
  id: string; body: string; createdAt: string;
  user: { username: string; role: string };
}

interface Props {
  ticket: Ticket; isAdmin: boolean; currentUsername?: string;
  onBump: (id: string) => void;
  onInProgress: (id: string) => void;
  onPatchPending: (id: string) => void;
  onResolve: (id: string, comment?: string) => void;
  onReopen: (id: string) => void;
  onDuplicate: (id: string, originalId: string) => void;
  onDelete: (id: string) => void;
  onPhotoDelete?: (ticketId: string, photoId: string) => void;
  onEdit?: (ticket: Ticket) => void;
}

const categoryLabel: Record<string, string> = {
  CRASH: "Краш", LAG: "Лаги", VISUAL: "Визуал",
  GAMEPLAY: "Геймплей", OTHER: "Другое", SUGGESTION: "Предложение",
};

const categoryIcon: Record<string, string> = {
  CRASH: "🔴", LAG: "⚡", VISUAL: "👁",
  GAMEPLAY: "🎮", OTHER: "📌", SUGGESTION: "💡",
};

const statusMeta: Record<string, { cls: string; text: string }> = {
  OPEN:          { cls: "badge-open",     text: "Открыт" },
  IN_PROGRESS:   { cls: "badge-progress", text: "В работе" },
  PATCH_PENDING: { cls: "badge-patch",    text: "В патче" },
  DUPLICATE:     { cls: "badge-dup",      text: "Дубликат" },
  RESOLVED:      { cls: "badge-resolved", text: "Решено" },
};

const urgencyMeta: Record<string, { label: string; color: string; icon: string } | null> = {
  NORMAL:   null,
  HIGH:     { label: "Высокий",   color: "#f59e0b", icon: "⚡" },
  CRITICAL: { label: "Критичный", color: "#ef4444", icon: "🔴" },
};

function CopyTag({ tag }: { tag: string }) {
  const [copied, setCopied] = useState(false);
  function copy(e: React.MouseEvent) {
    e.stopPropagation();
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1200); };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(tag).then(done).catch(fallback);
    } else { fallback(); }
    function fallback() {
      const el = document.createElement("textarea");
      el.value = tag; el.style.cssText = "position:fixed;top:-9999px;left:-9999px";
      document.body.appendChild(el); el.select(); document.execCommand("copy");
      document.body.removeChild(el); done();
    }
  }
  return (
    <span onClick={copy} title="Нажми, чтобы скопировать" style={{ fontFamily: "monospace", color: copied ? "var(--text-3)" : "var(--accent)", fontWeight: 700, cursor: "pointer", userSelect: "none", fontSize: 12, transition: "color 0.15s" }}>
      {copied ? "✓ скопировано" : tag}
    </span>
  );
}

function PhotoCarousel({ photos, isAdmin, onDelete }: { photos: TicketPhoto[]; isAdmin: boolean; onDelete?: (id: string) => void }) {
  const [current, setCurrent] = useState(0);
  if (!photos.length) return null;
  const photo = photos[current];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ position: "relative", background: "#0a0a0a", borderRadius: "var(--radius)", overflow: "hidden", border: "1px solid var(--border)" }}>
        <img src={`/uploads/${photo.filename}`} alt={`Скриншот ${current + 1}`} style={{ width: "100%", maxHeight: 360, objectFit: "contain", display: "block" }} />
        {photos.length > 1 && (
          <>
            <button onClick={() => setCurrent(c => Math.max(0, c - 1))} disabled={current === 0}
              style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.65)", border: "none", borderRadius: "50%", width: 36, height: 36, color: "#fff", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", opacity: current === 0 ? 0.25 : 1, minHeight: "auto", padding: 0 }}>‹</button>
            <button onClick={() => setCurrent(c => Math.min(photos.length - 1, c + 1))} disabled={current === photos.length - 1}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.65)", border: "none", borderRadius: "50%", width: 36, height: 36, color: "#fff", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", opacity: current === photos.length - 1 ? 0.25 : 1, minHeight: "auto", padding: 0 }}>›</button>
          </>
        )}
        <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 11, padding: "2px 8px", borderRadius: 10 }}>
          {current + 1} / {photos.length}
        </div>
        {isAdmin && onDelete && (
          <button onClick={() => { if (confirm("Удалить фото?")) { onDelete(photo.id); setCurrent(c => Math.min(c, photos.length - 2)); } }}
            style={{ position: "absolute", top: 8, right: 8, background: "rgba(220,38,38,0.9)", border: "none", borderRadius: 6, color: "#fff", fontSize: 11, padding: "3px 8px", cursor: "pointer", minHeight: "auto" }}>
            Удалить
          </button>
        )}
      </div>
      {photos.length > 1 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
          {photos.map((p, i) => (
            <img key={p.id} src={`/uploads/${p.filename}`} alt="" onClick={() => setCurrent(i)}
              style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 4, cursor: "pointer", border: i === current ? "2px solid var(--accent)" : "2px solid transparent", flexShrink: 0, opacity: i === current ? 1 : 0.55, transition: "opacity 0.13s, border-color 0.13s" }} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TicketCard({ ticket, isAdmin, currentUsername, onBump, onInProgress, onPatchPending, onResolve, onReopen, onDuplicate, onDelete, onPhotoDelete, onEdit }: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const [showCrash, setShowCrash] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [dupId, setDupId] = useState("");
  const [resolvingComment, setResolvingComment] = useState(false);
  const [resolveComment, setResolveComment] = useState("");

  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  useEffect(() => {
    if (!showDetail) return;
    setCommentsLoaded(false);
    fetch(`/api/tickets/${ticket.id}/comments`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setComments(data); setCommentsLoaded(true); });
  }, [showDetail, ticket.id]);

  async function postComment() {
    if (!newComment.trim()) return;
    setPostingComment(true);
    const r = await fetch(`/api/tickets/${ticket.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newComment.trim() }),
    });
    if (r.ok) { const c = await r.json(); setComments(prev => [...prev, c]); setNewComment(""); }
    setPostingComment(false);
  }

  const date = new Date(ticket.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  const photos = ticket.photos ?? [];
  const isLink = ticket.crashReport?.startsWith("http");
  const isFile = ticket.crashReport?.startsWith("[Файл");
  const hasTextLog = ticket.crashReport && !isLink && !isFile;
  const { cls: statusClass, text: statusText } = statusMeta[ticket.status] ?? { cls: "badge-open", text: ticket.status };
  const displayTitle = ticket.title || ticket.description.slice(0, 100);
  const urgency = urgencyMeta[ticket.urgency];

  function downloadLog() {
    if (!hasTextLog) return;
    const blob = new Blob([ticket.crashReport!], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `log-${ticket.id.slice(0, 8)}.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  const isActive = ticket.status === "OPEN" || ticket.status === "IN_PROGRESS" || ticket.status === "PATCH_PENDING";
  const canEdit = isAdmin || ticket.reportedBy === currentUsername;

  return (
    <>
      <div className="card" style={{ display: "flex", flexDirection: "column" }}>

        {/* ── Clickable body ── */}
        <div className="card-body" onClick={() => setShowDetail(true)}>
          {/* Photo thumbnails */}
          {photos.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {photos.slice(0, 3).map((p, i) => (
                <div key={p.id} style={{ position: "relative" }}>
                  <img src={`/uploads/${p.filename}`} alt="" style={{ width: 64, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} />
                  {i === 2 && photos.length > 3 && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}>
                      +{photos.length - 3}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Title row */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                {urgency && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: urgency.color, background: `${urgency.color}18`, padding: "2px 7px", borderRadius: 10, whiteSpace: "nowrap" }}>
                    {urgency.icon} {urgency.label}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", lineHeight: 1.45, marginBottom: ticket.title ? 5 : 0 }}>
                {displayTitle}
              </p>
              {ticket.title && (
                <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                  {ticket.description.length > 120 ? ticket.description.slice(0, 120) + "…" : ticket.description}
                </p>
              )}
              {ticket.resolveComment && (
                <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 6, padding: "6px 10px", background: "var(--surface2)", borderRadius: "var(--radius)", borderLeft: "3px solid var(--accent)" }}>
                  <span style={{ color: "var(--text-3)" }}>Решение: </span>{ticket.resolveComment}
                </p>
              )}
            </div>

            {/* Status + category */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
              <span className={`badge ${statusClass}`}>{statusText}</span>
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                {categoryIcon[ticket.category]} {categoryLabel[ticket.category] ?? ticket.category}
              </span>
            </div>
          </div>

          {/* Meta row */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 10, fontSize: 12, color: "var(--text-3)" }}>
            <CopyTag tag={ticket.tag ?? "#" + ticket.id.slice(0, 8)} />
            <span>·</span>
            <span>{ticket.reportedBy}</span>
            <span>·</span>
            <span>{date}</span>
            {photos.length > 0 && <><span>·</span><span>📷 {photos.length}</span></>}
            {photos.length === 0 && ticket.photosDeleted && <><span>·</span><span style={{ color: "var(--text-3)", fontStyle: "italic" }}>📷 удалены</span></>}
            <span style={{ marginLeft: "auto", background: "var(--accent-dim)", borderRadius: 6, padding: "3px 10px", color: "var(--accent)", fontWeight: 700, fontSize: 12, border: "1px solid rgba(224,154,58,0.2)" }}>
              🔥 {ticket.bumpCount}
            </span>
          </div>
        </div>

        {/* ── Action footer ── */}
        <div className="card-footer">
          <button className="btn-ghost" style={{ fontSize: 12, minHeight: 32, padding: "5px 12px" }} onClick={() => setShowDetail(true)}>
            Открыть
          </button>
          {canEdit && (
            <button className="btn-ghost" style={{ fontSize: 12, minHeight: 32, padding: "5px 12px" }} onClick={() => onEdit?.(ticket)}>
              ✏ Изменить
            </button>
          )}
          {isActive && (
            <button className="btn-ghost" style={{ fontSize: 12, minHeight: 32, padding: "5px 12px" }} onClick={() => onBump(ticket.id)}>
              ↑ Bump
            </button>
          )}
        </div>

        {/* ── Admin bar ── */}
        {isAdmin && (
          <div className="admin-bar">
            {ticket.status === "OPEN" && (
              <>
                <button className="btn-blue" style={{ fontSize: 12, minHeight: 30, padding: "4px 12px" }} onClick={() => onInProgress(ticket.id)}>В работу</button>
                <button className="btn-success" style={{ fontSize: 12, minHeight: 30, padding: "4px 12px" }} onClick={() => setResolvingComment(v => !v)}>Решено ✓</button>
                <button className="btn-ghost" style={{ fontSize: 12, minHeight: 30, padding: "4px 12px" }} onClick={() => setDuplicating(v => !v)}>Дубликат</button>
              </>
            )}
            {ticket.status === "IN_PROGRESS" && (
              <>
                <button className="btn-patch" style={{ fontSize: 12, minHeight: 30, padding: "4px 12px" }} onClick={() => onPatchPending(ticket.id)}>📦 В патче</button>
                <button className="btn-success" style={{ fontSize: 12, minHeight: 30, padding: "4px 12px" }} onClick={() => setResolvingComment(v => !v)}>Решено ✓</button>
                <button className="btn-ghost" style={{ fontSize: 12, minHeight: 30, padding: "4px 12px" }} onClick={() => onReopen(ticket.id)}>↩ Вернуть</button>
              </>
            )}
            {ticket.status === "PATCH_PENDING" && (
              <>
                <button className="btn-success" style={{ fontSize: 12, minHeight: 30, padding: "4px 12px" }} onClick={() => setResolvingComment(v => !v)}>Решено ✓</button>
                <button className="btn-blue" style={{ fontSize: 12, minHeight: 30, padding: "4px 12px" }} onClick={() => onInProgress(ticket.id)}>↩ В работу</button>
              </>
            )}
            {(ticket.status === "RESOLVED" || ticket.status === "DUPLICATE") && (
              <button className="btn-ghost" style={{ fontSize: 12, minHeight: 30, padding: "4px 12px" }} onClick={() => onReopen(ticket.id)}>↩ Вернуть</button>
            )}
            <button className="btn-danger" style={{ fontSize: 12, minHeight: 30, padding: "4px 12px", marginLeft: "auto" }} onClick={() => onDelete(ticket.id)}>Удалить</button>
          </div>
        )}

        {/* ── Resolve comment inline ── */}
        {resolvingComment && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8, background: "var(--surface2)" }}>
            <label style={{ fontSize: 12, color: "var(--text-2)" }}>Комментарий к решению <span style={{ color: "var(--text-3)" }}>(необязательно)</span></label>
            <textarea placeholder="Опиши решение…" value={resolveComment} onChange={e => setResolveComment(e.target.value)} rows={2} style={{ fontSize: 13 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-success" style={{ fontSize: 13 }} onClick={() => { onResolve(ticket.id, resolveComment.trim() || undefined); setResolvingComment(false); setResolveComment(""); }}>Закрыть тикет</button>
              <button className="btn-ghost" style={{ fontSize: 13 }} onClick={() => { setResolvingComment(false); setResolveComment(""); }}>Отмена</button>
            </div>
          </div>
        )}

        {/* ── Duplicate input inline ── */}
        {duplicating && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, background: "var(--surface2)" }}>
            <input placeholder="Тег (BUG-001) или ID тикета" value={dupId} onChange={e => setDupId(e.target.value)} style={{ fontSize: 13, flex: 1 }} />
            <button className="btn-primary" style={{ fontSize: 13, minHeight: 36 }} onClick={() => { if (dupId.trim()) { onDuplicate(ticket.id, dupId.trim()); setDuplicating(false); setDupId(""); } }}>OK</button>
            <button className="btn-ghost" style={{ fontSize: 13, minHeight: 36 }} onClick={() => { setDuplicating(false); setDupId(""); }}>✕</button>
          </div>
        )}
      </div>

      {/* ── Detail modal ── */}
      {showDetail && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowDetail(false); }}>
          <div className="modal modal-wide">
            <div className="modal-header">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                  <span className={`badge ${statusClass}`}>{statusText}</span>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>{categoryIcon[ticket.category]} {categoryLabel[ticket.category] ?? ticket.category}</span>
                  {urgency && <span style={{ fontSize: 11, fontWeight: 700, color: urgency.color }}>{urgency.icon} {urgency.label}</span>}
                  <CopyTag tag={ticket.tag ?? "#" + ticket.id.slice(0, 8)} />
                </div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.4 }}>{ticket.title || "Тикет #" + ticket.id.slice(0, 8)}</h2>
                <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>{ticket.reportedBy} · {date} · ↑ {ticket.bumpCount}</p>
              </div>
              <button className="btn-ghost" onClick={() => setShowDetail(false)} style={{ padding: "4px 10px", minHeight: 30, marginLeft: 12, alignSelf: "flex-start" }}>✕</button>
            </div>

            {/* Description */}
            <div>
              <p className="section-label" style={{ marginBottom: 6 }}>Описание</p>
              <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{ticket.description}</p>
            </div>

            {/* Photos */}
            {photos.length > 0 && (
              <div>
                <p className="section-label" style={{ marginBottom: 8 }}>Скриншоты ({photos.length})</p>
                <PhotoCarousel photos={photos} isAdmin={isAdmin} onDelete={onPhotoDelete ? (photoId) => onPhotoDelete(ticket.id, photoId) : undefined} />
              </div>
            )}

            {/* Log */}
            {ticket.crashReport && (
              <div>
                <p className="section-label" style={{ marginBottom: 6 }}>Лог</p>
                {isLink ? (
                  <a href={ticket.crashReport} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "var(--accent)" }}>↗ Открыть лог</a>
                ) : isFile ? (
                  <span style={{ fontSize: 13, color: "var(--text-3)" }}>{ticket.crashReport}</span>
                ) : (
                  <div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                      <button className="btn-ghost" style={{ fontSize: 12, minHeight: 30, padding: "4px 10px" }} onClick={() => setShowCrash(v => !v)}>
                        {showCrash ? "Скрыть" : "Показать лог"}
                      </button>
                      <button className="btn-ghost" style={{ fontSize: 12, minHeight: 30, padding: "4px 10px" }} onClick={downloadLog}>↓ .txt</button>
                    </div>
                    {showCrash && (
                      <pre style={{ background: "#111", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 12, fontSize: 11, lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 260, overflowY: "auto", color: "var(--text-2)" }}>
                        {ticket.crashReport}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Resolve comment */}
            {ticket.resolveComment && (
              <div>
                <p className="section-label" style={{ marginBottom: 6 }}>Комментарий к решению</p>
                <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7, padding: "10px 12px", background: "var(--surface2)", borderRadius: "var(--radius)", borderLeft: "3px solid var(--accent)" }}>
                  {ticket.resolveComment}
                </p>
              </div>
            )}

            {ticket.duplicateOf && (
              <p style={{ fontSize: 12, color: "var(--text-3)" }}>Дубликат тикета <span style={{ fontFamily: "monospace", color: "var(--text-2)" }}>{ticket.duplicateOf}</span></p>
            )}

            {/* Comments */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
              <p className="section-label" style={{ marginBottom: 10 }}>Комментарии {commentsLoaded ? `(${comments.length})` : ""}</p>

              {!commentsLoaded && <p style={{ fontSize: 13, color: "var(--text-3)" }}>Загрузка…</p>}
              {commentsLoaded && comments.length === 0 && <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 10 }}>Комментариев нет.</p>}

              {commentsLoaded && comments.map(c => (
                <div key={c.id} className={`comment${c.user.role === "ADMIN" ? " is-admin" : ""}`}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{c.user.username}</span>
                    {c.user.role === "ADMIN" && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", background: "var(--accent-dim)", padding: "1px 5px", borderRadius: 4 }}>АДМ</span>}
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {new Date(c.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{c.body}</p>
                </div>
              ))}

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <textarea
                  placeholder="Написать комментарий…"
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) postComment(); }}
                  rows={2}
                  style={{ flex: 1, fontSize: 13 }}
                />
                <button
                  className="btn-primary"
                  onClick={postComment}
                  disabled={postingComment || !newComment.trim()}
                  style={{ alignSelf: "flex-end", fontSize: 12, padding: "8px 14px", minHeight: 36 }}
                  title="Ctrl+Enter"
                >
                  {postingComment ? "…" : "↑ Отправить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
