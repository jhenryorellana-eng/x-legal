"use client";

/**
 * PagosGlobalView — `/finanzas/pagos` global payments hub (Andrium · finance).
 *
 * Zones:
 *  1. Panel gate: downpayment installments pending (gold-glow Card)
 *  2. Tabs: Calendario · Morosidad · Conciliación
 *  3. Tab Calendario: due installments grouped by day
 *  4. Tab Morosidad: overdue installments grouped by case
 *  5. Tab Conciliación: placeholder "Próximamente"
 *
 * Sources of truth:
 *  - DOC-55-UI-ANDRIUM §3.1–3.4, §3.8–3.9, §3.10
 *  - PROMPT-AND-03 Zonas 3–4
 *  - RF-AND-014 (Calendario), RF-AND-020 (Morosidad)
 *
 * Boundaries: MUST NOT import from @/backend. Types flow via VM structs.
 */

import * as React from "react";
import Link from "next/link";
import {
  Card,
  GradientBtn,
  GhostBtn,
  StatusPill,
  Chip,
  Lex,
  Icon,
  IconTile,
  type StatusKind,
} from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";

// ---------------------------------------------------------------------------
// VM types (fed from server component — serialisable, no backend imports)
// ---------------------------------------------------------------------------

/** DueCalendarItemDto shape (DTOs from task brief). */
export interface DueCalendarItemVM {
  installmentId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  number: number;
  installmentCount: number;
  amountCents: number;
  status: "pending" | "processing" | "paid" | "overdue" | "waived";
  isDownpayment: boolean;
  dueDate: string;
}

/** OverdueItemDto shape (DTOs from task brief). */
export interface OverdueItemVM {
  installmentId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  number: number;
  amountCents: number;
  dueDate: string;
  daysLate: number;
}

/** Gate item: downpayment pending for a payment_pending case. */
export interface GateItemVM {
  installmentId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  serviceName: string;
  amountCents: number;
  /** ISO timestamp of contract signature */
  signedAt: string;
  isDownpayment: true;
}

export interface DueCalendarGroupVM {
  /** e.g. "2026-06-15" */
  date: string;
  items: DueCalendarItemVM[];
}

export interface OverdueGroupVM {
  caseId: string;
  caseNumber: string;
  clientName: string;
  totalOverdueCents: number;
  maxDaysLate: number;
  items: OverdueItemVM[];
}

export interface PagosGlobalVM {
  gateItems: GateItemVM[];
  calendarGroups: DueCalendarGroupVM[];
  overdueGroups: OverdueGroupVM[];
  locale: "es" | "en";
}

export interface PagosGlobalViewProps {
  vm: PagosGlobalVM;
  tEs: Record<string, string>;
  tEn: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

function usd(cents: number) {
  return USD.format(cents / 100);
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d
    .toLocaleDateString("es-US", { weekday: "long", day: "numeric", month: "short" })
    .toUpperCase();
}

function hoursAgo(isoString: string): number {
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60);
}

/** Returns how many days from now until dueDate (negative = past). */
function daysUntil(dueDateStr: string): number {
  const now = new Date();
  const due = new Date(dueDateStr + "T23:59:59");
  return Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const INSTALLMENT_STATUS_MAP: Record<
  DueCalendarItemVM["status"],
  { kind: StatusKind; labelEs: string; labelEn: string }
> = {
  pending: { kind: "pendiente", labelEs: "Pendiente", labelEn: "Pending" },
  processing: { kind: "revision", labelEs: "En proceso", labelEn: "Processing" },
  paid: { kind: "hecho", labelEs: "Pagada", labelEn: "Paid" },
  overdue: { kind: "corregir", labelEs: "Vencida", labelEn: "Overdue" },
  waived: { kind: "aprobado", labelEs: "Condonada", labelEn: "Waived" },
};

// ---------------------------------------------------------------------------
// TimeBadge (gate urgency)
// ---------------------------------------------------------------------------

function TimeBadge({ signedAt }: { signedAt: string }) {
  const hrs = hoursAgo(signedAt);
  if (hrs > 72) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          background: "var(--red-soft)",
          color: "var(--red)",
          borderRadius: 999,
          padding: "4px 10px",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 12,
          animation: "blink 1.4s step-start infinite",
        }}
      >
        <Icon name="clock" size={13} color="var(--red)" />
        {Math.round(hrs / 24)}d
      </span>
    );
  }
  if (hrs > 24) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          background: "var(--gold-soft)",
          color: "var(--gold-deep)",
          borderRadius: 999,
          padding: "4px 10px",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 12,
        }}
      >
        <Icon name="clock" size={13} color="var(--gold-deep)" />
        {Math.round(hrs)}h
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// GatePanel
// ---------------------------------------------------------------------------

function GatePanel({ items }: { items: GateItemVM[] }) {
  if (items.length === 0) return null;

  return (
    <Card
      glow="var(--gold-deep)"
      style={{
        border: "1.5px solid color-mix(in srgb, var(--gold-deep) 28%, transparent)",
        background: "color-mix(in srgb, var(--gold-soft) 35%, var(--card))",
        marginBottom: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
        <IconTile name="bolt" color="var(--gold-deep)" size={44} iconSize={22} />
        <div>
          <p style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", margin: 0 }}>
            Cuotas iniciales por cobrar
          </p>
          <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "2px 0 0" }}>
            Sin este pago el caso no arranca
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item) => (
          <div
            key={item.installmentId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              background: "var(--card)",
              borderRadius: 12,
              border: "1px solid var(--line)",
            }}
          >
            {/* Client + Case */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--ink)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.clientName}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
                {item.caseNumber} · {item.serviceName}
              </p>
            </div>

            {/* Amount */}
            <span
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: "var(--ink)",
                flexShrink: 0,
              }}
            >
              {usd(item.amountCents)}
            </span>

            {/* Urgency badge */}
            <TimeBadge signedAt={item.signedAt} />

            {/* CTA */}
            <Link href={`/finanzas/pagos/caso/${item.caseId}`}>
              <GradientBtn
                size="sm"
                full={false}
                style={{ padding: "0 20px", height: 38, borderRadius: 999, minWidth: 90 }}
              >
                Cobrar
              </GradientBtn>
            </Link>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Calendar Tab
// ---------------------------------------------------------------------------

function CalendarRow({ item, locale }: { item: DueCalendarItemVM; locale: "es" | "en" }) {
  const statusEntry = INSTALLMENT_STATUS_MAP[item.status];
  const days = daysUntil(item.dueDate);
  const labelInstallment =
    locale === "es"
      ? `Cuota ${item.number} de ${item.installmentCount}`
      : `Installment ${item.number} of ${item.installmentCount}`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {/* Case + client */}
      <div style={{ flex: 1.5, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
          {item.caseNumber}
        </p>
        <p
          style={{
            margin: "2px 0 0",
            fontSize: 12,
            color: "var(--ink-3)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.clientName}
        </p>
      </div>

      {/* Installment label */}
      <span style={{ flex: 1.2, fontSize: 13, color: "var(--ink-2)", whiteSpace: "nowrap" }}>
        {labelInstallment}
      </span>

      {/* Amount */}
      <span style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)", flexShrink: 0 }}>
        {usd(item.amountCents)}
      </span>

      {/* Status decorations */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        {item.status === "waived" ? (
          <Chip tone="gold">
            {locale === "es" ? "Condonada" : "Waived"}
          </Chip>
        ) : (
          <StatusPill kind={statusEntry.kind}>
            {locale === "es" ? statusEntry.labelEs : statusEntry.labelEn}
          </StatusPill>
        )}
        {/* Due soon decorations (§3.2 — without mutating status) */}
        {(item.status === "pending") && days === 0 && (
          <Chip tone="gold">{locale === "es" ? "Vence hoy" : "Due today"}</Chip>
        )}
        {(item.status === "pending") && days > 0 && days <= 3 && (
          <Chip tone="gold">
            {locale === "es" ? `Vence en ${days} días` : `Due in ${days} days`}
          </Chip>
        )}
      </div>

      {/* Action link */}
      {(item.status === "pending" || item.status === "overdue") && (
        <Link
          href={`/finanzas/pagos/caso/${item.caseId}`}
          style={{ flexShrink: 0 }}
          aria-label={`Gestionar cuota de ${item.clientName}`}
        >
          <GhostBtn size="md" full={false} style={{ height: 34, padding: "0 14px", borderRadius: 999 }}>
            <Icon name="chevR" size={16} color="var(--accent)" />
          </GhostBtn>
        </Link>
      )}
    </div>
  );
}

function CalendarTab({
  groups,
  locale,
}: {
  groups: DueCalendarGroupVM[];
  locale: "es" | "en";
}) {
  if (groups.length === 0) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center" }}>
        <Lex mood="calma" size={78} />
        <p style={{ marginTop: 16, color: "var(--ink-2)" }}>
          {locale === "es"
            ? "Sin vencimientos en este rango."
            : "No due installments in this range."}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {groups.map((group) => {
        const dayTotal = group.items.reduce((s, i) => s + i.amountCents, 0);
        return (
          <Card key={group.date} style={{ padding: 0, overflow: "hidden" }}>
            {/* Day header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                background: "var(--hover, rgba(47,107,255,0.04))",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.07em",
                  color: "var(--ink-3)",
                  textTransform: "uppercase",
                }}
              >
                {formatDayLabel(group.date)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)" }}>
                {usd(dayTotal)}
              </span>
            </div>

            {group.items.map((item) => (
              <CalendarRow key={item.installmentId} item={item} locale={locale} />
            ))}
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overdue Tab
// ---------------------------------------------------------------------------

function OverdueRow({ item, locale }: { item: OverdueItemVM; locale: "es" | "en" }) {
  const label =
    locale === "es"
      ? `${item.daysLate} días de atraso`
      : `${item.daysLate} days late`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span style={{ flex: 1, fontSize: 13, color: "var(--ink)" }}>
        {locale === "es"
          ? `Cuota ${item.number}`
          : `Installment ${item.number}`}
      </span>
      <span style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)", flexShrink: 0 }}>
        {usd(item.amountCents)}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--red)",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <Link
        href={`/finanzas/pagos/caso/${item.caseId}`}
        style={{ flexShrink: 0 }}
        aria-label={locale === "es" ? "Gestionar cuota vencida" : "Manage overdue installment"}
      >
        <GhostBtn size="md" full={false} style={{ height: 34, padding: "0 14px", borderRadius: 999 }}>
          <Icon name="chevR" size={16} color="var(--accent)" />
        </GhostBtn>
      </Link>
    </div>
  );
}

function OverdueTab({
  groups,
  locale,
}: {
  groups: OverdueGroupVM[];
  locale: "es" | "en";
}) {
  if (groups.length === 0) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center" }}>
        <Lex mood="celebra" size={78} />
        <p style={{ marginTop: 16, color: "var(--ink-2)" }}>
          {locale === "es"
            ? "Sin cuotas vencidas. Cartera al día."
            : "No overdue installments. Portfolio up to date."}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {groups.map((group) => (
        <Card key={group.caseId} style={{ padding: 0, overflow: "hidden" }}>
          {/* Group header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 14px",
              background: "color-mix(in srgb, var(--red-soft) 60%, var(--card))",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <div>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
                {group.clientName}
              </span>
              <span style={{ marginLeft: 8, fontSize: 13, color: "var(--ink-3)" }}>
                {group.caseNumber}
              </span>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--red)" }}>
                {usd(group.totalOverdueCents)}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  background: "var(--red-soft)",
                  color: "var(--red)",
                  borderRadius: 999,
                  padding: "4px 10px",
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 12,
                  animation: "blink 1.4s step-start infinite",
                }}
              >
                <Icon name="clock" size={13} color="var(--red)" />
                {group.maxDaysLate}
                {locale === "es" ? "d" : "d"}
              </span>
            </div>
          </div>

          {group.items.map((item) => (
            <OverdueRow key={item.installmentId} item={item} locale={locale} />
          ))}
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reconciliation Tab (placeholder §3.9)
// ---------------------------------------------------------------------------

function ReconciliationTab({ locale }: { locale: "es" | "en" }) {
  return (
    <div
      style={{
        padding: "48px 24px",
        textAlign: "center",
        background: "var(--card)",
        borderRadius: "var(--r-lg)",
        border: "1px solid var(--line)",
      }}
    >
      <Lex mood="calma" size={78} />
      <p style={{ marginTop: 16, fontWeight: 700, color: "var(--ink)" }}>
        {locale === "es" ? "Conciliación — Próximamente" : "Reconciliation — Coming soon"}
      </p>
      <p style={{ marginTop: 8, color: "var(--ink-2)", maxWidth: 400, margin: "8px auto 0" }}>
        {locale === "es"
          ? "La conciliación global de pagos estará disponible en la próxima ola. Mientras tanto, revisa los pagos caso a caso en el estado de cuenta."
          : "Global payment reconciliation will be available in the next wave. In the meantime, review payments case by case in the account statement."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabId = "calendario" | "morosidad" | "conciliacion";

const TABS: Array<{ id: TabId; labelEs: string; labelEn: string }> = [
  { id: "calendario", labelEs: "Calendario", labelEn: "Calendar" },
  { id: "morosidad", labelEs: "Morosidad", labelEn: "Overdue" },
  { id: "conciliacion", labelEs: "Conciliación", labelEn: "Reconciliation" },
];

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function PagosGlobalView({ vm, tEs: _tEs, tEn: _tEn }: PagosGlobalViewProps) {
  const [activeTab, setActiveTab] = React.useState<TabId>("calendario");
  void toast; // referenced for potential use in child actions

  const locale = vm.locale;

  return (
    <div style={{ padding: "32px 32px 48px" }}>
      {/* Page title */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "var(--ink)",
            margin: 0,
            fontFamily: "var(--font-title)",
          }}
        >
          {locale === "es" ? "Pagos y cuotas" : "Payments & installments"}
        </h1>
      </div>

      {/* Gate panel (visible only if ≥1 gate item) */}
      <GatePanel items={vm.gateItems} />

      {/* Tabs */}
      <div
        role="tablist"
        aria-label={locale === "es" ? "Secciones de pagos" : "Payment sections"}
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 24,
          borderBottom: "2px solid var(--line)",
          paddingBottom: 0,
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: "none",
                border: "none",
                borderBottom: isActive ? "2.5px solid var(--accent)" : "2.5px solid transparent",
                color: isActive ? "var(--accent)" : "var(--ink-3)",
                fontFamily: "var(--font-title)",
                fontWeight: isActive ? 800 : 600,
                fontSize: 14,
                padding: "10px 18px",
                cursor: "pointer",
                marginBottom: -2,
                transition: "color 0.15s, border-color 0.15s",
                outline: "none",
              }}
              onFocus={(e) => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow =
                  "0 0 0 3px var(--accent-soft, rgba(47,107,255,0.18))";
              }}
              onBlur={(e) => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
              }}
            >
              {locale === "es" ? tab.labelEs : tab.labelEn}
            </button>
          );
        })}
      </div>

      {/* Tab panels */}
      <div
        id="panel-calendario"
        role="tabpanel"
        aria-labelledby="tab-calendario"
        hidden={activeTab !== "calendario"}
      >
        <CalendarTab groups={vm.calendarGroups} locale={locale} />
      </div>

      <div
        id="panel-morosidad"
        role="tabpanel"
        aria-labelledby="tab-morosidad"
        hidden={activeTab !== "morosidad"}
      >
        <OverdueTab groups={vm.overdueGroups} locale={locale} />
      </div>

      <div
        id="panel-conciliacion"
        role="tabpanel"
        aria-labelledby="tab-conciliacion"
        hidden={activeTab !== "conciliacion"}
      >
        <ReconciliationTab locale={locale} />
      </div>

      {/* Keyframe for blink animation (overdue badge, §3.2) */}
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
