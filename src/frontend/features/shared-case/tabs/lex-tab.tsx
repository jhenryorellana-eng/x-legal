"use client";

/**
 * Lex tab — the case AI chat for staff (admin / sales / paralegal / finance).
 * ChatGPT-style panel: the staff asks about the case (client documents + form
 * answers) and Lex answers, citing its sources (case chunks / web pages).
 *
 * Data flow:
 *   1. Initial thread load via actions.getLexThread (skeleton while loading;
 *      error EmptyState + retry on failure).
 *   2. Optimistic send: the user bubble + a "Lex está escribiendo…" placeholder
 *      (assistant running) render immediately.
 *   3. sendLexMessage ok → poll getLexMessageStatus every 2s until the answer
 *      completes/fails (≈90s cap → failed bubble with retry). ok:false (e.g.
 *      LEX_BUSY) → inline system bubble, placeholder dropped.
 *   4. A thread loaded with an in-flight answer (page reload) resumes polling.
 *
 * Boundaries: no @/backend imports — the Lex contract is redeclared in
 * ../types and the RSC pages inject the server actions as props (R2). Visual
 * pattern mirrors the messaging chat (bubbles + fixed composer) but the
 * feature is autonomous.
 */

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";
import { Lex } from "@/frontend/components/brand/lex";
import { Card } from "@/frontend/components/brand/card";
import { Skeleton } from "@/frontend/components/desktop/skeleton";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import type { LexActions, LexMessageVM, LexSource } from "../types";
import type { CasosStrings } from "../strings";

export type LexTabStrings = CasosStrings["detail"]["lex"];

/** Poll cadence for the async answer (precedent: generaciones pollUntilDone). */
const POLL_MS = 2000;
/** Safety cap ≈ 90s — past it the exchange is shown as failed with a retry. */
const MAX_POLLS = 45;

type MessageRow = LexMessageVM & {
  kind: "message";
  /** Server assistant-message id this optimistic placeholder polls for. */
  pendingFor?: string;
  /** Original question — enables the "retry" affordance on a failed answer. */
  retryText?: string;
  /** Links the user question + assistant answer of one optimistic exchange. */
  exchangeId?: string;
};

type SystemRow = { kind: "system"; id: string; text: string; createdAt: string };

type Row = MessageRow | SystemRow;

function fmtTime(iso: string, locale: "es" | "en") {
  try {
    return new Date(iso).toLocaleTimeString(locale === "es" ? "es-US" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Chip caption for a web source: its title, falling back to the hostname. */
function webSourceLabel(source: { uri: string; title: string | null }): string {
  if (source.title) return source.title;
  try {
    return new URL(source.uri).hostname;
  } catch {
    return source.uri;
  }
}

export function LexTab({
  caseId,
  strings,
  actions,
  locale,
}: {
  caseId: string;
  strings: LexTabStrings;
  /** Server actions injected by the RSC page. Absent only in dev previews. */
  actions?: LexActions;
  locale: "es" | "en";
}) {
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = React.useState<Row[]>([]);
  const [text, setText] = React.useState("");

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const pollRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const startedRef = React.useRef<Set<string>>(new Set());
  // Guards an in-flight tick that resolves AFTER unmount (precedent: generaciones).
  const disposedRef = React.useRef(false);
  // Re-entrancy guards mirrored as refs so event handlers never read stale state.
  const actionsRef = React.useRef(actions);
  actionsRef.current = actions;
  const postingRef = React.useRef(false);
  const seqRef = React.useRef(0);
  const nextLocalId = (prefix: string) => `${prefix}-${(seqRef.current += 1)}`;

  const running = rows.some((r) => r.kind === "message" && r.role === "assistant" && r.status === "running");
  const runningRef = React.useRef(running);
  runningRef.current = running;

  const pollMessage = React.useCallback((messageId: string) => {
    let polls = 0;
    const tick = async () => {
      if (disposedRef.current) {
        pollRef.current.delete(messageId);
        return;
      }
      // Pause while the tab is hidden — no point polling a page nobody sees.
      if (typeof document !== "undefined" && document.hidden) {
        pollRef.current.set(messageId, setTimeout(tick, POLL_MS));
        return;
      }
      polls += 1;
      const acts = actionsRef.current;
      if (!acts) {
        pollRef.current.delete(messageId);
        return;
      }
      const vm = await acts.getLexMessageStatus(messageId).catch(() => null);
      // The await may resolve after unmount — never setState or reschedule then.
      if (disposedRef.current) {
        pollRef.current.delete(messageId);
        return;
      }
      if (vm && (vm.status === "completed" || vm.status === "failed")) {
        pollRef.current.delete(messageId);
        setRows((prev) =>
          prev.map((r) =>
            r.kind === "message" && (r.pendingFor === messageId || r.id === messageId)
              ? { kind: "message", ...vm, retryText: r.retryText, exchangeId: r.exchangeId }
              : r,
          ),
        );
        return;
      }
      if (polls >= MAX_POLLS) {
        pollRef.current.delete(messageId);
        setRows((prev) =>
          prev.map((r) =>
            r.kind === "message" && (r.pendingFor === messageId || r.id === messageId)
              ? { ...r, status: "failed" }
              : r,
          ),
        );
        return;
      }
      pollRef.current.set(messageId, setTimeout(tick, POLL_MS));
    };
    pollRef.current.set(messageId, setTimeout(tick, POLL_MS));
  }, []);

  const load = React.useCallback(async () => {
    const acts = actionsRef.current;
    if (!acts) {
      setPhase("error");
      return;
    }
    setPhase("loading");
    const thread = await acts.getLexThread(caseId).catch(() => null);
    if (disposedRef.current) return;
    if (!thread) {
      setPhase("error");
      return;
    }
    setRows(thread.messages.map((m) => ({ kind: "message", ...m })));
    setPhase("ready");
    // Resume polling any assistant answer still in flight (page reload mid-run).
    for (const m of thread.messages) {
      if (m.role === "assistant" && m.status === "running" && !startedRef.current.has(m.id)) {
        startedRef.current.add(m.id);
        pollMessage(m.id);
      }
    }
  }, [caseId, pollMessage]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Cleanup on unmount.
  React.useEffect(
    () => () => {
      disposedRef.current = true;
      for (const id of pollRef.current.values()) clearTimeout(id);
      pollRef.current.clear();
    },
    [],
  );

  // Auto-scroll to the newest message / placeholder.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows, phase]);

  async function send(content: string) {
    const acts = actionsRef.current;
    const body = content.trim();
    if (!body || !acts || postingRef.current || runningRef.current) return;
    postingRef.current = true;
    setText("");
    const exchangeId = nextLocalId("x");
    const pendingId = nextLocalId("pending");
    const now = new Date().toISOString();
    setRows((prev) => [
      ...prev,
      {
        kind: "message",
        id: nextLocalId("u"),
        role: "user",
        content: body,
        status: "completed",
        sources: [],
        createdAt: now,
        exchangeId,
      },
      {
        kind: "message",
        id: pendingId,
        role: "assistant",
        content: "",
        status: "running",
        sources: [],
        createdAt: now,
        retryText: body,
        exchangeId,
      },
    ]);
    const res = await acts.sendLexMessage(caseId, body).catch(() => null);
    postingRef.current = false;
    if (disposedRef.current) return;
    if (!res || !res.ok) {
      // Rejected (e.g. LEX_BUSY) or transport error: drop the placeholder and
      // surface the failure as an inline system bubble.
      setRows((prev) => [
        ...prev.filter((r) => r.id !== pendingId),
        { kind: "system", id: nextLocalId("sys"), text: strings.errorGeneric, createdAt: new Date().toISOString() },
      ]);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === pendingId ? { ...r, pendingFor: res.messageId } : r)));
    if (!startedRef.current.has(res.messageId)) {
      startedRef.current.add(res.messageId);
      pollMessage(res.messageId);
    }
  }

  function retry(row: MessageRow) {
    if (!row.retryText || !row.exchangeId) return;
    const question = row.retryText;
    const exchangeId = row.exchangeId;
    // Drop the failed exchange (question + failed answer) and resend it fresh.
    setRows((prev) => prev.filter((r) => !(r.kind === "message" && r.exchangeId === exchangeId)));
    void send(question);
  }

  const suggestions = [strings.sugSummary, strings.sugDocs, strings.sugStatus];
  const canSend = !!actions && text.trim().length > 0 && !running;

  if (phase === "error") {
    return (
      <Card>
        <EmptyState
          mood="atento"
          title={strings.errorLoad}
          action={actions ? { label: strings.retry, icon: "bolt", onClick: () => void load() } : undefined}
        />
      </Card>
    );
  }

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "column", height: "clamp(420px, calc(100dvh - 360px), 780px)" }}>
        {/* Panel header — what Lex is and its scope. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "1px solid var(--line)",
            background: "var(--card)",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              background: "var(--blue-soft)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="sparkle" size={18} color="var(--accent)" />
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 16, color: "var(--ink)" }}>
              {strings.title}
            </h2>
            <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>{strings.scopeNote}</p>
          </div>
        </div>

        {/* Messages (internal scroll). */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: "var(--bg, transparent)",
          }}
        >
          {phase === "loading" && (
            <>
              <Skeleton width="48%" height={40} radius={16} style={{ alignSelf: "flex-end" }} />
              <Skeleton width="66%" height={64} radius={16} />
              <Skeleton width="42%" height={40} radius={16} style={{ alignSelf: "flex-end" }} />
            </>
          )}

          {phase === "ready" && rows.length === 0 && (
            <div
              style={{
                margin: "auto",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                gap: 6,
                padding: "20px 16px",
                maxWidth: 540,
              }}
            >
              <Lex size={92} mood="feliz" />
              <h3
                style={{
                  margin: "6px 0 0",
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 17,
                  color: "var(--ink)",
                }}
              >
                {strings.emptyTitle}
              </h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-2)", maxWidth: 420 }}>
                {strings.emptySub}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 10 }}>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 999,
                      padding: "8px 14px",
                      background: "var(--card)",
                      color: "var(--accent)",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {rows.map((row) => {
            if (row.kind === "system") {
              return (
                <div key={row.id} style={{ alignSelf: "center", maxWidth: "88%", textAlign: "center" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: "var(--gold-soft)",
                      color: "var(--gold-deep)",
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "6px 12px",
                      borderRadius: 999,
                    }}
                  >
                    <Icon name="info" size={13} color="var(--gold-deep)" />
                    {row.text}
                  </span>
                </div>
              );
            }

            if (row.role === "user") {
              return (
                <div key={row.id} style={{ alignSelf: "flex-end", maxWidth: "82%" }}>
                  <div
                    style={{
                      background: "var(--accent)",
                      color: "#fff",
                      borderRadius: 16,
                      borderBottomRightRadius: 4,
                      padding: "9px 13px",
                      fontSize: 14,
                      lineHeight: 1.45,
                      wordBreak: "break-word",
                      whiteSpace: "pre-wrap",
                      boxShadow: "0 1px 2px rgba(11,27,51,.06), 0 2px 8px rgba(11,27,51,.05)",
                    }}
                  >
                    {row.content}
                  </div>
                  <div style={{ textAlign: "right", marginTop: 2, padding: "0 4px", fontSize: 10, color: "var(--ink-3)" }}>
                    {fmtTime(row.createdAt, locale)}
                  </div>
                </div>
              );
            }

            const typing = row.status === "running";
            const failed = row.status === "failed";
            return (
              <div key={row.id} style={{ display: "flex", gap: 8, alignSelf: "flex-start", maxWidth: "88%" }}>
                <div style={{ width: 28, flexShrink: 0 }}>
                  <Lex size={28} mood="calma" />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      background: "var(--card)",
                      color: "var(--ink)",
                      border: "1px solid var(--line)",
                      borderRadius: 16,
                      borderBottomLeftRadius: 4,
                      padding: "9px 13px",
                      fontSize: 14,
                      lineHeight: 1.45,
                      wordBreak: "break-word",
                      boxShadow: "0 1px 2px rgba(11,27,51,.06), 0 2px 8px rgba(11,27,51,.05)",
                    }}
                  >
                    {typing ? (
                      <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>{strings.typing}</span>
                    ) : failed ? (
                      <span style={{ color: "var(--gold-deep)", fontWeight: 700 }}>{strings.failed}</span>
                    ) : (
                      <span style={{ whiteSpace: "pre-wrap" }}>{row.content}</span>
                    )}
                  </div>

                  {failed && row.retryText && row.exchangeId && (
                    <button
                      type="button"
                      onClick={() => retry(row)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--accent)",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: "pointer",
                        padding: "3px 4px 0",
                      }}
                    >
                      {strings.retry}
                    </button>
                  )}

                  {!typing && !failed && row.sources.length > 0 && (
                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-3)", paddingLeft: 2 }}>
                        {strings.sources}
                      </span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {row.sources.map((source, i) => (
                          <SourceChip key={`${source.kind}-${i}`} source={source} />
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 2, padding: "0 4px", fontSize: 10, color: "var(--ink-3)" }}>
                    {fmtTime(row.createdAt, locale)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Composer — fixed at the bottom of the panel. */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            padding: "10px 12px",
            borderTop: "1px solid var(--line)",
            background: "var(--card)",
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
            placeholder={strings.composerPlaceholder}
            rows={1}
            style={{
              flex: 1,
              resize: "none",
              maxHeight: 120,
              padding: "10px 14px",
              borderRadius: 20,
              border: "1px solid var(--line)",
              background: "var(--bg, #fff)",
              color: "var(--ink)",
              fontSize: 14,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          <button
            type="button"
            onClick={() => void send(text)}
            disabled={!canSend}
            style={{
              height: 40,
              width: 40,
              borderRadius: 999,
              border: "none",
              background: canSend ? "var(--accent)" : "var(--line)",
              cursor: canSend ? "pointer" : "default",
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
            }}
            aria-label={strings.send}
          >
            <Icon name="send" size={18} color="#fff" />
          </button>
        </div>
      </div>
    </Card>
  );
}

/** Small citation chip under a Lex answer: case chunk (static) or web (link). */
function SourceChip({ source }: { source: LexSource }) {
  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    maxWidth: "100%",
    border: "1px solid var(--line)",
    borderRadius: 999,
    padding: "4px 10px",
    background: "var(--card)",
    fontSize: 11.5,
    fontWeight: 700,
  };
  if (source.kind === "web") {
    return (
      <a
        href={source.uri}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...style, color: "var(--accent)", textDecoration: "none" }}
      >
        <Icon name="globe" size={12} color="var(--accent)" />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {webSourceLabel(source)}
        </span>
      </a>
    );
  }
  return (
    <span style={{ ...style, color: "var(--ink-2)" }}>
      <Icon name="doc" size={12} color="var(--ink-3)" />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.label}</span>
    </span>
  );
}
