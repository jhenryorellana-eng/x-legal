"use client";

/**
 * ValidacionesListView — global validations list for Diana (paralegal).
 *
 * Displays all legal_validations rows with filter pills and navigates
 * to the per-case detail on row click.
 *
 * Pattern: mirrors ensamblador-view.tsx (client component, inline styles,
 * CSS vars, brand components only).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  StatusPill,
  Chip,
  Lex,
  type StatusKind,
} from "@/frontend/components/brand";
// ---------------------------------------------------------------------------
// Inline row type (mirrors LegalValidationRow from integrations module).
// Frontend components MUST NOT import from @/backend — types flow via VM.
// ---------------------------------------------------------------------------

export interface ValidationRowVM {
  id: string;
  case_id: string;
  expediente_id: string;
  attempt_no: number;
  status: "pending" | "sent" | "queued" | "in_review" | "validated" | "needs_corrections" | "cancelled" | "error";
  semaforo: string | null;
  ai_score: number | null;
  verdict: string | null;
  verdict_notes: string | null;
  verdict_findings: unknown;
  verdict_at: string | null;
  return_to: string | null;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// VM types
// ---------------------------------------------------------------------------

export interface ValidacionesListVM {
  rows: ValidationRowVM[];
}

export interface ValidacionesListViewProps {
  vm: ValidacionesListVM;
}

// ---------------------------------------------------------------------------
// Status → StatusPill mapping (7 variants from spec)
// ---------------------------------------------------------------------------

type ValidationStatus = ValidationRowVM["status"];

const STATUS_PILL: Record<ValidationStatus, { kind: StatusKind; label: string }> = {
  pending:           { kind: "pendiente", label: "Enviando…" },
  sent:              { kind: "pendiente", label: "Enviando…" },
  queued:            { kind: "revision",  label: "En cola del abogado" },
  in_review:         { kind: "revision",  label: "En revisión" },
  validated:         { kind: "aprobado",  label: "Validado" },
  needs_corrections: { kind: "corregir",  label: "Devuelto con correcciones" },
  cancelled:         { kind: "pendiente", label: "Cancelada en el SaaS" },
  error:             { kind: "corregir",  label: "Error de envío" },
};

// ---------------------------------------------------------------------------
// Semáforo dot
// ---------------------------------------------------------------------------

type Semaforo = "green" | "amber" | "red" | null;

function SemaforoDot({ value }: { value: Semaforo | string | null }) {
  if (!value) return null;
  const color =
    value === "green" ? "var(--green)" :
    value === "amber" ? "var(--gold-deep)" :
    "var(--red)";
  return (
    <span
      aria-label={"Semáforo " + value}
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: 999,
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

type FilterTab = "all" | "active" | "corrections" | "validated";

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all",         label: "Todas" },
  { id: "active",      label: "En curso" },
  { id: "corrections", label: "Con correcciones" },
  { id: "validated",   label: "Validadas" },
];

function matchesFilter(row: ValidationRowVM, tab: FilterTab): boolean {
  if (tab === "all") return true;
  if (tab === "active") return ["pending", "sent", "queued", "in_review"].includes(row.status);
  if (tab === "corrections") return row.status === "needs_corrections";
  if (tab === "validated") return row.status === "validated";
  return true;
}

// Sort: needs_corrections first, then by created_at desc
function sortRows(rows: ValidationRowVM[]): ValidationRowVM[] {
  return [...rows].sort((a, b) => {
    if (a.status === "needs_corrections" && b.status !== "needs_corrections") return -1;
    if (b.status === "needs_corrections" && a.status !== "needs_corrections") return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

function formatRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return "hace " + String(mins) + " min";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return "hace " + String(hrs) + " h";
    return new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ValidacionesListView({ vm }: ValidacionesListViewProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState<FilterTab>("all");

  const filtered = sortRows(vm.rows.filter((r) => matchesFilter(r, activeTab)));

  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Page header                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ marginBottom: 20 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 900,
            color: "var(--ink)",
            margin: "0 0 4px",
            fontFamily: "var(--font-title)",
          }}
        >
          Validaciones
        </h1>
        <p style={{ fontSize: 14, color: "var(--ink-2)", margin: 0 }}>
          Todos los expedientes enviados a revisión con abogado.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Filter pills                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        {FILTER_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                height: 34,
                padding: "0 16px",
                borderRadius: 999,
                border: active ? "1.5px solid var(--accent)" : "1.5px solid var(--line)",
                background: active ? "var(--blue-soft)" : "var(--card)",
                color: active ? "var(--accent)" : "var(--ink-2)",
                fontFamily: "var(--font-title)",
                fontWeight: 800,
                fontSize: 13,
                cursor: "pointer",
                transition: "all 0.15s var(--ease)",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* List / empty                                                         */}
      {/* ------------------------------------------------------------------ */}
      {filtered.length === 0 ? (
        <Card>
          <div
            style={{
              textAlign: "center",
              padding: "48px 20px",
              color: "var(--ink-2)",
            }}
          >
            <Lex mood="calma" size={110} />
            <h3
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: "var(--ink)",
                marginTop: 12,
              }}
            >
              Nada en validación ahora mismo
            </h3>
            <p style={{ fontSize: 13.5, marginTop: 6, color: "var(--ink-2)" }}>
              Cuando se envíe un expediente a revisión con el abogado aparecerá aquí.
            </p>
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ padding: 4 }}>
            {/* Table header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr 80px",
                gap: 12,
                padding: "0 12px 10px",
                borderBottom: "1.5px solid var(--line)",
              }}
            >
              {["Caso", "Intento", "Estado", "Semáforo", "Movimiento"].map((h) => (
                <span
                  key={h}
                  style={{
                    fontSize: 11.5,
                    fontWeight: 800,
                    color: "var(--ink-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    fontFamily: "var(--font-title)",
                  }}
                >
                  {h}
                </span>
              ))}
            </div>

            {/* Rows */}
            <div style={{ display: "flex", flexDirection: "column" }}>
              {filtered.map((row, idx) => {
                const pill = STATUS_PILL[row.status] ?? { kind: "pendiente" as StatusKind, label: row.status };
                const semColor: Record<string, string> = {
                  green: "Semáforo verde",
                  amber: "Semáforo ámbar",
                  red: "Semáforo rojo",
                };
                const semLabel = row.semaforo ? semColor[row.semaforo] ?? row.semaforo : null;
                const semTone: Record<string, "green" | "gold" | "amber" | "red"> = {
                  green: "green",
                  amber: "amber",
                  red: "red",
                };
                const semChipTone = row.semaforo ? (semTone[row.semaforo] ?? "blue") : null;
                const lastEvent = row.verdict_at ?? row.sent_at ?? row.created_at;

                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => router.push("/legal/validaciones/" + row.case_id)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 1fr 1fr 1fr 80px",
                      gap: 12,
                      padding: "14px 12px",
                      borderBottom: idx < filtered.length - 1 ? "1px solid var(--line)" : "none",
                      background: "none",
                      border: "none",
                      borderRadius: 0,
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background 0.12s var(--ease)",
                      width: "100%",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "var(--blue-soft)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "none";
                    }}
                  >
                    {/* Case col */}
                    <div style={{ minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: 14,
                          fontWeight: 800,
                          color: "var(--ink)",
                          margin: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontFamily: "var(--font-title)",
                        }}
                      >
                        {row.case_id.slice(0, 8).toUpperCase()}
                      </p>
                      <p
                        style={{
                          fontSize: 12,
                          color: "var(--ink-3)",
                          margin: 0,
                        }}
                      >
                        {"Caso " + row.case_id.slice(0, 8)}
                      </p>
                    </div>

                    {/* Attempt col */}
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <Chip tone="blue">{"Intento " + String(row.attempt_no)}</Chip>
                    </div>

                    {/* Status col */}
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <StatusPill kind={pill.kind}>{pill.label}</StatusPill>
                    </div>

                    {/* Semáforo col */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <SemaforoDot value={row.semaforo} />
                      {semLabel && semChipTone && (
                        <Chip tone={semChipTone}>{semLabel}</Chip>
                      )}
                      {!semLabel && (
                        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>—</span>
                      )}
                    </div>

                    {/* Movement col */}
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 700 }}>
                        {formatRelative(lastEvent)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
