"use client";

/**
 * ChatThread — shared realtime chat thread (client overlay + staff tab).
 * DOC-46. Realtime via useConversationRealtime; optimistic send + de-dupe by id;
 * markRead on mount + on inbound; per-message translate; attachment cycle.
 *
 * Boundaries: no @/backend imports. Data + actions flow via VM/ChatActions props.
 */

import * as React from "react";
import { Icon, GhostBtn } from "@/frontend/components/brand";
import { getBridge } from "@/frontend/platform-bridge";
import { useConversationRealtime } from "./use-conversation-realtime";
import type { ChatActions, ChatMessageVM, ChatThreadVM } from "./types";

export interface ChatThreadProps {
  vm: ChatThreadVM;
  actions: ChatActions;
  locale: "es" | "en";
}

function tt(locale: "es" | "en", es: string, en: string) {
  return locale === "es" ? es : en;
}

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

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatThread({ vm, actions, locale }: ChatThreadProps) {
  const meId = vm.meUserId;
  const [messages, setMessages] = React.useState<ChatMessageVM[]>(vm.messages);
  const [cursor, setCursor] = React.useState<string | null>(vm.nextCursor);
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [translations, setTranslations] = React.useState<Record<string, string>>({});

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const idsRef = React.useRef<Set<string>>(new Set(vm.messages.map((m) => m.id)));

  // newest createdAt seen (for realtime catch-up + polling)
  const lastSeenIso = messages.length > 0 ? messages[messages.length - 1].createdAt : null;
  const lastSeenRef = React.useRef<string | null>(lastSeenIso);
  lastSeenRef.current = lastSeenIso;

  const appendMessage = React.useCallback((m: ChatMessageVM) => {
    if (idsRef.current.has(m.id)) return;
    idsRef.current.add(m.id);
    setMessages((prev) => [...prev, m].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    // mark read for inbound (not my own)
    if (m.senderUserId !== meId) void actions.markRead(vm.conversationId);
  }, [actions, vm.conversationId, meId]);

  const { connected, degraded } = useConversationRealtime({
    conversationId: vm.conversationId,
    getLastSeenIso: () => lastSeenRef.current,
    onNewMessage: appendMessage,
    loadSince: async (afterIso) => actions.listSince(vm.conversationId, afterIso),
  });

  // markRead on mount + auto-scroll on new message
  React.useEffect(() => {
    void actions.markRead(vm.conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vm.conversationId]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function handleSend() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText("");
    const res = await actions.send({ conversationId: vm.conversationId, body });
    setSending(false);
    if (res.ok && res.message) appendMessage(res.message);
    else setText(body); // restore on failure
  }

  async function handleLoadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const res = await actions.loadMore(vm.conversationId, cursor);
    setLoadingMore(false);
    if (res.ok) {
      const fresh = res.messages.filter((m) => !idsRef.current.has(m.id));
      fresh.forEach((m) => idsRef.current.add(m.id));
      setMessages((prev) => [...fresh, ...prev].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      setCursor(res.nextCursor);
    }
  }

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const urlRes = await actions.getUploadUrl({
        conversationId: vm.conversationId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
      });
      if (!urlRes.ok || !urlRes.signedUrl || !urlRes.path) return;
      const put = await fetch(urlRes.signedUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      if (!put.ok) return;
      const conf = await actions.confirmAttachment({
        conversationId: vm.conversationId,
        path: urlRes.path,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
      });
      if (!conf.ok || !conf.ref) return;
      const res = await actions.send({ conversationId: vm.conversationId, uploadRefs: [conf.ref] });
      if (res.ok && res.message) appendMessage(res.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleTranslate(m: ChatMessageVM) {
    if (translations[m.id]) {
      setTranslations((prev) => {
        const next = { ...prev };
        delete next[m.id];
        return next;
      });
      return;
    }
    const res = await actions.translate(m.id);
    if (res.ok && res.text) setTranslations((prev) => ({ ...prev, [m.id]: res.text! }));
  }

  async function handleDownload(m: ChatMessageVM, path: string) {
    const res = await actions.getDownloadUrl({ conversationId: vm.conversationId, path });
    if (res.ok && res.url) getBridge().share.openExternal(res.url);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Connection hint — only meaningful for participants (non-participants
          never reach SUBSCRIBED, so a perpetual "reconnecting" would mislead). */}
      {vm.viewerCanPost && degraded && !connected && (
        <div style={{ padding: "6px 14px", background: "var(--gold-soft)", color: "var(--gold-deep)", fontSize: 12, textAlign: "center" }}>
          {tt(locale, "Reconectando… los mensajes pueden tardar unos segundos.", "Reconnecting… messages may take a few seconds.")}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {cursor && (
          <button type="button" onClick={handleLoadMore} disabled={loadingMore}
            style={{ alignSelf: "center", background: "none", border: "none", color: "var(--accent)", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 8 }}>
            {loadingMore ? tt(locale, "Cargando…", "Loading…") : tt(locale, "Ver mensajes anteriores", "Load earlier messages")}
          </button>
        )}

        {messages.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--ink-3)", fontSize: 13, marginTop: 24 }}>
            {tt(locale, "Aún no hay mensajes. Escribe a tu equipo.", "No messages yet. Write to your team.")}
          </p>
        )}

        {messages.map((m) => {
          if (m.kind === "system") {
            return (
              <div key={m.id} style={{ alignSelf: "center", maxWidth: "85%", textAlign: "center" }}>
                <span style={{ display: "inline-block", background: "var(--hover, rgba(47,107,255,0.06))", color: "var(--ink-3)", fontSize: 12, padding: "6px 12px", borderRadius: 999 }}>
                  {m.body}
                </span>
              </div>
            );
          }
          const mine = m.senderUserId === meId;
          return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%" }}>
              <div style={{
                background: mine ? "var(--accent)" : "var(--card)",
                color: mine ? "#fff" : "var(--ink)",
                border: mine ? "none" : "1px solid var(--line)",
                borderRadius: 16,
                borderBottomRightRadius: mine ? 4 : 16,
                borderBottomLeftRadius: mine ? 16 : 4,
                padding: "9px 13px",
                fontSize: 14,
                lineHeight: 1.45,
                wordBreak: "break-word",
              }}>
                {m.body && <span>{m.body}</span>}
                {m.attachments.map((a) => (
                  <button key={a.path} type="button" onClick={() => handleDownload(m, a.path)}
                    style={{ display: "flex", alignItems: "center", gap: 8, marginTop: m.body ? 8 : 0, background: mine ? "rgba(255,255,255,0.15)" : "var(--hover, rgba(47,107,255,0.06))", border: "none", borderRadius: 10, padding: "8px 10px", cursor: "pointer", color: "inherit", width: "100%", textAlign: "left" }}>
                    <Icon name="doc" size={16} color={mine ? "#fff" : "var(--accent)"} />
                    <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                    <span style={{ fontSize: 11, opacity: 0.8 }}>{fmtSize(a.size)}</span>
                  </button>
                ))}
                {translations[m.id] && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${mine ? "rgba(255,255,255,0.25)" : "var(--line)"}`, fontSize: 13, fontStyle: "italic", opacity: 0.92 }}>
                    {translations[m.id]}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: mine ? "flex-end" : "flex-start", marginTop: 2, padding: "0 4px" }}>
                <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{fmtTime(m.createdAt, locale)}</span>
                {m.body && (
                  <button type="button" onClick={() => handleTranslate(m)}
                    style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 10, fontWeight: 700, cursor: "pointer", padding: 0 }}>
                    {translations[m.id] ? tt(locale, "Ver original", "Show original") : tt(locale, "Traducir", "Translate")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer (participants only). Staff with case access but no participation
          get a read-only notice instead of a composer that would always fail. */}
      {vm.viewerCanPost ? (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--line)", background: "var(--card)" }}>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }} />
          <GhostBtn size="md" full={false} onClick={() => fileRef.current?.click()} disabled={uploading}
            style={{ height: 40, width: 40, padding: 0, borderRadius: 999, flexShrink: 0 }} aria-label={tt(locale, "Adjuntar archivo", "Attach file")}>
            <Icon name="clip" size={18} color="var(--accent)" />
          </GhostBtn>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
            placeholder={tt(locale, "Escribe un mensaje…", "Type a message…")}
            rows={1}
            style={{ flex: 1, resize: "none", maxHeight: 120, padding: "10px 14px", borderRadius: 20, border: "1px solid var(--line)", background: "var(--bg, #fff)", color: "var(--ink)", fontSize: 14, outline: "none", fontFamily: "inherit" }}
          />
          <button type="button" onClick={handleSend} disabled={sending || !text.trim()}
            style={{ height: 40, width: 40, borderRadius: 999, border: "none", background: text.trim() ? "var(--accent)" : "var(--line)", cursor: text.trim() ? "pointer" : "default", flexShrink: 0, display: "grid", placeItems: "center" }}
            aria-label={tt(locale, "Enviar", "Send")}>
            <Icon name="send" size={18} color="#fff" />
          </button>
        </div>
      ) : (
        <div style={{ padding: "12px 14px", borderTop: "1px solid var(--line)", background: "var(--card)", color: "var(--ink-3)", fontSize: 12.5, textAlign: "center" }}>
          {tt(
            locale,
            "Solo los participantes de esta conversación pueden enviar mensajes.",
            "Only participants of this conversation can send messages.",
          )}
        </div>
      )}
    </div>
  );
}
