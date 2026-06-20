"use client";

/**
 * CommunityAdmin — staff surface to publish + moderate community posts
 * (RF-CLI-055 "escritura solo staff"; DOC plan 7d "moderación staff"). Create
 * text/video/live posts and toggle their published state. Boundary-clean: the
 * server actions are injected by the app layer.
 */

import * as React from "react";

type AR<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };

export interface AdminPostVM {
  id: string;
  kind: string;
  body: string | null;
  authorDisplay: string | null;
  authorStaffId: string | null;
  isPublished: boolean;
  liveStartsAt: string | null;
  createdAt: string;
}

export interface RawAdminActions {
  create: (input: {
    kind: string;
    body?: string | null;
    videoUrl?: string | null;
    authorDisplay?: string | null;
    liveStartsAt?: string | null;
    liveJoinUrl?: string | null;
    asTestimonial?: boolean;
  }) => Promise<AR<{ id: string }>>;
  setPublished: (postId: string, published: boolean) => Promise<AR<void>>;
  reload: (opts: { cursor?: string }) => Promise<AR<{ posts: AdminPostVM[]; nextCursor: string | null }>>;
}

export interface CommunityAdminProps {
  locale: "es" | "en";
  initialPosts: AdminPostVM[];
  actions: RawAdminActions;
}

function tt(locale: "es" | "en", es: string, en: string) {
  return locale === "es" ? es : en;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)",
  background: "var(--bg, #fff)", color: "var(--ink)", fontSize: 14, fontFamily: "inherit",
};
const labelStyle: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "var(--ink-2)", marginBottom: 4, display: "block" };

export function CommunityAdmin({ locale, initialPosts, actions }: CommunityAdminProps) {
  const [posts, setPosts] = React.useState<AdminPostVM[]>(initialPosts);
  const [kind, setKind] = React.useState("text");
  const [body, setBody] = React.useState("");
  const [authorDisplay, setAuthorDisplay] = React.useState("");
  const [videoUrl, setVideoUrl] = React.useState("");
  const [liveStartsAt, setLiveStartsAt] = React.useState("");
  const [liveJoinUrl, setLiveJoinUrl] = React.useState("");
  const [asTestimonial, setAsTestimonial] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function refresh() {
    const r = await actions.reload({});
    if (r.success) setPosts(r.data.posts);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await actions.create({
      kind,
      body: body.trim() || null,
      videoUrl: kind === "video" ? videoUrl.trim() || null : null,
      authorDisplay: authorDisplay.trim() || null,
      liveStartsAt: kind === "live" && liveStartsAt ? new Date(liveStartsAt).toISOString() : null,
      liveJoinUrl: kind === "live" ? liveJoinUrl.trim() || null : null,
      asTestimonial,
    });
    setBusy(false);
    if (res.success) {
      setBody(""); setVideoUrl(""); setLiveStartsAt(""); setLiveJoinUrl(""); setAuthorDisplay("");
      setMsg(tt(locale, "Publicación creada.", "Post created."));
      await refresh();
    } else {
      setMsg(`${tt(locale, "Error", "Error")}: ${res.error.code}`);
    }
  }

  async function togglePublished(p: AdminPostVM) {
    const next = !p.isPublished;
    setPosts((prev) => prev.map((x) => (x.id === p.id ? { ...x, isPublished: next } : x)));
    const res = await actions.setPublished(p.id, next);
    if (!res.success) setPosts((prev) => prev.map((x) => (x.id === p.id ? { ...x, isPublished: !next } : x)));
  }

  return (
    <div style={{ padding: "24px 28px 60px", maxWidth: 820 }}>
      <h1 style={{ fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 24, color: "var(--ink)", margin: "0 0 4px" }}>
        {tt(locale, "Comunidad", "Community")}
      </h1>
      <p style={{ color: "var(--ink-3)", fontSize: 14, margin: "0 0 20px" }}>
        {tt(locale, "Publica y modera el feed de la comunidad.", "Publish and moderate the community feed.")}
      </p>

      {/* Create */}
      <form onSubmit={handleCreate} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, padding: 18, marginBottom: 24, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{tt(locale, "Tipo", "Kind")}</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={inputStyle}>
              <option value="text">{tt(locale, "Texto", "Text")}</option>
              <option value="video">{tt(locale, "Video", "Video")}</option>
              <option value="live">{tt(locale, "En vivo", "Live")}</option>
            </select>
          </div>
          <div style={{ flex: 2 }}>
            <label style={labelStyle}>{tt(locale, "Autor a mostrar", "Author display")}</label>
            <input value={authorDisplay} onChange={(e) => setAuthorDisplay(e.target.value)}
              placeholder={tt(locale, "Henry Gómez · X Legal", "Henry Gómez · X Legal")} style={inputStyle} />
          </div>
        </div>

        <div>
          <label style={labelStyle}>{tt(locale, "Mensaje", "Body")}</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        </div>

        {kind === "video" && (
          <div>
            <label style={labelStyle}>{tt(locale, "URL del video (embed)", "Video URL (embed)")}</label>
            <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.youtube.com/embed/…" style={inputStyle} />
          </div>
        )}

        {kind === "live" && (
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{tt(locale, "Inicia (fecha y hora)", "Starts at")}</label>
              <input type="datetime-local" value={liveStartsAt} onChange={(e) => setLiveStartsAt(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{tt(locale, "URL para unirse", "Join URL")}</label>
              <input value={liveJoinUrl} onChange={(e) => setLiveJoinUrl(e.target.value)} placeholder="https://…" style={inputStyle} />
            </div>
          </div>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--ink-2)" }}>
          <input type="checkbox" checked={asTestimonial} onChange={(e) => setAsTestimonial(e.target.checked)} />
          {tt(locale, "Testimonio de cliente (sin autor staff)", "Client testimonial (no staff author)")}
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button type="submit" disabled={busy}
            style={{ padding: "10px 20px", borderRadius: 999, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 14, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? tt(locale, "Publicando…", "Publishing…") : tt(locale, "Publicar", "Publish")}
          </button>
          {msg && <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{msg}</span>}
        </div>
      </form>

      {/* Moderation list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {posts.length === 0 && <p style={{ color: "var(--ink-3)", fontSize: 13.5 }}>{tt(locale, "Sin publicaciones todavía.", "No posts yet.")}</p>}
        {posts.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--ink-3)", width: 44 }}>{p.kind}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.body || p.authorDisplay || "—"}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{p.authorDisplay ?? (p.authorStaffId ? "Staff" : "—")}</div>
            </div>
            <button type="button" onClick={() => togglePublished(p)}
              style={{
                padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1px solid var(--line)",
                background: p.isPublished ? "color-mix(in srgb, #1f9d57 14%, var(--card))" : "var(--card)",
                color: p.isPublished ? "#1f9d57" : "var(--ink-3)",
              }}>
              {p.isPublished ? tt(locale, "Publicado", "Published") : tt(locale, "Borrador", "Draft")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
