"use client";

/**
 * ContabilidadView — `/finanzas/contabilidad` libro contable (Andrium · finance).
 *
 * Zones (DOC-55 §5, PROMPT-AND-05):
 *  1. Month selector (← month →) + "Exportar CSV" + "Registrar gasto"
 *  2. Three KPIs: ingresos · egresos · balance (delta vs previous month)
 *  3. Category breakdown (horizontal bars)
 *  4. Collection metrics (recaudado · % al día · morosidad) — same source as the kanban KPI strip
 *  5. Libro table with filters; automatic entries are LOCKED (candado), manual entries editable
 *
 * Boundaries: MUST NOT import from @/backend. Data flows via the serialisable VM.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, GradientBtn, GhostBtn, Chip, Icon, ProgressBar, Lex } from "@/frontend/components/brand";
import { Kpi, Modal, toast } from "@/frontend/components/desktop";

// ---------------------------------------------------------------------------
// VM types
// ---------------------------------------------------------------------------

export interface LedgerItemVM {
  id: string;
  entryDate: string;
  kind: "income" | "expense";
  category: string;
  amountCents: number;
  description: string | null;
  caseId: string | null;
  caseNumber: string | null;
  isAutomatic: boolean;
  recordedBy: string | null;
}

export interface CategoryBreakdownVM {
  kind: "income" | "expense";
  category: string;
  totalCents: number;
  pct: number; // 0..100 relative to the largest bucket
}

export interface ContabilidadVM {
  month: string; // YYYY-MM
  monthLabel: string;
  monthStart: string; // YYYY-MM-DD
  monthEnd: string; // YYYY-MM-DD
  prevMonth: string;
  nextMonth: string;
  canGoNext: boolean;
  summary: {
    incomeCents: number;
    expenseCents: number;
    balanceCents: number;
    deltaIncomePct: number | null;
    deltaExpensePct: number | null;
    deltaBalancePct: number | null;
  };
  breakdown: CategoryBreakdownVM[];
  metrics: {
    collectedMonthCents: number;
    onTimePct: number;
    overdueCuotas: number;
    overdueMontoCents: number;
    overdueCasos: number;
  };
  entries: LedgerItemVM[];
  nextCursor: string | null;
  locale: "es" | "en";
}

export interface BillingResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
}

export interface ContabilidadViewProps {
  vm: ContabilidadVM;
  actions: {
    record: (input: {
      kind: "income" | "expense";
      category: string;
      amountCents: number;
      entryDate?: string;
      description?: string | null;
      caseId?: string | null;
    }) => Promise<BillingResult<{ id: string }>>;
    update: (
      entryId: string,
      patch: { category?: string; amountCents?: number; entryDate?: string; description?: string | null },
    ) => Promise<BillingResult>;
    loadMore: (cursor: string) => Promise<BillingResult<{ items: LedgerItemVM[]; nextCursor: string | null }>>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
function usd(cents: number) {
  return USD.format(cents / 100);
}
function signedUsd(kind: "income" | "expense", cents: number) {
  return `${kind === "expense" ? "−" : "+"}${usd(cents)}`;
}

function tt(locale: "es" | "en", es: string, en: string) {
  return locale === "es" ? es : en;
}

// ---------------------------------------------------------------------------
// Delta badge
// ---------------------------------------------------------------------------

function DeltaBadge({ pct, locale }: { pct: number | null; locale: "es" | "en" }) {
  if (pct === null) {
    return <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{tt(locale, "sin mes previo", "no prior month")}</span>;
  }
  const up = pct >= 0;
  const color = up ? "var(--green)" : "var(--red)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 700, color }}>
      <Icon name={up ? "chevD" : "chevD"} size={11} color={color} />
      {up ? "+" : ""}
      {pct}% {tt(locale, "vs. mes anterior", "vs. last month")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Entry form modal (record + edit)
// ---------------------------------------------------------------------------

interface EntryFormState {
  kind: "income" | "expense";
  category: string;
  amount: string; // dollars text
  entryDate: string;
  description: string;
}

function EntryFormFields({
  state,
  setState,
  locale,
  lockKind,
}: {
  state: EntryFormState;
  setState: React.Dispatch<React.SetStateAction<EntryFormState>>;
  locale: "es" | "en";
  lockKind?: boolean;
}) {
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--ink-2)", marginBottom: 6, display: "block" };
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)",
    background: "var(--card)", color: "var(--ink)", fontSize: 14, outline: "none",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!lockKind && (
        <div>
          <label style={labelStyle}>{tt(locale, "Tipo", "Type")}</label>
          <div style={{ display: "flex", gap: 8 }}>
            {(["expense", "income"] as const).map((k) => {
              const active = state.kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, kind: k }))}
                  style={{
                    flex: 1, padding: "9px 12px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700,
                    border: active ? "1.5px solid var(--accent)" : "1px solid var(--line)",
                    background: active ? "var(--accent-soft, rgba(47,107,255,0.10))" : "var(--card)",
                    color: active ? "var(--accent)" : "var(--ink-2)",
                  }}
                >
                  {k === "expense" ? tt(locale, "Egreso", "Expense") : tt(locale, "Ingreso", "Income")}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <label style={labelStyle}>{tt(locale, "Categoría", "Category")}</label>
        <input
          style={inputStyle}
          value={state.category}
          onChange={(e) => setState((s) => ({ ...s, category: e.target.value }))}
          placeholder={tt(locale, "ej. marketing, salarios, impresión", "e.g. marketing, payroll, printing")}
          maxLength={60}
        />
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{tt(locale, "Monto (USD)", "Amount (USD)")}</label>
          <input
            style={inputStyle}
            value={state.amount}
            inputMode="decimal"
            onChange={(e) => setState((s) => ({ ...s, amount: e.target.value.replace(/[^0-9.]/g, "") }))}
            placeholder="0.00"
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{tt(locale, "Fecha", "Date")}</label>
          <input
            style={inputStyle}
            type="date"
            value={state.entryDate}
            onChange={(e) => setState((s) => ({ ...s, entryDate: e.target.value }))}
          />
        </div>
      </div>
      <div>
        <label style={labelStyle}>{tt(locale, "Descripción (opcional)", "Description (optional)")}</label>
        <input
          style={inputStyle}
          value={state.description}
          onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))}
          maxLength={200}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Libro row
// ---------------------------------------------------------------------------

function LedgerRow({
  item,
  locale,
  onEdit,
}: {
  item: LedgerItemVM;
  locale: "es" | "en";
  onEdit: (item: LedgerItemVM) => void;
}) {
  const incomeTone = item.kind === "income";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "92px 88px 1.3fr 1.6fr 96px 120px 84px",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{item.entryDate}</span>
      <Chip tone={incomeTone ? "green" : "red"}>
        {incomeTone ? tt(locale, "Ingreso", "Income") : tt(locale, "Egreso", "Expense")}
      </Chip>
      <Chip tone="blue">{item.category}</Chip>
      <span style={{ fontSize: 13, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.description ?? "—"}
        {item.caseNumber && (
          <>
            {" · "}
            {item.caseId ? (
              <Link href={`/finanzas/pagos/caso/${item.caseId}`} style={{ color: "var(--accent)", fontWeight: 700 }}>
                {item.caseNumber}
              </Link>
            ) : (
              <span style={{ color: "var(--ink-3)" }}>{item.caseNumber}</span>
            )}
          </>
        )}
      </span>
      {/* Origen */}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        {item.isAutomatic ? (
          <span
            title={tt(locale, "Generado por un pago — no editable", "Generated by a payment — not editable")}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--ink-3)" }}
          >
            <Icon name="lock" size={13} color="var(--ink-3)" />
            {tt(locale, "Automático", "Automatic")}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{tt(locale, "Manual", "Manual")}</span>
        )}
      </span>
      {/* Monto */}
      <span style={{ textAlign: "right", fontWeight: 800, fontSize: 14, color: incomeTone ? "var(--green)" : "var(--red)" }}>
        {signedUsd(item.kind, item.amountCents)}
      </span>
      {/* Acciones — Editar SOLO en manuales (ausente, no deshabilitado, en automáticos) */}
      <span style={{ textAlign: "right" }}>
        {!item.isAutomatic && (
          <GhostBtn size="md" full={false} onClick={() => onEdit(item)} style={{ height: 32, padding: "0 12px", borderRadius: 999 }}>
            <Icon name="edit" size={14} color="var(--accent)" />
          </GhostBtn>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ContabilidadView({ vm, actions }: ContabilidadViewProps) {
  const router = useRouter();
  const locale = vm.locale;

  const [entries, setEntries] = React.useState<LedgerItemVM[]>(vm.entries);
  const [cursor, setCursor] = React.useState<string | null>(vm.nextCursor);
  const [loadingMore, setLoadingMore] = React.useState(false);

  // Filters (client-side over loaded entries)
  const [kindFilter, setKindFilter] = React.useState<"all" | "income" | "expense">("all");
  const [search, setSearch] = React.useState("");

  // Modals
  const [recordOpen, setRecordOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<LedgerItemVM | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const todayIso = vm.month >= new Date().toISOString().slice(0, 7) ? new Date().toISOString().slice(0, 10) : `${vm.month}-01`;

  const [recordState, setRecordState] = React.useState<EntryFormState>({
    kind: "expense", category: "", amount: "", entryDate: todayIso, description: "",
  });
  const [editState, setEditState] = React.useState<EntryFormState>({
    kind: "expense", category: "", amount: "", entryDate: todayIso, description: "",
  });

  // Keep entries in sync when the server re-renders for a new month.
  React.useEffect(() => {
    setEntries(vm.entries);
    setCursor(vm.nextCursor);
  }, [vm.entries, vm.nextCursor]);

  const filtered = entries.filter((e) => {
    if (kindFilter !== "all" && e.kind !== kindFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (
        !e.category.toLowerCase().includes(q) &&
        !(e.description ?? "").toLowerCase().includes(q) &&
        !(e.caseNumber ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  function navigateMonth(month: string) {
    router.push(`/finanzas/contabilidad?month=${month}`);
  }

  function parseAmountCents(text: string): number | null {
    const value = parseFloat(text);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100);
  }

  async function submitRecord() {
    const cents = parseAmountCents(recordState.amount);
    if (!cents) {
      toast.error(tt(locale, "Ingresa un monto válido", "Enter a valid amount"));
      return;
    }
    if (!recordState.category.trim()) {
      toast.error(tt(locale, "La categoría es obligatoria", "Category is required"));
      return;
    }
    setSubmitting(true);
    const res = await actions.record({
      kind: recordState.kind,
      category: recordState.category.trim(),
      amountCents: cents,
      entryDate: recordState.entryDate,
      description: recordState.description.trim() || null,
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success(tt(locale, "Asiento registrado", "Entry recorded"));
      setRecordOpen(false);
      setRecordState({ kind: "expense", category: "", amount: "", entryDate: todayIso, description: "" });
      router.refresh();
    } else {
      toast.error(tt(locale, "No se pudo registrar", "Could not record"));
    }
  }

  function openEdit(item: LedgerItemVM) {
    setEditItem(item);
    setEditState({
      kind: item.kind,
      category: item.category,
      amount: (item.amountCents / 100).toFixed(2),
      entryDate: item.entryDate,
      description: item.description ?? "",
    });
  }

  async function submitEdit() {
    if (!editItem) return;
    const cents = parseAmountCents(editState.amount);
    if (!cents) {
      toast.error(tt(locale, "Ingresa un monto válido", "Enter a valid amount"));
      return;
    }
    setSubmitting(true);
    const res = await actions.update(editItem.id, {
      category: editState.category.trim(),
      amountCents: cents,
      entryDate: editState.entryDate,
      description: editState.description.trim() || null,
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success(tt(locale, "Asiento actualizado", "Entry updated"));
      setEditItem(null);
      router.refresh();
    } else {
      toast.error(tt(locale, "No se pudo actualizar", "Could not update"));
    }
  }

  async function handleLoadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    const res = await actions.loadMore(cursor);
    setLoadingMore(false);
    if (res.ok && res.data) {
      setEntries((prev) => [...prev, ...res.data!.items]);
      setCursor(res.data.nextCursor);
    } else {
      toast.error(tt(locale, "No se pudo cargar más", "Could not load more"));
    }
  }

  // Export CSV link (current month + kind filter)
  const exportParams = new URLSearchParams({ from: vm.monthStart, to: vm.monthEnd });
  if (kindFilter !== "all") exportParams.set("kind", kindFilter);
  const exportHref = `/api/v1/billing/ledger/export?${exportParams.toString()}`;

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--ink-2)" };

  return (
    <div style={{ padding: "32px 32px 48px" }}>
      {/* Header: month selector + actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <GhostBtn size="md" full={false} onClick={() => navigateMonth(vm.prevMonth)} style={{ height: 38, width: 38, padding: 0, borderRadius: 999 }} aria-label={tt(locale, "Mes anterior", "Previous month")}>
            <Icon name="chevL" size={18} color="var(--accent)" />
          </GhostBtn>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", margin: 0, fontFamily: "var(--font-title)", minWidth: 180, textAlign: "center" }}>
            {vm.monthLabel}
          </h1>
          <GhostBtn
            size="md"
            full={false}
            onClick={() => vm.canGoNext && navigateMonth(vm.nextMonth)}
            disabled={!vm.canGoNext}
            style={{ height: 38, width: 38, padding: 0, borderRadius: 999, opacity: vm.canGoNext ? 1 : 0.4 }}
            aria-label={tt(locale, "Mes siguiente", "Next month")}
          >
            <Icon name="chevR" size={18} color="var(--accent)" />
          </GhostBtn>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <a href={exportHref} target="_blank" rel="noopener noreferrer">
            <GhostBtn size="md" full={false} style={{ height: 40, padding: "0 16px", borderRadius: 999 }}>
              <Icon name="external" size={15} color="var(--accent)" /> {tt(locale, "Exportar CSV", "Export CSV")}
            </GhostBtn>
          </a>
          <GradientBtn size="md" full={false} onClick={() => setRecordOpen(true)} style={{ height: 40, padding: "0 18px", borderRadius: 999 }}>
            <Icon name="plus" size={16} color="#fff" /> {tt(locale, "Registrar gasto", "Record expense")}
          </GradientBtn>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 8 }}>
        <div>
          <Kpi icon="dollar" label={tt(locale, "Ingresos del mes", "Income this month")} value={usd(vm.summary.incomeCents)} />
          <div style={{ marginTop: 6 }}><DeltaBadge pct={vm.summary.deltaIncomePct} locale={locale} /></div>
        </div>
        <div>
          <Kpi icon="card" label={tt(locale, "Egresos del mes", "Expenses this month")} value={usd(vm.summary.expenseCents)} />
          <div style={{ marginTop: 6 }}><DeltaBadge pct={vm.summary.deltaExpensePct} locale={locale} /></div>
        </div>
        <div>
          <Kpi icon="wallet" label={tt(locale, "Balance", "Balance")} value={usd(vm.summary.balanceCents)} hot />
          <div style={{ marginTop: 6 }}><DeltaBadge pct={vm.summary.deltaBalancePct} locale={locale} /></div>
        </div>
      </div>

      {/* Category breakdown + collection metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, margin: "20px 0" }}>
        <Card>
          <p style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", margin: "0 0 14px" }}>
            {tt(locale, "Desglose por categoría", "Breakdown by category")}
          </p>
          {vm.breakdown.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--ink-3)" }}>{tt(locale, "Sin movimientos este mes.", "No movements this month.")}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {vm.breakdown.map((b) => (
                <div key={`${b.kind}:${b.category}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>
                      <span style={{ color: b.kind === "income" ? "var(--green)" : "var(--red)" }}>●</span> {b.category}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>{usd(b.totalCents)}</span>
                  </div>
                  <ProgressBar pct={b.pct} height={8} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <p style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", margin: "0 0 14px" }}>
            {tt(locale, "Cobranza", "Collections")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={labelStyle}>{tt(locale, "Recaudado del mes", "Collected this month")}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: "var(--green)" }}>{usd(vm.metrics.collectedMonthCents)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={labelStyle}>{tt(locale, "Cuotas al día", "Installments on time")}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>{Math.round(vm.metrics.onTimePct)}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={labelStyle}>{tt(locale, "Morosidad", "Overdue")}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: vm.metrics.overdueCuotas > 0 ? "var(--red)" : "var(--ink)" }}>
                {usd(vm.metrics.overdueMontoCents)}
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)", marginLeft: 6 }}>
                  ({vm.metrics.overdueCuotas} {tt(locale, "cuotas", "installments")} · {vm.metrics.overdueCasos} {tt(locale, "casos", "cases")})
                </span>
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 999, padding: 3 }}>
          {(["all", "income", "expense"] as const).map((k) => {
            const active = kindFilter === k;
            const label = k === "all" ? tt(locale, "Todos", "All") : k === "income" ? tt(locale, "Ingresos", "Income") : tt(locale, "Egresos", "Expenses");
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKindFilter(k)}
                style={{
                  padding: "6px 14px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
                  background: active ? "var(--accent)" : "transparent", color: active ? "#fff" : "var(--ink-2)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>
            <Icon name="search" size={15} color="var(--ink-3)" />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tt(locale, "Buscar categoría, descripción o caso…", "Search category, description or case…")}
            style={{
              width: "100%", padding: "9px 12px 9px 34px", borderRadius: 999, border: "1px solid var(--line)",
              background: "var(--card)", color: "var(--ink)", fontSize: 13, outline: "none",
            }}
          />
        </div>
      </div>

      {/* Libro table */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {/* Header row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "92px 88px 1.3fr 1.6fr 96px 120px 84px",
            gap: 10,
            padding: "10px 14px",
            background: "var(--hover, rgba(47,107,255,0.04))",
            borderBottom: "1px solid var(--line)",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.05em",
            color: "var(--ink-3)",
            textTransform: "uppercase",
          }}
        >
          <span>{tt(locale, "Fecha", "Date")}</span>
          <span>{tt(locale, "Tipo", "Type")}</span>
          <span>{tt(locale, "Categoría", "Category")}</span>
          <span>{tt(locale, "Descripción", "Description")}</span>
          <span>{tt(locale, "Origen", "Origin")}</span>
          <span style={{ textAlign: "right" }}>{tt(locale, "Monto", "Amount")}</span>
          <span />
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: "48px 0", textAlign: "center" }}>
            <Lex mood="calma" size={78} />
            <p style={{ marginTop: 14, color: "var(--ink-2)" }}>
              {tt(locale, "Sin asientos para los filtros actuales.", "No entries for the current filters.")}
            </p>
          </div>
        ) : (
          filtered.map((item) => <LedgerRow key={item.id} item={item} locale={locale} onEdit={openEdit} />)
        )}
      </Card>

      {cursor && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <GhostBtn size="md" full={false} onClick={handleLoadMore} disabled={loadingMore} style={{ height: 38, padding: "0 20px", borderRadius: 999 }}>
            {loadingMore ? tt(locale, "Cargando…", "Loading…") : tt(locale, "Cargar más", "Load more")}
          </GhostBtn>
        </div>
      )}

      {/* Record modal */}
      <Modal
        open={recordOpen}
        onOpenChange={setRecordOpen}
        title={tt(locale, "Registrar asiento manual", "Record manual entry")}
        description={tt(locale, "Los ingresos automáticos nacen de pagos confirmados.", "Automatic income comes from confirmed payments.")}
        footer={
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <GhostBtn size="md" full={false} onClick={() => setRecordOpen(false)} style={{ height: 40, padding: "0 18px" }}>
              {tt(locale, "Cancelar", "Cancel")}
            </GhostBtn>
            <GradientBtn size="md" full={false} onClick={submitRecord} disabled={submitting} style={{ height: 40, padding: "0 20px" }}>
              {submitting ? tt(locale, "Guardando…", "Saving…") : tt(locale, "Guardar", "Save")}
            </GradientBtn>
          </div>
        }
      >
        <EntryFormFields state={recordState} setState={setRecordState} locale={locale} />
      </Modal>

      {/* Edit modal (manual only) */}
      <Modal
        open={editItem !== null}
        onOpenChange={(o) => !o && setEditItem(null)}
        title={tt(locale, "Editar asiento", "Edit entry")}
        footer={
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <GhostBtn size="md" full={false} onClick={() => setEditItem(null)} style={{ height: 40, padding: "0 18px" }}>
              {tt(locale, "Cancelar", "Cancel")}
            </GhostBtn>
            <GradientBtn size="md" full={false} onClick={submitEdit} disabled={submitting} style={{ height: 40, padding: "0 20px" }}>
              {submitting ? tt(locale, "Guardando…", "Saving…") : tt(locale, "Guardar", "Save")}
            </GradientBtn>
          </div>
        }
      >
        <EntryFormFields state={editState} setState={setEditState} locale={locale} lockKind />
      </Modal>
    </div>
  );
}
