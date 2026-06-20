"use client";

/**
 * CommunityFeed — client community surface (RF-CLI-055..058). Emotional header +
 * live banner + chronological feed (text/video) + heart/fire/clap reactions with
 * optimistic toggle reconciled against the server. No @/backend imports — the
 * feed data + toggle/loadMore server actions are injected by the app layer.
 */

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";

type ReactionKind = "heart" | "fire" | "clap";
interface ReactionCounts { heart: number; fire: number; clap: number }

export interface FeedPostVM {
  id: string;
  kind: string;
  body: string | null;
  videoUrl: string | null;
  authorStaffId: string | null;
  authorDisplay: string | null;
  createdAt: string;
  reactions: ReactionCounts;
  mine: ReactionKind[];
}
export interface LiveBannerVM {
  id: string;
  body: string | null;
  authorDisplay: string | null;
  liveStartsAt: string | null;
  liveJoinUrl: string | null;
}
export interface CommunityFeedVM {
  meUserId: string;
  live: LiveBannerVM | null;
  posts: FeedPostVM[];
  nextCursor: string | null;
}

type AR<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };

export interface RawCommunityActions {
  toggleReaction: (input: { postId: string; kind: string }) => Promise<AR<{ counts: ReactionCounts; mine: ReactionKind[] }>>;
  loadMore: (opts: { cursor?: string }) => Promise<AR<CommunityFeedVM>>;
}

export interface CommunityFeedProps {
  locale: "es" | "en";
  initial: CommunityFeedVM;
  actions: RawCommunityActions;
}

function tt(locale: "es" | "en", es: string, en: string) {
  return locale === "es" ? es : en;
}

const REACTIONS: { kind: ReactionKind; icon: "heart" | "fire" | "clap" }[] = [
  { kind: "heart", icon: "heart" },
  { kind: "fire", icon: "fire" },
  { kind: "clap", icon: "clap" },
];

function fmtLiveTime(iso: string | null, locale: "es" | "en"): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(locale === "es" ? "es-US" : "en-US", {
      weekday: "short", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function authorInitial(post: FeedPostVM): string {
  const name = post.authorDisplay ?? "ULP";
  return name.trim().charAt(0).toUpperCase() || "U";
}

export function CommunityFeed({ locale, initial, actions }: CommunityFeedProps) {
  const [posts, setPosts] = React.useState<FeedPostVM[]>(initial.posts);
  const [cursor, setCursor] = React.useState<string | null>(initial.nextCursor);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const live = initial.live;

  async function handleReact(post: FeedPostVM, kind: ReactionKind) {
    // Optimistic toggle.
    const had = post.mine.includes(kind);
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== post.id) return p;
        const counts = { ...p.reactions };
        counts[kind] = Math.max(0, counts[kind] + (had ? -1 : 1));
        const mine = had ? p.mine.filter((k) => k !== kind) : [...p.mine, kind];
        return { ...p, reactions: counts, mine };
      }),
    );
    const res = await actions.toggleReaction({ postId: post.id, kind });
    if (res.success) {
      // Reconcile with the authoritative server state.
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, reactions: res.data.counts, mine: res.data.mine } : p)));
    }
  }

  async function handleLoadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const res = await actions.loadMore({ cursor });
    setLoadingMore(false);
    if (res.success) {
      const seen = new Set(posts.map((p) => p.id));
      const fresh = res.data.posts.filter((p) => !seen.has(p.id));
      setPosts((prev) => [...prev, ...fresh]);
      setCursor(res.data.nextCursor);
    }
  }

  return (
    <div style={{ padding: "30px 16px var(--screen-pb)", minHeight: "100dvh" }}>
      {/* Emotional header (RF-CLI-055) */}
      <header style={{ marginBottom: 18 }}>
        <h1 className="t-black" style={{ margin: 0, fontSize: 26, color: "var(--navy)" }}>
          {tt(locale, "No estás solo/a", "You're not alone")}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.4 }}>
          {tt(locale, "Miles de familias como la tuya, caminando contigo.", "Thousands of families like yours, walking with you.")}
        </p>
      </header>

      {/* Live banner (RF-CLI-057) */}
      {live && (
        <div style={{
          position: "relative", borderRadius: 18, padding: "18px 18px 16px", marginBottom: 18,
          background: "linear-gradient(135deg, var(--navy) 0%, #1b2b4d 100%)",
          boxShadow: "0 14px 40px color-mix(in srgb, var(--gold) 22%, transparent)", overflow: "hidden", color: "#fff",
        }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, background: "#d14343", color: "#fff",
            borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 800, letterSpacing: "0.04em",
          }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: "#fff", animation: "pulse 1.4s infinite" }} />
            {tt(locale, "EN VIVO", "LIVE")} · {fmtLiveTime(live.liveStartsAt, locale)}
          </span>
          <div style={{ fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 19, marginTop: 10 }}>
            {live.body || tt(locale, "Sesión en vivo", "Live session")}
          </div>
          {live.authorDisplay && (
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>{live.authorDisplay}</div>
          )}
          {live.liveJoinUrl && (
            <a href={live.liveJoinUrl} target="_blank" rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, marginTop: 14, padding: "10px 18px",
                borderRadius: 999, background: "var(--gold)", color: "var(--navy)", fontWeight: 800, fontSize: 14,
                textDecoration: "none",
              }}>
              {tt(locale, "Entrar a la sesión", "Join the session")}
              <Icon name="play" size={15} color="var(--navy)" />
            </a>
          )}
        </div>
      )}

      {/* Feed */}
      {posts.length === 0 && !live && (
        <p style={{ textAlign: "center", color: "var(--ink-3)", fontSize: 14, padding: "40px 12px" }}>
          {tt(locale, "Aún no hay publicaciones.", "No posts yet.")}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {posts.map((post) => (
          <article key={post.id} style={{
            background: "var(--card)", border: "1px solid var(--line)", borderRadius: 18, padding: 16,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{
                width: 40, height: 40, borderRadius: 999, display: "grid", placeItems: "center", flexShrink: 0,
                background: post.authorStaffId ? "var(--accent)" : "var(--gold)", color: "#fff",
                fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 16,
              }}>
                {authorInitial(post)}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>
                  {post.authorDisplay || (post.authorStaffId ? "X Legal" : tt(locale, "Familia ULP", "ULP Family"))}
                </div>
              </div>
            </div>

            {post.body && (
              <p style={{ margin: "0 0 10px", fontSize: 14.5, color: "var(--ink)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                {post.body}
              </p>
            )}

            {post.kind === "video" && post.videoUrl && (
              <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", marginBottom: 10, aspectRatio: "16 / 9", background: "#000" }}>
                <iframe
                  src={post.videoUrl}
                  title={post.authorDisplay ?? "video"}
                  style={{ width: "100%", height: "100%", border: "none" }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}

            {/* Reactions (RF-CLI-058) */}
            <div style={{ display: "flex", gap: 8 }}>
              {REACTIONS.map((r) => {
                const on = post.mine.includes(r.kind);
                const count = post.reactions[r.kind];
                return (
                  <button key={r.kind} type="button" onClick={() => handleReact(post, r.kind)}
                    aria-pressed={on}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999,
                      cursor: "pointer", fontSize: 13, fontWeight: 700,
                      border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                      background: on ? "color-mix(in srgb, var(--accent) 12%, var(--card))" : "var(--card)",
                      color: on ? "var(--accent)" : "var(--ink-2)",
                    }}>
                    <Icon name={r.icon} size={16} color={on ? "var(--accent)" : "var(--ink-3)"} />
                    {count > 0 && <span>{count}</span>}
                  </button>
                );
              })}
            </div>
          </article>
        ))}
      </div>

      {cursor && (
        <button type="button" onClick={handleLoadMore} disabled={loadingMore}
          style={{ display: "block", margin: "16px auto 0", background: "none", border: "none", color: "var(--accent)", fontSize: 14, fontWeight: 700, cursor: "pointer", padding: 10 }}>
          {loadingMore ? tt(locale, "Cargando…", "Loading…") : tt(locale, "Ver más", "Load more")}
        </button>
      )}
    </div>
  );
}
