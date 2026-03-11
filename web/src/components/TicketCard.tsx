import { useState } from "react";

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
  photos?: TicketPhoto[];
}

interface Props {
  ticket: Ticket;
  isAdmin: boolean;
  onBump: (id: string) => void;
  onInProgress: (id: string) => void;
  onResolve: (id: string, comment?: string) => void;
  onReopen: (id: string) => void;
  onDuplicate: (id: string, originalId: string) => void;
  onDelete: (id: string) => void;
  onPhotoDelete?: (ticketId: string, photoId: string) => void;
}

const categoryLabel: Record<string, string> = {
  CRASH:    "Краш",
  LAG:      "Лаги",
  VISUAL:   "Визуал",
  GAMEPLAY: "Геймплей",
  OTHER:    "Другое",
};

const statusMeta: Record<string, { cls: string; text: string }> = {
  OPEN:        { cls: "badge-open",     text: "Открыт" },
  IN_PROGRESS: { cls: "badge-progress", text: "В работе" },
  DUPLICATE:   { cls: "badge-dup",      text: "Дубликат" },
  RESOLVED:    { cls: "badge-resolved", text: "Решено" },
};

function CopyTag({ tag }: { tag: string }) {
  const [copied, setCopied] = useState(false);

  function copy(e: React.MouseEvent) {
    e.stopPropagation();
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1200); };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(tag).then(done).catch(() => fallback());
    } else {
      fallback();
    }
    function fallback() {
      const el = document.createElement("textarea");
      el.value = tag;
      el.style.cssText = "position:fixed;top:-9999px;left:-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      done();
    }
  }

  return (
    <span
      onClick={copy}
      title="Нажми, чтобы скопировать"
      style={{
        fontFamily: "monospace",
        color: copied ? "var(--text-2)" : "var(--accent)",
        fontWeight: 600,
        cursor: "pointer",
        userSelect: "none",
        transition: "color 0.15s",
      }}
    >
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
      {/* Main image */}
      <div style={{ position: "relative", background: "#0a0a0a", borderRadius: "var(--radius)", overflow: "hidden", border: "1px solid var(--border)" }}>
        <img
          src={`/uploads/${photo.filename}`}
          alt={`Скриншот ${current + 1}`}
          style={{
            width: "100%",
            maxHeight: 360,
            objectFit: "contain",
            display: "block",
          }}
        />
        {photos.length > 1 && (
          <>
            <button
              onClick={() => setCurrent(c => Math.max(0, c - 1))}
              disabled={current === 0}
              style={{
                position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
                background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%",
                width: 32, height: 32, cursor: "pointer", color: "#fff", fontSize: 16,
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: current === 0 ? 0.3 : 1,
              }}
            >‹</button>
            <button
              onClick={() => setCurrent(c => Math.min(photos.length - 1, c + 1))}
              disabled={current === photos.length - 1}
              style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%",
                width: 32, height: 32, cursor: "pointer", color: "#fff", fontSize: 16,
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: current === photos.length - 1 ? 0.3 : 1,
              }}
            >›</button>
          </>
        )}
        <div style={{
          position: "absolute", bottom: 8, right: 8,
          background: "rgba(0,0,0,0.6)", color: "#fff",
          fontSize: 11, padding: "2px 8px", borderRadius: 10,
        }}>
          {current + 1} / {photos.length}
        </div>
        {isAdmin && onDelete && (
          <button
            onClick={() => {
              if (confirm("Удалить фото?")) {
                onDelete(photo.id);
                setCurrent(c => Math.min(c, photos.length - 2));
              }
            }}
            style={{
              position: "absolute", top: 8, right: 8,
              background: "rgba(220,50,50,0.85)", border: "none", borderRadius: 4,
              color: "#fff", fontSize: 11, padding: "3px 8px", cursor: "pointer",
            }}
          >
            Удалить
          </button>
        )}
      </div>

      {/* Thumbnail strip */}
      {photos.length > 1 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
          {photos.map((p, i) => (
            <img
              key={p.id}
              src={`/uploads/${p.filename}`}
              alt=""
              onClick={() => setCurrent(i)}
              style={{
                width: 52, height: 52, objectFit: "cover", borderRadius: 4, cursor: "pointer",
                border: i === current ? "2px solid var(--accent)" : "2px solid transparent",
                flexShrink: 0, opacity: i === current ? 1 : 0.6,
                transition: "opacity 0.15s, border-color 0.15s",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TicketCard({ ticket, isAdmin, onBump, onInProgress, onResolve, onReopen, onDuplicate, onDelete, onPhotoDelete }: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const [showCrash, setShowCrash] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [dupId, setDupId] = useState("");
  const [resolvingComment, setResolvingComment] = useState(false);
  const [resolveComment, setResolveComment] = useState("");

  const date = new Date(ticket.createdAt).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  const isLink = ticket.crashReport?.startsWith("http");
  const isFile = ticket.crashReport?.startsWith("[Файл");
  const hasTextLog = ticket.crashReport && !isLink && !isFile;
  const photos = ticket.photos ?? [];

  function downloadLog() {
    if (!hasTextLog) return;
    const blob = new Blob([ticket.crashReport!], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `log-${ticket.id.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const { cls: statusClass, text: statusText } = statusMeta[ticket.status] ?? { cls: "badge-open", text: ticket.status };
  const displayTitle = ticket.title || ticket.description.slice(0, 80);

  return (
    <>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Photo strip on card (max 3 thumbnails) */}
        {photos.length > 0 && (
          <div style={{ display: "flex", gap: 6, cursor: "pointer" }} onClick={() => setShowDetail(true)}>
            {photos.slice(0, 3).map((p, i) => (
              <div key={p.id} style={{ position: "relative" }}>
                <img
                  src={`/uploads/${p.filename}`}
                  alt=""
                  style={{ width: 64, height: 48, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border)" }}
                />
                {i === 2 && photos.length > 3 && (
                  <div style={{
                    position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)",
                    borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#fff", fontSize: 12, fontWeight: 600,
                  }}>
                    +{photos.length - 3}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: ticket.title ? 4 : 0 }}>
              {displayTitle}
            </p>
            {ticket.title && (
              <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                {ticket.description.length > 120 ? ticket.description.slice(0, 120) + "…" : ticket.description}
              </p>
            )}
            {ticket.duplicateOf && (
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
                Дубликат тикета <span style={{ fontFamily: "monospace" }}>{ticket.duplicateOf}</span>
              </p>
            )}
            {ticket.resolveComment && (
              <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 6, padding: "6px 10px", background: "var(--surface2)", borderRadius: "var(--radius)", borderLeft: "3px solid var(--accent)" }}>
                <span style={{ color: "var(--text-3)" }}>Решение: </span>{ticket.resolveComment}
              </p>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
            <span className={`badge ${statusClass}`}>{statusText}</span>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>{categoryLabel[ticket.category] ?? ticket.category}</span>
          </div>
        </div>

        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          fontSize: 12,
          color: "var(--text-3)",
          borderTop: "1px solid var(--border)",
          paddingTop: 10,
        }}>
          <CopyTag tag={ticket.tag ?? "#" + ticket.id.slice(0, 8)} />
          <span>·</span>
          <span>{ticket.reportedBy}</span>
          <span>·</span>
          <span>{date}</span>
          {photos.length > 0 && (
            <>
              <span>·</span>
              <span style={{ color: "var(--text-3)" }}>📷 {photos.length}</span>
            </>
          )}
          <span style={{
            marginLeft: "auto",
            background: "var(--surface2)",
            borderRadius: 4,
            padding: "2px 8px",
            color: "var(--text-2)",
            fontSize: 12,
          }}>
            ↑ {ticket.bumpCount}
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowDetail(true)}>
            Подробнее
          </button>
          {ticket.status !== "RESOLVED" && (
            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => onBump(ticket.id)}>
              ↑ Bump
            </button>
          )}
          {isAdmin && ticket.status === "OPEN" && (
            <>
              <button
                className="btn-ghost"
                style={{ fontSize: 12, color: "#3b82f6", borderColor: "#3b82f6" }}
                onClick={() => onInProgress(ticket.id)}
              >
                В работу
              </button>
              <button className="btn-success" style={{ fontSize: 12 }} onClick={() => setResolvingComment(true)}>
                Решено
              </button>
              <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setDuplicating((v) => !v)}>
                Дубликат
              </button>
            </>
          )}
          {isAdmin && ticket.status === "IN_PROGRESS" && (
            <>
              <button className="btn-success" style={{ fontSize: 12 }} onClick={() => setResolvingComment(true)}>
                Решено
              </button>
              <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => onReopen(ticket.id)}>
                Вернуть в открытые
              </button>
            </>
          )}
          {isAdmin && (ticket.status === "RESOLVED" || ticket.status === "DUPLICATE") && (
            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => onReopen(ticket.id)}>
              Вернуть в активные
            </button>
          )}
          {isAdmin && (
            <button className="btn-danger" style={{ fontSize: 12 }} onClick={() => onDelete(ticket.id)}>
              Удалить
            </button>
          )}
        </div>

        {resolvingComment && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--text-2)" }}>Комментарий к решению <span style={{ color: "var(--text-3)" }}>(необязательно)</span></label>
            <textarea
              placeholder="Опиши как решился баг или что нужно сделать игроку…"
              value={resolveComment}
              onChange={(e) => setResolveComment(e.target.value)}
              rows={2}
              style={{ fontSize: 13 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn-success"
                style={{ fontSize: 13 }}
                onClick={() => {
                  onResolve(ticket.id, resolveComment.trim() || undefined);
                  setResolvingComment(false);
                  setResolveComment("");
                }}
              >
                Закрыть тикет
              </button>
              <button className="btn-ghost" style={{ fontSize: 13 }} onClick={() => { setResolvingComment(false); setResolveComment(""); }}>
                Отмена
              </button>
            </div>
          </div>
        )}

        {duplicating && (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              placeholder="Тег (BUG-001) или ID тикета"
              value={dupId}
              onChange={(e) => setDupId(e.target.value)}
              style={{ flex: 1, fontSize: 13 }}
            />
            <button
              className="btn-primary"
              style={{ fontSize: 13 }}
              onClick={() => {
                if (dupId.trim()) {
                  onDuplicate(ticket.id, dupId.trim());
                  setDuplicating(false);
                  setDupId("");
                }
              }}
            >
              OK
            </button>
          </div>
        )}
      </div>

      {showDetail && (
        <div
          className="modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDetail(false); }}
        >
          <div className="modal" style={{ maxWidth: 680 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span className="modal-title">{ticket.title || "Тикет #" + ticket.id.slice(0, 8)}</span>
              <button className="btn-ghost" onClick={() => setShowDetail(false)} style={{ padding: "4px 10px" }}>✕</button>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <span className={`badge ${statusClass}`}>{statusText}</span>
              <span style={{ fontSize: 12, color: "var(--text-3)", lineHeight: "22px" }}>{categoryLabel[ticket.category] ?? ticket.category}</span>
              <CopyTag tag={ticket.tag ?? "#" + ticket.id.slice(0, 8)} />
              <span style={{ fontSize: 12, color: "var(--text-3)", lineHeight: "22px" }}>{ticket.reportedBy} · {date}</span>
              <span style={{ fontSize: 12, color: "var(--text-3)", lineHeight: "22px" }}>↑ {ticket.bumpCount}</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Описание</p>
                <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{ticket.description}</p>
              </div>

              {photos.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Скриншоты ({photos.length})
                  </p>
                  <PhotoCarousel
                    photos={photos}
                    isAdmin={isAdmin}
                    onDelete={onPhotoDelete ? (photoId) => onPhotoDelete(ticket.id, photoId) : undefined}
                  />
                </div>
              )}

              {ticket.crashReport && (
                <div>
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Лог</p>
                  {isLink ? (
                    <a
                      href={ticket.crashReport}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 13, color: "var(--accent)" }}
                    >
                      Открыть лог
                    </a>
                  ) : isFile ? (
                    <span style={{ fontSize: 13, color: "var(--text-3)" }}>{ticket.crashReport}</span>
                  ) : (
                    <div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                        <button
                          className="btn-ghost"
                          style={{ fontSize: 12, padding: "4px 10px" }}
                          onClick={() => setShowCrash((v) => !v)}
                        >
                          {showCrash ? "Скрыть лог" : "Показать лог"}
                        </button>
                        <button
                          className="btn-ghost"
                          style={{ fontSize: 12, padding: "4px 10px" }}
                          onClick={downloadLog}
                        >
                          ↓ Скачать .txt
                        </button>
                      </div>
                      {showCrash && (
                        <pre style={{
                          background: "#111",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                          padding: 12,
                          fontSize: 11,
                          lineHeight: 1.6,
                          overflowX: "auto",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          maxHeight: 280,
                          overflowY: "auto",
                          color: "var(--text-2)",
                        }}>
                          {ticket.crashReport}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}

              {ticket.resolveComment && (
                <div>
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Комментарий к решению</p>
                  <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7, padding: "8px 12px", background: "var(--surface2)", borderRadius: "var(--radius)", borderLeft: "3px solid var(--accent)" }}>
                    {ticket.resolveComment}
                  </p>
                </div>
              )}

              {ticket.duplicateOf && (
                <p style={{ fontSize: 12, color: "var(--text-3)" }}>
                  Дубликат тикета <span style={{ fontFamily: "monospace" }}>{ticket.duplicateOf}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
