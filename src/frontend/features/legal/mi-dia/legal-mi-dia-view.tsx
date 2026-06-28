"use client";

/**
 * Diana — "Mi día" (legal) · /legal/mi-dia (DOC-54 §0.5, DOC-12 RF-DIA workflow).
 *
 * Diana's personal tasks ARE her case work (review documents, fill forms,
 * assemble expedientes). This view surfaces two things:
 *   1. "Pendientes" — actionable work derived from her owned cases, each with a
 *      deep link that resumes the work where she left off (drafts persist).
 *   2. "Mis tareas" — a personal checklist (staff_tasks) she manages herself.
 *
 * Presentational + data-driven: every value is a prop; mutations are injected
 * server actions (boundary R1/R2). The RSC page composes the strings/data.
 */

import * as React from "react";
import Link from "next/link";
import { MSym } from "@/frontend/features/vanessa/shared/msym";
import { Chip } from "@/frontend/features/vanessa/shared/ui";
import { useToast } from "@/frontend/features/vanessa/shared/toast-bridge";

// ---------------------------------------------------------------------------
// VM types (built by the RSC page; no backend imports here)
// ---------------------------------------------------------------------------

export interface LegalKpi {
  icon: string;
  value: number | string;
  label: string;
  tone?: string;
  hot?: boolean;
}

/** One actionable item derived from a case (DOC-54 §2.2 "panel de pendientes"). */
export interface PendienteVM {
  id: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  icon: string;
  /** Localized title, e.g. "Revisar documentos". */
  title: string;
  /** Optional detail, e.g. "3 documentos" or "Formulario 60%". */
  detail?: string;
  /** 0–100 progress, when the work has a measurable completion. */
  progress?: number;
  /** Deep link that resumes the work (Documentos tab / form wizard / assembler). */
  href: string;
  /** Visual urgency. */
  tone: "info" | "warn" | "danger" | "ok";
}

/** One personal task (staff_tasks). */
export interface PersonalTaskVM {
  id: string;
  text: string;
  tag: string;
  done: boolean;
}

export interface LegalMiDiaStrings {
  greeting: string;
  dateLine: string;
  tzChip: string;
  kpiReview: string;
  kpiExpedientes: string;
  kpiCorrections: string;
  kpiCases: string;
  pendientesTitle: string;
  pendientesChip: string;
  emptyPendientes: string;
  continueCta: string;
  tasksTitle: string;
  addTaskPh: string;
  addTask: string;
  emptyTasks: string;
  editTask: string;
  deleteTask: string;
  confirmDelete: string;
  taskError: string;
}

export interface LegalMiDiaActions {
  createTask: (input: { text: string }) => Promise<{ ok: boolean; taskId?: string; error?: { code: string } }>;
  /** Pure toggle (flips the current server state); the client tracks the result. */
  toggleTask: (input: { taskId: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
  updateTask: (input: { taskId: string; text?: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
  deleteTask: (input: { taskId: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
}

export interface LegalMiDiaViewProps {
  kpis: LegalKpi[];
  pendientes: PendienteVM[];
  tasks: PersonalTaskVM[];
  strings: LegalMiDiaStrings;
  actions: LegalMiDiaActions;
}

// ---------------------------------------------------------------------------
// Tone → colour
// ---------------------------------------------------------------------------

const TONE_COLOR: Record<PendienteVM["tone"], string> = {
  info: "var(--accent)",
  warn: "var(--brand-gold, #FFC629)",
  danger: "var(--red)",
  ok: "var(--green)",
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LegalMiDiaView({ kpis, pendientes, tasks: initialTasks, strings, actions }: LegalMiDiaViewProps) {
  const toast = useToast();
  const [tasks, setTasks] = React.useState<PersonalTaskVM[]>(initialTasks);
  const [newTask, setNewTask] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState("");
  // Two-step delete: first click arms, second confirms. Auto-disarms after 3s so
  // a stray click never destroys a task without an explicit confirmation.
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = setTimeout(() => setConfirmDeleteId(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmDeleteId]);

  const addTask = async () => {
    const text = newTask.trim();
    if (!text || busy) return;
    setBusy(true);
    setNewTask("");
    // Optimistic insert with a temporary id; reconcile with the server id.
    const tempId = `tmp-${text}-${tasks.length}`;
    setTasks((ts) => [...ts, { id: tempId, text, tag: "", done: false }]);
    const res = await actions.createTask({ text });
    if (!res.ok) {
      setTasks((ts) => ts.filter((t) => t.id !== tempId));
      setNewTask(text);
      toast.error(strings.taskError);
    } else if (res.taskId) {
      setTasks((ts) => ts.map((t) => (t.id === tempId ? { ...t, id: res.taskId! } : t)));
    }
    setBusy(false);
  };

  const toggleTask = async (t: PersonalTaskVM) => {
    const next = !t.done;
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: next } : x)));
    const res = await actions.toggleTask({ taskId: t.id });
    if (!res.ok) {
      setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: t.done } : x)));
      toast.error(strings.taskError);
    }
  };

  const saveEdit = async (t: PersonalTaskVM) => {
    const text = editValue.trim();
    setEditingId(null);
    if (!text || text === t.text) return;
    const prev = tasks;
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, text } : x)));
    const res = await actions.updateTask({ taskId: t.id, text });
    if (!res.ok) {
      setTasks(prev);
      toast.error(strings.taskError);
    }
  };

  const removeTask = async (t: PersonalTaskVM) => {
    const prev = tasks;
    setTasks((ts) => ts.filter((x) => x.id !== t.id));
    const res = await actions.deleteTask({ taskId: t.id });
    if (!res.ok) {
      setTasks(prev);
      toast.error(strings.taskError);
    }
  };

  return (
    <div className="fade-up">
      <div className="v-head">
        <div>
          <h1 className="v-title">{strings.greeting}</h1>
          <div className="v-sub">{strings.dateLine}</div>
        </div>
        <Chip tone="blue" icon="schedule">{strings.tzChip}</Chip>
      </div>

      {/* KPIs */}
      <div className="kpi-row stagger">
        {kpis.map((k, i) => (
          <div key={i} className={`kpi${k.hot ? " hot" : ""}`}>
            <div
              className="kpi-ico"
              style={k.hot ? undefined : { background: `color-mix(in srgb, ${k.tone} 16%, transparent)`, color: k.tone }}
            >
              <MSym name={k.icon} size={22} />
            </div>
            <div className="kpi-val">{k.value}</div>
            <div className="kpi-lbl">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="cols2">
        {/* Pendientes derived from her case work */}
        <div className="vcard vcard-pad fade-up">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div className="vcard-title">
              <MSym name="checklist" size={20} />
              {strings.pendientesTitle}
            </div>
            {pendientes.length > 0 && <Chip tone="amber" icon="bolt">{strings.pendientesChip}</Chip>}
          </div>

          {pendientes.length === 0 ? (
            <div className="kcol-empty" style={{ padding: "26px 12px" }}>{strings.emptyPendientes}</div>
          ) : (
            pendientes.map((p) => (
              <Link
                key={p.id}
                href={p.href}
                className="attend-row"
                style={{ textDecoration: "none", color: "inherit", alignItems: "center" }}
              >
                <div
                  className="src-ico"
                  style={{ background: `color-mix(in srgb, ${TONE_COLOR[p.tone]} 16%, transparent)`, color: TONE_COLOR[p.tone] }}
                  title={p.title}
                >
                  <MSym name={p.icon} size={19} />
                </div>
                <div className="attend-main">
                  <div className="attend-name">{p.title}</div>
                  <div className="attend-meta">
                    <span>{p.caseNumber}</span>·<span>{p.clientName}</span>
                    {p.detail && <><span aria-hidden>·</span><span>{p.detail}</span></>}
                  </div>
                  {typeof p.progress === "number" && (
                    <div style={{ height: 5, borderRadius: 3, background: "var(--line)", marginTop: 6, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, Math.max(0, p.progress))}%`, height: "100%", background: TONE_COLOR[p.tone] }} />
                    </div>
                  )}
                </div>
                <span className="vbtn vbtn-ghost vbtn-sm" style={{ pointerEvents: "none" }}>
                  {strings.continueCta}
                  <MSym name="arrow_forward" size={16} />
                </span>
              </Link>
            ))
          )}
        </div>

        {/* Personal tasks (staff_tasks) */}
        <div className="vcard vcard-pad fade-up">
          <div className="vcard-title" style={{ marginBottom: 12 }}>
            <MSym name="task_alt" size={20} />
            {strings.tasksTitle}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTask(); } }}
              placeholder={strings.addTaskPh}
              style={{ flex: 1 }}
              aria-label={strings.addTask}
            />
            <button type="button" className="vbtn vbtn-primary vbtn-sm" disabled={busy || !newTask.trim()} onClick={addTask}>
              <MSym name="add" size={18} />
              {strings.addTask}
            </button>
          </div>

          {tasks.length === 0 ? (
            <div className="kcol-empty" style={{ padding: "20px 12px" }}>{strings.emptyTasks}</div>
          ) : (
            tasks.map((t) => (
              <div className="task-row" key={t.id} style={{ alignItems: "center" }}>
                <button
                  type="button"
                  className={`task-check${t.done ? " done" : ""}`}
                  onClick={() => toggleTask(t)}
                  aria-pressed={t.done}
                  aria-label={t.text}
                >
                  <MSym name="check" size={15} />
                </button>

                {editingId === t.id ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => saveEdit(t)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); saveEdit(t); }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    style={{ flex: 1, fontSize: 13 }}
                    aria-label={strings.editTask}
                  />
                ) : (
                  <span className={`task-txt${t.done ? " done" : ""}`} style={{ flex: 1 }}>{t.text}</span>
                )}

                <button
                  type="button"
                  className="mini-btn"
                  title={strings.editTask}
                  aria-label={strings.editTask}
                  onClick={() => { setEditingId(t.id); setEditValue(t.text); }}
                >
                  <MSym name="edit" size={16} />
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  title={confirmDeleteId === t.id ? strings.confirmDelete : strings.deleteTask}
                  aria-label={confirmDeleteId === t.id ? strings.confirmDelete : strings.deleteTask}
                  style={confirmDeleteId === t.id ? { color: "var(--red)" } : undefined}
                  onClick={() => {
                    if (confirmDeleteId === t.id) { setConfirmDeleteId(null); removeTask(t); }
                    else setConfirmDeleteId(t.id);
                  }}
                >
                  <MSym name={confirmDeleteId === t.id ? "check" : "delete"} size={16} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
