"use client";

/**
 * Mi día — sales daily dashboard (DOC-52 §1, RF-VAN-001..005).
 *
 * 4 KPIs, "Por atender ahora" (uncontacted leads with time-badge + mini-actions),
 * today's agenda timeline, pending tasks (immediate toggle), Lex proactive
 * briefing. Presentational + data-driven: every value is a prop; mutations are
 * injected actions (DOC-50 §2/§5). The RSC page composes the strings/data.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { MSym } from "../shared/msym";
import { Chip, sourceMeta, timeTier } from "../shared/ui";
import { LexBubble } from "../shared/lex";
import { useLexPrefs } from "../shared/lex-prefs";
import { useToast } from "../shared/toast-bridge";

export interface MiDiaKpi {
  hot?: boolean;
  icon: string;
  value: number | string;
  label: string;
  tone?: string;
  flag?: string;
  trend?: { dir: "up" | "down"; label: string } | null;
}

export interface AttendLead {
  id: string;
  /** Display name OR phone when no name. */
  title: string;
  source: string;
  sourceLabel: string;
  serviceLabel: string;
  minutes: number;
  ageLabel: string;
  phone: string | null;
}

export interface AgendaItem {
  id: string;
  time: string;
  tzAbbr: string;
  name: string;
  kind: "c1" | "c2" | "c3" | "call";
  seqLabel: string; // "Cita 2" | "Llamada"
  objective: string;
  isCall: boolean;
  isVideo: boolean;
}

export interface MiDiaTask {
  id: string;
  text: string;
  tag: string;
  done: boolean;
}

export interface MiDiaStrings {
  greeting: string; // "Buenos días, Vanessa ☀️"
  dateLine: string; // "Miércoles, 3 de junio · Sé exactamente por dónde empezar."
  tzChip: string; // "Hora local: Florida (ET)"
  attendTitle: string;
  attendChip: string;
  emptyAttend: string;
  seeLeads: string; // "Ver los {n} leads"
  agendaTitle: string;
  emptyAgenda: string;
  tasksTitle: string;
  enterCall: string; // "Entrar a la videollamada"
  call: string;
  whatsapp: string;
  schedule: string;
  lexBriefHtml: string;
  lexContactLabel: string;
  lexMessagingLabel: string;
  lexEnabled: boolean;
}

export interface MiDiaActions {
  /** Registers first contact (tel:/wa) and clears contacted_at. */
  contactLead: (input: {
    leadId: string;
    channel: "call" | "whatsapp";
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  toggleTask: (input: {
    taskId: string;
    done: boolean;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
}

export interface MiDiaViewProps {
  kpis: MiDiaKpi[];
  attend: AttendLead[];
  agenda: AgendaItem[];
  tasks: MiDiaTask[];
  totalUncontacted: number;
  strings: MiDiaStrings;
  actions: MiDiaActions;
  onScheduleLead: (leadId: string) => void;
}

export function MiDiaView({
  kpis,
  attend,
  agenda,
  tasks: initialTasks,
  totalUncontacted,
  strings,
  actions,
  onScheduleLead,
}: MiDiaViewProps) {
  const router = useRouter();
  const toast = useToast();
  const { bubbles } = useLexPrefs();
  const [tasks, setTasks] = React.useState(initialTasks);
  const [rows, setRows] = React.useState(attend);
  const onOpenLeads = () => router.push("/ventas/leads");
  const onOpenMessaging = () => toast.info(strings.lexMessagingLabel);

  const toggleTask = async (t: MiDiaTask) => {
    const next = !t.done;
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: next } : x)));
    const res = await actions.toggleTask({ taskId: t.id, done: next });
    if (!res.ok) {
      // revert optimistic update
      setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: t.done } : x)));
      toast.error(strings.tasksTitle);
    }
  };

  const contact = async (l: AttendLead, channel: "call" | "whatsapp") => {
    // Open the native channel immediately (real action, not simulated).
    if (l.phone) {
      const url =
        channel === "call"
          ? `tel:${l.phone}`
          : `https://wa.me/${l.phone.replace(/[^\d]/g, "")}`;
      window.open(url, channel === "call" ? "_self" : "_blank");
    }
    const res = await actions.contactLead({ leadId: l.id, channel });
    if (res.ok) {
      setRows((rs) => rs.filter((x) => x.id !== l.id));
      toast.success(
        channel === "call" ? `${strings.call} · ${l.title}` : `${strings.whatsapp} · ${l.title}`,
      );
    }
  };

  return (
    <div className="fade-up">
      <div className="v-head">
        <div>
          <h1 className="v-title">{strings.greeting}</h1>
          <div className="v-sub">{strings.dateLine}</div>
        </div>
        <Chip tone="blue" icon="schedule">
          {strings.tzChip}
        </Chip>
      </div>

      <LexBubble
        dismissKey="mi-dia-brief"
        orb={34}
        enabled={strings.lexEnabled && bubbles}
        html={strings.lexBriefHtml}
        actions={[
          {
            label: strings.lexContactLabel,
            icon: "call",
            onClick: () => rows[0] && contact(rows[0], "call"),
          },
          {
            label: strings.lexMessagingLabel,
            icon: "forum",
            ghost: true,
            onClick: onOpenMessaging,
          },
        ]}
      />

      {/* KPIs */}
      <div className="kpi-row stagger">
        {kpis.map((k, i) => (
          <div key={i} className={`kpi${k.hot ? " hot" : ""}`}>
            {k.flag && (
              <div className="kpi-flag">
                <MSym name="bolt" size={13} />
                {k.flag}
              </div>
            )}
            <div
              className="kpi-ico"
              style={
                k.hot
                  ? undefined
                  : {
                      background: `color-mix(in srgb, ${k.tone} 16%, transparent)`,
                      color: k.tone,
                    }
              }
            >
              <MSym name={k.icon} size={22} />
            </div>
            <div className="kpi-val">{k.value}</div>
            <div className="kpi-lbl">{k.label}</div>
            {k.trend && (
              <div className={`kpi-trend ${k.trend.dir}`}>
                <MSym
                  name={k.trend.dir === "up" ? "trending_up" : "trending_down"}
                  size={15}
                />
                {k.trend.label}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="cols2">
        {/* Por atender ahora */}
        <div className="vcard vcard-pad fade-up">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <div className="vcard-title">
              <MSym name="priority_high" size={20} />
              {strings.attendTitle}
            </div>
            <Chip tone="red" icon="bolt">
              {strings.attendChip}
            </Chip>
          </div>

          {rows.length === 0 ? (
            <div className="kcol-empty" style={{ padding: "26px 12px" }}>
              {strings.emptyAttend}
            </div>
          ) : (
            rows.map((l) => {
              const sm = sourceMeta(l.source);
              const tier = timeTier(l.minutes);
              return (
                <div className="attend-row" key={l.id}>
                  <div className={`src-ico ${sm.cls}`} title={l.sourceLabel}>
                    <MSym name={sm.icon} size={19} />
                  </div>
                  <div className="attend-main">
                    <div className="attend-name">{l.title}</div>
                    <div className="attend-meta">
                      <span>{l.sourceLabel}</span>·<span>{l.serviceLabel}</span>
                    </div>
                  </div>
                  <span className={`time-badge ${tier}`}>{l.ageLabel}</span>
                  <div className="mini-acts">
                    <button
                      type="button"
                      className="mini-btn call"
                      title={strings.call}
                      aria-label={`${strings.call} ${l.title}`}
                      onClick={() => contact(l, "call")}
                    >
                      <MSym name="call" size={18} />
                    </button>
                    <button
                      type="button"
                      className="mini-btn wa"
                      title={strings.whatsapp}
                      aria-label={`${strings.whatsapp} ${l.title}`}
                      onClick={() => contact(l, "whatsapp")}
                    >
                      <MSym name="chat" size={18} />
                    </button>
                    <button
                      type="button"
                      className="mini-btn cal"
                      title={strings.schedule}
                      aria-label={`${strings.schedule} ${l.title}`}
                      onClick={() => onScheduleLead(l.id)}
                    >
                      <MSym name="event" size={18} />
                    </button>
                  </div>
                </div>
              );
            })
          )}

          <button
            type="button"
            className="vbtn vbtn-ghost vbtn-sm"
            style={{ marginTop: 6 }}
            onClick={onOpenLeads}
          >
            {strings.seeLeads.replace("{n}", String(totalUncontacted))}
            <MSym name="arrow_forward" size={18} />
          </button>
        </div>

        {/* Agenda + tareas */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="vcard vcard-pad fade-up">
            <div className="vcard-title" style={{ marginBottom: 12 }}>
              <MSym name="today" size={20} />
              {strings.agendaTitle}
            </div>
            {agenda.length === 0 ? (
              <div className="kcol-empty" style={{ padding: "22px 12px" }}>
                {strings.emptyAgenda}
              </div>
            ) : (
              agenda.map((a) => (
                <div className="tl-item" key={a.id}>
                  <div className="tl-time">
                    {a.time}
                    <small>{a.tzAbbr}</small>
                  </div>
                  <div
                    className="tl-bar"
                    style={{
                      background:
                        a.kind === "c1"
                          ? "#2F6BFF"
                          : a.kind === "c2"
                            ? "#8B5CF6"
                            : a.kind === "c3"
                              ? "#1BB673"
                              : "#F59E0B",
                    }}
                  />
                  <div className="tl-body">
                    <div className="tl-name">{a.name}</div>
                    <div className="tl-sub">
                      <Chip tone={a.isCall ? "amber" : "neutral"} style={{ height: 20, fontSize: 10.5 }}>
                        {a.seqLabel}
                      </Chip>
                      {a.objective}
                    </div>
                    {a.isVideo && (
                      <button
                        type="button"
                        className="zoom-btn"
                        onClick={() =>
                          toast.success(`${strings.enterCall} · ${a.name}`)
                        }
                      >
                        <MSym name="videocam" size={16} />
                        {strings.enterCall}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="vcard vcard-pad fade-up">
            <div className="vcard-title" style={{ marginBottom: 8 }}>
              <MSym name="checklist" size={20} />
              {strings.tasksTitle}
            </div>
            {tasks.map((t) => (
              <div className="task-row" key={t.id}>
                <button
                  type="button"
                  className={`task-check${t.done ? " done" : ""}`}
                  onClick={() => toggleTask(t)}
                  aria-pressed={t.done}
                  aria-label={t.text}
                >
                  <MSym name="check" size={15} />
                </button>
                <span className={`task-txt${t.done ? " done" : ""}`}>{t.text}</span>
                <span className="task-tag">{t.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
