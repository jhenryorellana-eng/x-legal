"use client";

/**
 * CaseTabAccessView — admin matrix to configure which case-workspace tabs each
 * staff role can see (/admin/configuracion/tabs-caso).
 *
 * Visibility only: order + the "locked until the case is active" gating stay in
 * code. Rows = tabs (canonical order), columns = roles. A checked cell = the role
 * sees that tab. Presentational — reads its data + a single bulk save action from
 * the server page (no @/backend import).
 */

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";
import { toast } from "@/frontend/components/desktop";
import type { CaseTabId, StaffRole } from "@/shared/constants/case-tabs";

export interface CaseTabAccessMessages {
  title: string;
  sub: string;
  colTab: string;
  save: string;
  saved: string;
  saveError: string;
  reset: string;
  lockedNote: string;
  conditionalNote: string;
  lockedBadge: string;
}

export interface CaseTabAccessViewProps {
  /** Tabs in canonical order. */
  tabs: Array<{ id: CaseTabId; label: string; locked: boolean }>;
  /** The four staff roles, with localized labels. */
  roles: Array<{ role: StaffRole; label: string }>;
  /** Current effective visible set per role (override if configured, else default). */
  initial: Record<StaffRole, CaseTabId[]>;
  /** Per-role code defaults (for the "restablecer" action). */
  defaults: Record<StaffRole, CaseTabId[]>;
  messages: CaseTabAccessMessages;
  /** Bulk save: the full desired visible set per role. */
  save: (input: {
    access: Array<{ role: StaffRole; tabIds: CaseTabId[] }>;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
}

export function CaseTabAccessView({
  tabs,
  roles,
  initial,
  defaults,
  messages,
  save,
}: CaseTabAccessViewProps) {
  const [matrix, setMatrix] = React.useState<Record<string, Set<CaseTabId>>>(() => {
    const out: Record<string, Set<CaseTabId>> = {};
    for (const r of roles) out[r.role] = new Set(initial[r.role] ?? []);
    return out;
  });
  const [saving, setSaving] = React.useState(false);

  function toggle(role: StaffRole, tab: CaseTabId) {
    setMatrix((prev) => {
      const next = { ...prev };
      const set = new Set(next[role]);
      if (set.has(tab)) set.delete(tab);
      else set.add(tab);
      next[role] = set;
      return next;
    });
  }

  function resetRole(role: StaffRole) {
    setMatrix((prev) => ({ ...prev, [role]: new Set(defaults[role] ?? []) }));
  }

  async function onSave() {
    setSaving(true);
    try {
      const access = roles.map((r) => ({
        role: r.role,
        tabIds: tabs.filter((t) => matrix[r.role]?.has(t.id)).map((t) => t.id),
      }));
      const res = await save({ access });
      if (res.ok) toast.success(messages.saved);
      else toast.error(messages.saveError);
    } catch {
      toast.error(messages.saveError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 920 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 22, color: "var(--ink)" }}>
          {messages.title}
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--ink-2)", fontSize: 14 }}>{messages.sub}</p>
      </header>

      <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 14, background: "var(--card, #fff)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={thStyle("left")}>{messages.colTab}</th>
              {roles.map((r) => (
                <th key={r.role} style={thStyle("center")}>
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tabs.map((tab) => (
              <tr key={tab.id}>
                <td style={tdStyle("left")}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {tab.label}
                    {tab.locked && (
                      <span
                        title={messages.lockedNote}
                        style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: "var(--ink-3)" }}
                      >
                        <Icon name="lock" size={12} color="var(--ink-3)" />
                        {messages.lockedBadge}
                      </span>
                    )}
                  </span>
                </td>
                {roles.map((r) => {
                  const checked = matrix[r.role]?.has(tab.id) ?? false;
                  return (
                    <td key={r.role} style={tdStyle("center")}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(r.role, tab.id)}
                        aria-label={`${tab.label} — ${r.label}`}
                        style={{ width: 18, height: 18, cursor: "pointer", accentColor: "var(--accent)" }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td style={tdStyle("left")} />
              {roles.map((r) => (
                <td key={r.role} style={tdStyle("center")}>
                  <button
                    type="button"
                    onClick={() => resetRole(r.role)}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--ink-2)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    {messages.reset}
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{messages.conditionalNote}</span>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{messages.lockedNote}</span>
      </div>

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 14,
            fontWeight: 700,
            color: "#fff",
            background: "var(--accent)",
            border: "none",
            borderRadius: 999,
            padding: "10px 20px",
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          <Icon name="check" size={16} color="#fff" />
          {messages.save}
        </button>
      </div>
    </div>
  );
}

function thStyle(align: "left" | "center"): React.CSSProperties {
  return {
    textAlign: align,
    padding: "12px 14px",
    fontSize: 12.5,
    fontWeight: 800,
    color: "var(--ink-2)",
    borderBottom: "1px solid var(--line)",
    background: "var(--card-alt, #fafafa)",
    whiteSpace: "nowrap",
  };
}

function tdStyle(align: "left" | "center"): React.CSSProperties {
  return {
    textAlign: align,
    padding: "10px 14px",
    color: "var(--ink)",
    borderBottom: "1px solid var(--line)",
  };
}
