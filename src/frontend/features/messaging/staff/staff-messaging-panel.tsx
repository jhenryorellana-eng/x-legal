"use client";

/**
 * StaffMessagingPanel — the floating messaging hub for every staff member
 * (PROMPT-VAN-07 replica). FAB → glass panel with Clientes / Equipo tabs, the
 * conversation list, and an in-panel thread that reuses <ChatThread> (group
 * bubbles + realtime + attachments from Wave 2). Calls are visual only (LiveKit
 * lands in F7). Boundaries: NO @/backend import — the server actions are injected
 * by the staff layout as `raw`.
 */

import * as React from "react";
import { ChatThread } from "../chat-thread";
import { buildChatActions, type RawChatActions } from "../build-chat-actions";
import type { ChatActions, ChatThreadVM } from "../types";

// --- VM shapes (mirror the messaging module DTOs; no @/backend import) --------
interface ConversationSummaryVM {
  conversationId: string;
  scope: string;
  caseId: string | null;
  caseNumber: string | null;
  name: string;
  initials: string;
  color: string;
  serviceChip: string | null;
  snippet: string;
  lastMessageAt: string | null;
  unread: number;
}
interface StaffDirectoryEntryVM {
  userId: string;
  name: string;
  roleLabel: string | null;
  initials: string;
  color: string;
}

type AR<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };

export interface RawStaffMessagingActions extends RawChatActions {
  listConversations: () => Promise<AR<{ clients: ConversationSummaryVM[]; team: ConversationSummaryVM[] }>>;
  staffDirectory: () => Promise<AR<StaffDirectoryEntryVM[]>>;
  getConversationThread: RawChatActions["getCaseThread"];
  openTeamConversation: () => Promise<AR<{ conversation: { id: string } }>>;
  openStaffDirect: (otherUserId: string) => Promise<AR<{ conversation: { id: string } }>>;
  getUnreadBadge: () => Promise<AR<{ total: number }>>;
}

export interface StaffMessagingPanelProps {
  locale: "es" | "en";
  initialUnread?: number;
  raw: RawStaffMessagingActions;
}

interface SelectedConv {
  conversationId: string;
  name: string;
  initials: string;
  color: string;
  sub: string | null;
}

type Call = { kind: "audio" | "video"; conv: SelectedConv };

function tt(locale: "es" | "en", es: string, en: string) {
  return locale === "es" ? es : en;
}

const TEAM_NAME = "Equipo UsaLatinoPrime";
const TEAM_GRAD = "linear-gradient(135deg,#E4002B,#FFC629)";

/** Material Symbols Rounded glyph (font loaded by the staff layout). */
function Sym({ name, size = 20, color, fill }: { name: string; size?: number; color?: string; fill?: boolean }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden="true"
      style={{
        fontSize: size,
        color,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' 500, 'GRAD' 0, 'opsz' 24`,
        lineHeight: 1,
      }}
    >
      {name}
    </span>
  );
}

function Avatar({ initials, color, size = 46, online }: { initials: string; color: string; size?: number; online?: boolean }) {
  return (
    <div className="conv-av" style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.35) }}>
      {initials}
      {online && <span className="on-dot" />}
    </div>
  );
}

function ConvRow({ c, locale, onClick }: { c: ConversationSummaryVM; locale: "es" | "en"; onClick: () => void }) {
  return (
    <button type="button" className="conv" onClick={onClick}>
      <Avatar initials={c.initials} color={c.color} />
      <div className="conv-main">
        <div className="conv-name">
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
          {c.serviceChip && <span className="chip gold">{c.serviceChip}</span>}
          {c.caseNumber && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "-0.02em", flexShrink: 0 }}>
              {c.caseNumber}
            </span>
          )}
        </div>
        <div className="conv-sub">{c.snippet || tt(locale, "Sin mensajes aún", "No messages yet")}</div>
      </div>
      <div className="conv-meta">
        <span className="conv-time">{relTime(c.lastMessageAt, locale)}</span>
        {c.unread > 0 && <span className="conv-badge">{c.unread}</span>}
      </div>
    </button>
  );
}

function relTime(iso: string | null, locale: "es" | "en"): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString(locale === "es" ? "es-MX" : "en-US", { hour: "numeric", minute: "2-digit" });
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return tt(locale, "ayer", "yest.");
    return d.toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { weekday: "short" });
  } catch {
    return "";
  }
}

function PanelThread({
  conv,
  loadThread,
  actions,
  locale,
  onBack,
  onCall,
}: {
  conv: SelectedConv;
  loadThread: () => Promise<ChatThreadVM | null>;
  actions: ChatActions;
  locale: "es" | "en";
  onBack: () => void;
  onCall: (kind: "audio" | "video") => void;
}) {
  const [vm, setVm] = React.useState<ChatThreadVM | null>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setVm(null);
    setError(false);
    loadThread()
      .then((t) => {
        if (cancelled) return;
        if (t) setVm(t);
        else setError(true);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [loadThread]);

  return (
    <>
      <div className="th-head">
        <button type="button" className="th-back" onClick={onBack} aria-label={tt(locale, "Volver", "Back")}>
          <Sym name="arrow_back" size={20} />
        </button>
        <Avatar initials={conv.initials} color={conv.color} size={40} />
        <div style={{ minWidth: 0 }}>
          <div className="th-name">{conv.name}</div>
          {conv.sub && <div className="th-sub">{conv.sub}</div>}
        </div>
        <div className="th-acts">
          <button type="button" className="th-act" onClick={() => onCall("audio")} aria-label={tt(locale, "Llamar", "Call")}>
            <Sym name="call" size={20} />
          </button>
          <button type="button" className="th-act" onClick={() => onCall("video")} aria-label={tt(locale, "Videollamada", "Video call")}>
            <Sym name="videocam" size={20} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {error ? (
          <p style={{ textAlign: "center", color: "var(--ink-2)", marginTop: 32, fontSize: 13 }}>
            {tt(locale, "No pudimos abrir el chat.", "We couldn't open the chat.")}
          </p>
        ) : !vm ? (
          <p style={{ textAlign: "center", color: "var(--ink-3)", marginTop: 32, fontSize: 13 }}>
            {tt(locale, "Cargando…", "Loading…")}
          </p>
        ) : (
          <ChatThread vm={vm} actions={actions} locale={locale} />
        )}
      </div>
    </>
  );
}

function CallOverlay({ call, locale, onEnd }: { call: Call; locale: "es" | "en"; onEnd: () => void }) {
  return (
    <div className="call-overlay">
      <div className="call-card">
        <div className="call-av" style={{ background: call.conv.color }}>{call.conv.initials}</div>
        <div className="call-name">{call.conv.name}</div>
        <div className="call-status">
          {call.kind === "video" ? tt(locale, "Videollamada…", "Video call…") : tt(locale, "Llamando…", "Calling…")}
        </div>
        <div className="call-actions">
          <button type="button" className="call-btn call-mute" aria-label={tt(locale, "Silenciar", "Mute")}>
            <Sym name="mic_off" size={26} />
          </button>
          <button type="button" className="call-btn call-end" onClick={onEnd} aria-label={tt(locale, "Colgar", "Hang up")}>
            <Sym name="call_end" size={26} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function StaffMessagingPanel({ locale, initialUnread = 0, raw }: StaffMessagingPanelProps) {
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<"clientes" | "equipo">("clientes");
  const [list, setList] = React.useState<{ clients: ConversationSummaryVM[]; team: ConversationSummaryVM[] } | null>(null);
  const [directory, setDirectory] = React.useState<StaffDirectoryEntryVM[]>([]);
  const [selected, setSelected] = React.useState<SelectedConv | null>(null);
  const [call, setCall] = React.useState<Call | null>(null);
  const [unread, setUnread] = React.useState(initialUnread);
  const [query, setQuery] = React.useState("");

  // Load the inbox + directory + badge whenever the panel opens.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [lc, dir, badge] = await Promise.all([raw.listConversations(), raw.staffDirectory(), raw.getUnreadBadge()]);
      if (cancelled) return;
      if (lc.success) setList(lc.data);
      if (dir.success) setDirectory(dir.data);
      if (badge.success) setUnread(badge.data.total);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, raw]);

  // Build the VM-shaped chat actions for the selected conversation (reuses the
  // client overlay's adapter — getConversationThread returns the same DTO).
  const chat = React.useMemo(() => {
    if (!selected) return null;
    return buildChatActions({ ...raw, getCaseThread: raw.getConversationThread }, selected.conversationId);
  }, [selected, raw]);

  // The all-staff group, deduped: prefer the real conversation if it already
  // exists (so it isn't listed twice), else a lazy "open team" entry.
  const teamConv = list?.team.find((t) => t.name === TEAM_NAME) ?? null;
  const teamSub = directory.map((d) => d.name.split(" ")[0]).join(" · ") || tt(locale, "Todo el equipo", "Everyone");

  // Live search filter (the input was previously inert — WCAG 4.1.2).
  const q = query.trim().toLowerCase();
  const filteredClients = (list?.clients ?? []).filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      (c.serviceChip ?? "").toLowerCase().includes(q) ||
      (c.caseNumber ?? "").toLowerCase().includes(q),
  );
  const filteredDirectory = directory.filter(
    (e) => !q || e.name.toLowerCase().includes(q) || (e.roleLabel ?? "").toLowerCase().includes(q),
  );
  const showTeamGroup = !q || TEAM_NAME.toLowerCase().includes(q);

  async function openTeam() {
    const r = await raw.openTeamConversation();
    if (r.success) {
      setSelected({
        conversationId: r.data.conversation.id,
        name: TEAM_NAME,
        initials: "EU",
        color: TEAM_GRAD,
        sub: teamSub,
      });
    }
  }
  async function openDM(e: StaffDirectoryEntryVM) {
    const r = await raw.openStaffDirect(e.userId);
    if (r.success) {
      setSelected({ conversationId: r.data.conversation.id, name: e.name, initials: e.initials, color: e.color, sub: e.roleLabel });
    }
  }
  function closePanel() {
    setOpen(false);
    setSelected(null);
  }

  return (
    <>
      {!open && (
        <button type="button" className="msg-launch" onClick={() => setOpen(true)} aria-label={tt(locale, "Mensajes", "Messages")}>
          <Sym name="forum" size={28} color="#fff" />
          {unread > 0 && <span className="pop">{unread > 99 ? "99+" : unread}</span>}
        </button>
      )}

      {open && (
        <div className="msg-panel" role="dialog" aria-label={tt(locale, "Mensajes", "Messages")}>
          {!selected ? (
            <>
              <div className="msg-head">
                <Sym name="forum" size={24} color="var(--accent)" />
                <div className="tt" style={{ flex: 1 }}>{tt(locale, "Mensajes", "Messages")}</div>
                <button type="button" className="th-back" onClick={closePanel} aria-label={tt(locale, "Cerrar", "Close")}>
                  <Sym name="close" size={20} />
                </button>
              </div>
              <div className="msg-search">
                <Sym name="search" size={19} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tt(locale, "Buscar conversación…", "Search conversation…")}
                  aria-label={tt(locale, "Buscar conversación", "Search conversation")}
                />
              </div>
              <div className="msg-tabs">
                <button type="button" className={`msg-tab${tab === "clientes" ? " on" : ""}`} onClick={() => setTab("clientes")}>
                  <Sym name="groups" size={18} />
                  {tt(locale, "Clientes", "Clients")}
                </button>
                <button type="button" className={`msg-tab${tab === "equipo" ? " on" : ""}`} onClick={() => setTab("equipo")}>
                  <Sym name="diversity_3" size={18} />
                  {tt(locale, "Equipo", "Team")}
                </button>
              </div>
              <div className="conv-list">
                {!list && (
                  <div className="msg-note">{tt(locale, "Cargando conversaciones…", "Loading conversations…")}</div>
                )}

                {list && tab === "clientes" && (
                  <>
                    {filteredClients.length === 0 && (
                      <div className="msg-note">
                        {q
                          ? tt(locale, "Sin resultados.", "No results.")
                          : tt(locale, "Aún no tienes chats de clientes.", "No client chats yet.")}
                      </div>
                    )}
                    {filteredClients.map((c) => (
                      <ConvRow
                        key={c.conversationId}
                        c={c}
                        locale={locale}
                        onClick={() =>
                          setSelected({
                            conversationId: c.conversationId,
                            name: c.name,
                            initials: c.initials,
                            color: c.color,
                            sub:
                              [c.serviceChip, c.caseNumber].filter(Boolean).join(" · ") ||
                              tt(locale, "Grupo · cliente + equipo", "Group · client + team"),
                          })
                        }
                      />
                    ))}
                    {filteredClients.length > 0 && !q && (
                      <div className="msg-note">
                        {tt(locale, "Cada chat de cliente es un grupo con el cliente y todo el equipo.", "Each client chat is a group with the client and the whole team.")}
                      </div>
                    )}
                  </>
                )}

                {list && tab === "equipo" && (
                  <>
                    {showTeamGroup && (
                      <button
                        type="button"
                        className="conv"
                        onClick={() =>
                          teamConv
                            ? setSelected({ conversationId: teamConv.conversationId, name: TEAM_NAME, initials: "EU", color: TEAM_GRAD, sub: teamSub })
                            : openTeam()
                        }
                      >
                        <Avatar initials="EU" color={TEAM_GRAD} />
                        <div className="conv-main">
                          <div className="conv-name">{TEAM_NAME}</div>
                          <div className="conv-sub">{teamConv?.snippet || teamSub}</div>
                        </div>
                        {teamConv && teamConv.unread > 0 && (
                          <div className="conv-meta">
                            <span className="conv-badge">{teamConv.unread}</span>
                          </div>
                        )}
                      </button>
                    )}
                    {filteredDirectory.map((e) => (
                      <button type="button" className="conv" key={e.userId} onClick={() => openDM(e)}>
                        <Avatar initials={e.initials} color={e.color} />
                        <div className="conv-main">
                          <div className="conv-name">{e.name}</div>
                          <div className="conv-sub">{e.roleLabel ?? tt(locale, "Mensaje directo", "Direct message")}</div>
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </div>
            </>
          ) : (
            chat && (
              <PanelThread
                conv={selected}
                loadThread={chat.loadThread}
                actions={chat.actions}
                locale={locale}
                onBack={() => setSelected(null)}
                onCall={(kind) => setCall({ kind, conv: selected })}
              />
            )
          )}
        </div>
      )}

      {call && <CallOverlay call={call} locale={locale} onEnd={() => setCall(null)} />}
    </>
  );
}
