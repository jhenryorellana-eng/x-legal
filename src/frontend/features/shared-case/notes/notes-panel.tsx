"use client";

/**
 * NotesPanel — reusable notes list + composer for the 3 visibility levels
 * (general / team / personal). Used by the case "Notas" tab and by the
 * leads/casos board note modals. Self-contained: brand components + design
 * tokens only (no vanessa-scoped CSS), errors render inline. Consumers pass
 * already-bound callbacks (onAdd/onRemove and, for lazy surfaces, onLoad) so
 * the panel stays agnostic of case vs lead.
 */

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";
import { Avatar } from "@/frontend/components/brand/avatar";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import type { IconName } from "@/frontend/components/brand/icon";
import { Modal } from "@/frontend/components/desktop/modal";

export type NoteVisibility = "general" | "team" | "personal";

export const NOTE_VISIBILITY_ORDER: readonly NoteVisibility[] = ["general", "team", "personal"];

export interface NoteView {
  id: string;
  body: string;
  visibility: NoteVisibility;
  authorName: string | null;
  authorAvatar: string | null;
  createdAt: string;
  fromLead: boolean;
  canEdit: boolean;
}

export interface NotesStrings {
  composerPlaceholder: string;
  save: string;
  empty: string;
  fromLead: string;
  delete: string;
  confirmDelete: string;
  cancel: string;
  loading: string;
  errorGeneric: string;
  filterAll: string;
  visibility: Record<NoteVisibility, { label: string; hint: string }>;
}

export interface NotesPanelProps {
  /** Preloaded notes (case tab). Omit + provide onLoad for lazy surfaces. */
  notes?: NoteView[];
  /** Lazy loader (board modals). Fetches on mount when `notes` is absent. */
  onLoad?: () => Promise<NoteView[]>;
  onAdd: (body: string, visibility: NoteVisibility) => Promise<NoteView | null>;
  onRemove: (noteId: string) => Promise<boolean>;
  strings: NotesStrings;
  locale: "es" | "en";
  defaultVisibility?: NoteVisibility;
  allowedVisibilities?: readonly NoteVisibility[];
  /**
   * Bound the list to its own scroll (composer/filters stay fixed). Use in the
   * board modals. In the case tab leave it off so the whole page scrolls.
   */
  scrollList?: boolean;
}

const VIS_META: Record<NoteVisibility, { icon: IconName; color: string }> = {
  general: { icon: "globe", color: "var(--accent)" },
  team: { icon: "briefcase", color: "var(--gold-deep)" },
  personal: { icon: "lock", color: "var(--green)" },
};

function formatDate(iso: string, locale: "es" | "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function VisBadge({ visibility, label }: { visibility: NoteVisibility; label: string }) {
  const meta = VIS_META[visibility];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 22,
        padding: "0 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        color: meta.color,
        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
      }}
    >
      <Icon name={meta.icon} size={12} color={meta.color} />
      {label}
    </span>
  );
}

export function NotesPanel({
  notes: preloaded,
  onLoad,
  onAdd,
  onRemove,
  strings,
  locale,
  defaultVisibility = "team",
  allowedVisibilities = NOTE_VISIBILITY_ORDER,
  scrollList = false,
}: NotesPanelProps) {
  const [notes, setNotes] = React.useState<NoteView[]>(preloaded ?? []);
  const [loading, setLoading] = React.useState<boolean>(!preloaded && !!onLoad);
  const [body, setBody] = React.useState("");
  const [visibility, setVisibility] = React.useState<NoteVisibility>(defaultVisibility);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<NoteVisibility | "all">("all");
  const [confirmId, setConfirmId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (preloaded) setNotes(preloaded);
  }, [preloaded]);

  React.useEffect(() => {
    let alive = true;
    if (!preloaded && onLoad) {
      setLoading(true);
      onLoad()
        .then((rows) => alive && setNotes(rows))
        .catch(() => alive && setError(strings.errorGeneric))
        .finally(() => alive && setLoading(false));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = filter === "all" ? notes : notes.filter((n) => n.visibility === filter);

  async function handleSave() {
    const trimmed = body.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    const created = await onAdd(trimmed, visibility);
    setSaving(false);
    if (!created) {
      setError(strings.errorGeneric);
      return;
    }
    setNotes((prev) => [created, ...prev]);
    setBody("");
  }

  async function handleDelete(id: string) {
    setConfirmId(null);
    const prev = notes;
    setNotes((cur) => cur.filter((n) => n.id !== id)); // optimistic
    const ok = await onRemove(id);
    if (!ok) {
      setNotes(prev); // revert
      setError(strings.errorGeneric);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Composer */}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={strings.composerPlaceholder}
        rows={3}
        maxLength={4000}
        aria-label={strings.composerPlaceholder}
        style={{
          width: "100%",
          resize: "vertical",
          borderRadius: 12,
          border: "1px solid var(--line)",
          background: "var(--surface)",
          color: "var(--ink)",
          padding: "10px 12px",
          fontSize: 14,
          fontFamily: "inherit",
          lineHeight: 1.5,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }} role="radiogroup" aria-label="visibility">
          {allowedVisibilities.map((v) => {
            const meta = VIS_META[v];
            const active = visibility === v;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={active}
                title={strings.visibility[v].hint}
                onClick={() => setVisibility(v)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: `1px solid ${active ? meta.color : "var(--line)"}`,
                  background: active ? `color-mix(in srgb, ${meta.color} 12%, transparent)` : "transparent",
                  color: active ? meta.color : "var(--ink-2)",
                }}
              >
                <Icon name={meta.icon} size={14} color={active ? meta.color : "var(--ink-2)"} />
                {strings.visibility[v].label}
              </button>
            );
          })}
        </div>
        <div style={{ marginLeft: "auto" }}>
          <GradientBtn
            size="sm"
            full={false}
            icon="send"
            disabled={!body.trim() || saving}
            onClick={handleSave}
          >
            {strings.save}
          </GradientBtn>
        </div>
      </div>
      {error && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--red)" }} role="alert">
          {error}
        </p>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={strings.filterAll} />
        {NOTE_VISIBILITY_ORDER.map((v) => (
          <FilterChip
            key={v}
            active={filter === v}
            onClick={() => setFilter(v)}
            label={strings.visibility[v].label}
            icon={VIS_META[v].icon}
          />
        ))}
      </div>

      {/* List */}
      {loading ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)" }}>{strings.loading}</p>
      ) : visible.length === 0 ? (
        <p style={{ margin: "8px 0", fontSize: 13, color: "var(--ink-3)" }}>{strings.empty}</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            // In the board modal, bound the list to its own scroll so the composer
            // + filters stay fixed. In the case tab (scrollList=false) let the list
            // grow naturally and the page scroll instead.
            ...(scrollList
              ? { maxHeight: "min(52vh, 460px)", overflowY: "auto", paddingRight: 2 }
              : null),
          }}
        >
          {visible.map((n) => (
            <li
              key={n.id}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 12,
                padding: "12px 14px",
                background: "var(--surface)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <Avatar name={n.authorName ?? "?"} src={n.authorAvatar ?? undefined} size={26} />
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>{n.authorName ?? "—"}</span>
                <VisBadge visibility={n.visibility} label={strings.visibility[n.visibility].label} />
                {n.fromLead && (
                  <span
                    style={{
                      height: 22,
                      padding: "0 8px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      color: "var(--ink-3)",
                      background: "var(--chip)",
                    }}
                  >
                    {strings.fromLead}
                  </span>
                )}
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-3)" }}>
                  {formatDate(n.createdAt, locale)}
                </span>
                {n.canEdit &&
                  (confirmId === n.id ? (
                    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <button type="button" onClick={() => setConfirmId(null)} style={smallBtn(false)}>
                        {strings.cancel}
                      </button>
                      <button type="button" onClick={() => handleDelete(n.id)} style={smallBtn(true)}>
                        {strings.confirmDelete}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      title={strings.delete}
                      aria-label={strings.delete}
                      onClick={() => setConfirmId(n.id)}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--ink-3)",
                        display: "inline-flex",
                        padding: 2,
                      }}
                    >
                      <Icon name="x" size={16} color="var(--ink-3)" />
                    </button>
                  ))}
              </div>
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {n.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function smallBtn(primary: boolean): React.CSSProperties {
  return {
    padding: "4px 9px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    border: `1px solid ${primary ? "var(--red)" : "var(--line)"}`,
    background: primary ? "var(--red)" : "transparent",
    color: primary ? "#fff" : "var(--ink-2)",
  };
}

function FilterChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: IconName;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 11px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#fff" : "var(--ink-2)",
      }}
    >
      {icon && <Icon name={icon} size={13} color={active ? "#fff" : "var(--ink-2)"} />}
      {label}
    </button>
  );
}

/** Modal wrapper for the board note buttons (leads / casos). */
export function NotesModal({
  open,
  onOpenChange,
  title,
  subtitle,
  ...panel
}: NotesPanelProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={subtitle} width={520}>
      <NotesPanel {...panel} scrollList />
    </Modal>
  );
}
