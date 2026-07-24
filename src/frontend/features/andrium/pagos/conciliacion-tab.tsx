"use client";

/**
 * ConciliacionTab — Zelle reconciliation inbox (`/finanzas/pagos` · tab
 * Conciliación · Andrium / finance).
 *
 * Three trays:
 *  1. Por confirmar — bank alerts with a pre-filled suggestion (1-click
 *     confirm; confirming teaches the payer alias).
 *  2. Sin identificar — alerts that matched nobody (deliberately NO random
 *     candidate on screen) with a search-and-assign panel.
 *  3. Auto-aprobados — read-only audit tray of automatic settlements (7d).
 *
 * Boundaries: MUST NOT import from @/backend. Types flow via VM props.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  GradientBtn,
  GhostBtn,
  Chip,
  Lex,
  Icon,
  IconTile,
} from "@/frontend/components/brand";
import { SidePanel, toast } from "@/frontend/components/desktop";
import { getBridge } from "@/frontend/platform-bridge";

// ---------------------------------------------------------------------------
// VM types (serialisable mirrors of zelle-recon DTOs)
// ---------------------------------------------------------------------------

export interface ReconMatchVM {
  matchId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  installmentId: string;
  installmentNumber: number;
  isDownpayment: boolean;
  installmentAmountCents: number;
  dueDate: string;
  score: number;
  tier: "A" | "B";
  signals: Record<string, number | string | boolean>;
}

export interface ReconNotificationVM {
  notificationId: string;
  senderName: string;
  amountCents: number;
  sentOn: string | null;
  memo: string | null;
  refCode: string | null;
  transactionNumber: string;
  receivedAt: string;
  reviewReason: string | null;
  matches: ReconMatchVM[];
}

export interface ReconAutoAppliedVM {
  notificationId: string;
  senderName: string;
  amountCents: number;
  transactionNumber: string;
  caseNumber: string;
  clientName: string;
  installmentNumber: number;
  appliedAt: string | null;
  score: number;
}

export interface ReconConfigVM {
  enabled: boolean;
  tier_a_max_amount_cents: number;
  tier_b_mode: "review_only" | "auto";
}

export interface ReconInboxVMShape {
  porConfirmar: ReconNotificationVM[];
  sinIdentificar: ReconNotificationVM[];
  autoAprobados: ReconAutoAppliedVM[];
  config: ReconConfigVM;
  pendingCount: number;
}

export interface ReconTargetVM {
  installmentId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  installmentNumber: number;
  isDownpayment: boolean;
  amountCents: number;
  dueDate: string;
  amountMatches: boolean;
}

export type ZelleRelationship = "self" | "family" | "third_party";

interface ReconResultShape<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
}

export interface ConciliacionActions {
  confirmZelleMatch: (input: {
    matchId: string;
    relationship: ZelleRelationship;
  }) => Promise<ReconResultShape<{ paymentId: string }>>;
  reassignZelleNotification: (input: {
    notificationId: string;
    installmentId: string;
    relationship: ZelleRelationship;
  }) => Promise<ReconResultShape<{ paymentId: string }>>;
  dismissZelleNotification: (input: {
    notificationId: string;
    reason: string;
  }) => Promise<ReconResultShape>;
  getZelleEvidenceUrl: (notificationId: string) => Promise<ReconResultShape<{ url: string }>>;
  searchReconTargets: (input: {
    query: string;
    amountCents?: number;
  }) => Promise<ReconResultShape<ReconTargetVM[]>>;
}

export interface ConciliacionTabProps {
  vm: ReconInboxVMShape;
  locale: "es" | "en";
  actions: ConciliacionActions;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});
const usd = (cents: number) => USD.format(cents / 100);

const REASON_LABELS: Record<string, { es: string; en: string }> = {
  unknown_reference: { es: "Referencia desconocida", en: "Unknown reference" },
  ambiguous_ref: { es: "Varias referencias en el memo", en: "Multiple references in memo" },
  amount_mismatch: { es: "El monto no calza con la cuota", en: "Amount doesn't match the installment" },
  AMOUNT_MISMATCH: { es: "El monto no calza con la cuota", en: "Amount doesn't match the installment" },
  multi_installment: { es: "Varias cuotas del mismo monto", en: "Several same-amount installments" },
  case_no_payable: { es: "El caso no tiene cuotas por pagar", en: "Case has nothing payable" },
  client_proof_pending: { es: "Hay un comprobante del cliente pendiente", en: "A client proof is pending" },
  CLIENT_PROOF_PENDING: { es: "Hay un comprobante del cliente pendiente", en: "A client proof is pending" },
  auto_settlement_error: { es: "La auto-aprobación falló — confirma a mano", en: "Auto-settlement failed — confirm manually" },
  stripe_pending: { es: "Hay un pago con tarjeta en curso", en: "A card payment is in flight" },
  STRIPE_PENDING: { es: "Hay un pago con tarjeta en curso", en: "A card payment is in flight" },
  identity_conflict: { es: "El pagador está vinculado a otro cliente", en: "Payer linked to another client" },
  breaker_disabled: { es: "Auto-aprobación desactivada", en: "Auto-approval disabled" },
  over_amount_cap: { es: "Supera el tope de auto-aprobación", en: "Over the auto-approval cap" },
  daily_count_cap: { es: "Tope diario de auto-aprobaciones", en: "Daily auto-approval count cap" },
  daily_amount_cap: { es: "Tope diario de monto alcanzado", en: "Daily amount cap reached" },
  payer_daily_cap: { es: "Tope diario por pagador", en: "Per-payer daily cap" },
  tier_b: { es: "Sin código de referencia en el memo", en: "No reference code in memo" },
  template_changed: { es: "Chase cambió la plantilla del correo", en: "Chase changed the email template" },
  auth_failed: { es: "Autenticidad no verificada", en: "Authenticity not verified" },
  resend_mismatch: { es: "Reenvío del banco con datos distintos", en: "Bank resend with different data" },
  no_identifiable_client: { es: "Ningún cliente identificable", en: "No identifiable client" },
};

function reasonLabel(code: string | null, locale: "es" | "en"): string | null {
  if (!code) return null;
  return REASON_LABELS[code]?.[locale] ?? code;
}

function formatDate(iso: string | null, locale: "es" | "en"): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale === "en" ? "en-US" : "es-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const SIGNAL_LABELS: Record<string, { es: string; en: string }> = {
  alias: { es: "pagador conocido", en: "known payer" },
  name: { es: "nombre", en: "name" },
  balance: { es: "saldo exacto", en: "exact balance" },
  installment: { es: "monto de cuota", en: "installment amount" },
  memo: { es: "memo", en: "memo" },
  recent: { es: "reciente", en: "recent" },
};

function signalChips(
  signals: Record<string, number | string | boolean>,
  locale: "es" | "en",
): string[] {
  const chips: string[] = [];
  for (const [key, label] of Object.entries(SIGNAL_LABELS)) {
    const v = signals[key];
    if (typeof v === "number" && v > 0) chips.push(`${label[locale]} (${v})`);
  }
  if (signals.ref_exact === true) {
    chips.unshift(locale === "es" ? "referencia exacta" : "exact reference");
  }
  if (signals.manual_assignment === true) {
    chips.push(locale === "es" ? "asignación manual" : "manual assignment");
  }
  return chips;
}

const RELATIONSHIP_OPTIONS: Array<{ id: ZelleRelationship; es: string; en: string }> = [
  { id: "self", es: "Es el cliente", en: "The client" },
  { id: "family", es: "Familiar", en: "Family member" },
  { id: "third_party", es: "Tercero", en: "Third party" },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "40px 24px",
        textAlign: "center",
        background: "var(--card)",
        borderRadius: "var(--r-lg)",
        border: "1px solid var(--line)",
      }}
    >
      <Lex mood="calma" size={64} />
      <p style={{ marginTop: 12, color: "var(--ink-2)", fontSize: 14 }}>{text}</p>
    </div>
  );
}

function NotificationHeader({ n, locale }: { n: ReconNotificationVM; locale: "es" | "en" }) {
  const reason = reasonLabel(n.reviewReason, locale);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>
          {n.senderName}
        </p>
        <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
          {formatDate(n.sentOn, locale)} · txn {n.transactionNumber}
          {n.memo ? ` · memo: ${n.memo}` : ""}
        </p>
      </div>
      <span style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", flexShrink: 0 }}>
        {usd(n.amountCents)}
      </span>
      {n.refCode ? <Chip>{n.refCode}</Chip> : null}
      {reason ? (
        <Chip tone="gold">{reason}</Chip>
      ) : null}
    </div>
  );
}

function ConfirmControls({
  busy,
  locale,
  onConfirm,
}: {
  busy: boolean;
  locale: "es" | "en";
  onConfirm: (relationship: ZelleRelationship) => void;
}) {
  const [relationship, setRelationship] = React.useState<ZelleRelationship>("self");
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ fontSize: 12, color: "var(--ink-3)" }}>
        {locale === "es" ? "Quién pagó:" : "Who paid:"}{" "}
        <select
          value={relationship}
          onChange={(e) => setRelationship(e.target.value as ZelleRelationship)}
          disabled={busy}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "var(--card)",
            color: "var(--ink)",
            fontSize: 13,
          }}
        >
          {RELATIONSHIP_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {locale === "es" ? o.es : o.en}
            </option>
          ))}
        </select>
      </label>
      <GradientBtn full={false} size="md" onClick={() => onConfirm(relationship)} disabled={busy}>
        <Icon name="check" size={15} color="#fff" />
        {locale === "es" ? "Confirmar pago" : "Confirm payment"}
      </GradientBtn>
    </div>
  );
}

function ReassignPanel({
  notification,
  locale,
  actions,
  onClose,
  onDone,
}: {
  notification: ReconNotificationVM;
  locale: "es" | "en";
  actions: ConciliacionActions;
  onClose: () => void;
  onDone: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [targets, setTargets] = React.useState<ReconTargetVM[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [selected, setSelected] = React.useState<ReconTargetVM | null>(null);
  const [relationship, setRelationship] = React.useState<ZelleRelationship>("family");
  const [busy, setBusy] = React.useState(false);

  const search = React.useCallback(
    async (q: string) => {
      setSearching(true);
      const res = await actions.searchReconTargets({
        query: q,
        amountCents: notification.amountCents,
      });
      setSearching(false);
      if (res.ok && res.data) setTargets(res.data);
    },
    [actions, notification.amountCents],
  );

  React.useEffect(() => {
    void search("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    const res = await actions.reassignZelleNotification({
      notificationId: notification.notificationId,
      installmentId: selected.installmentId,
      relationship,
    });
    setBusy(false);
    if (res.ok) {
      toast(locale === "es" ? "Pago asignado y confirmado" : "Payment assigned and confirmed");
      onDone();
    } else {
      toast(
        locale === "es"
          ? `No se pudo asignar (${reasonLabel(res.error?.code ?? null, locale) ?? res.error?.code})`
          : `Could not assign (${res.error?.code})`,
      );
    }
  };

  return (
    <SidePanel
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={locale === "es" ? "Asignar pago a una cuota" : "Assign payment to an installment"}
      width={430}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            padding: "10px 12px",
            background: "var(--bg-2, var(--card))",
            border: "1px solid var(--line)",
            borderRadius: 10,
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          {notification.senderName} · <b>{usd(notification.amountCents)}</b> · txn{" "}
          {notification.transactionNumber}
        </div>

        <input
          type="search"
          value={query}
          placeholder={locale === "es" ? "Buscar por caso o cliente…" : "Search case or client…"}
          onChange={(e) => {
            setQuery(e.target.value);
            void search(e.target.value);
          }}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "var(--card)",
            color: "var(--ink)",
            fontSize: 14,
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
          {searching ? (
            <p style={{ fontSize: 13, color: "var(--ink-3)" }}>
              {locale === "es" ? "Buscando…" : "Searching…"}
            </p>
          ) : targets.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--ink-3)" }}>
              {locale === "es" ? "Sin cuotas por pagar que coincidan." : "No matching payable installments."}
            </p>
          ) : (
            targets.map((t) => {
              const isSelected = selected?.installmentId === t.installmentId;
              return (
                <button
                  key={t.installmentId}
                  type="button"
                  onClick={() => setSelected(t)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: isSelected
                      ? "1.5px solid var(--accent)"
                      : "1px solid var(--line)",
                    background: isSelected
                      ? "color-mix(in srgb, var(--accent) 8%, var(--card))"
                      : "var(--card)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                      {t.clientName}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: t.amountMatches ? "var(--green, #157347)" : "var(--ink)",
                      }}
                    >
                      {usd(t.amountCents)}
                      {t.amountMatches ? " ✓" : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
                    {t.caseNumber} ·{" "}
                    {t.isDownpayment
                      ? locale === "es"
                        ? "cuota inicial"
                        : "down payment"
                      : `${locale === "es" ? "cuota" : "installment"} ${t.installmentNumber}`}{" "}
                    · {formatDate(t.dueDate, locale)}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {selected && selected.amountCents !== notification.amountCents ? (
          <p style={{ fontSize: 12, color: "var(--red)", margin: 0 }}>
            {locale === "es"
              ? "El monto del pago no coincide con esa cuota — no se puede asignar (sin pagos parciales)."
              : "The payment amount does not match that installment — cannot assign (no partial payments)."}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={relationship}
            onChange={(e) => setRelationship(e.target.value as ZelleRelationship)}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--card)",
              color: "var(--ink)",
              fontSize: 13,
            }}
          >
            {RELATIONSHIP_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {locale === "es" ? o.es : o.en}
              </option>
            ))}
          </select>
          <GradientBtn
            onClick={submit}
            disabled={busy || !selected || selected.amountCents !== notification.amountCents}
          >
            {locale === "es" ? "Asignar y confirmar" : "Assign & confirm"}
          </GradientBtn>
          <GhostBtn full={false} size="md" onClick={onClose} disabled={busy}>
            {locale === "es" ? "Cancelar" : "Cancel"}
          </GhostBtn>
        </div>
      </div>
    </SidePanel>
  );
}

function NotificationCard({
  n,
  locale,
  actions,
  onChanged,
}: {
  n: ReconNotificationVM;
  locale: "es" | "en";
  actions: ConciliacionActions;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [showReassign, setShowReassign] = React.useState(false);
  const [showReject, setShowReject] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");
  const best = n.matches[0] ?? null;

  const confirm = async (relationship: ZelleRelationship) => {
    if (!best) return;
    setBusy(true);
    const res = await actions.confirmZelleMatch({ matchId: best.matchId, relationship });
    setBusy(false);
    if (res.ok) {
      toast(
        locale === "es"
          ? "Pago confirmado — el cliente recibió su comprobante"
          : "Payment confirmed — the client received their receipt",
      );
      onChanged();
    } else {
      toast(
        locale === "es"
          ? `No se pudo confirmar (${reasonLabel(res.error?.code ?? null, locale) ?? res.error?.code})`
          : `Could not confirm (${res.error?.code})`,
      );
    }
  };

  const reject = async () => {
    if (!rejectReason.trim()) return;
    setBusy(true);
    const res = await actions.dismissZelleNotification({
      notificationId: n.notificationId,
      reason: rejectReason.trim(),
    });
    setBusy(false);
    if (res.ok) {
      toast(locale === "es" ? "Alerta descartada" : "Alert dismissed");
      onChanged();
    } else {
      toast(locale === "es" ? "No se pudo descartar" : "Could not dismiss");
    }
  };

  const viewEvidence = async () => {
    const res = await actions.getZelleEvidenceUrl(n.notificationId);
    if (res.ok && res.data) {
      getBridge().share.openExternal(res.data.url);
    } else {
      toast(locale === "es" ? "No se pudo abrir la evidencia" : "Could not open the evidence");
    }
  };

  return (
    <Card style={{ padding: "16px 18px" }}>
      <NotificationHeader n={n} locale={locale} />

      {best ? (
        <div
          style={{
            marginTop: 12,
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "var(--bg-2, color-mix(in srgb, var(--accent) 4%, var(--card)))",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)" }}>
                {locale === "es" ? "Sugerencia" : "Suggestion"}
              </p>
              <p style={{ margin: "3px 0 0", fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
                {best.clientName} · {best.caseNumber}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
                {best.isDownpayment
                  ? locale === "es"
                    ? "Cuota inicial"
                    : "Down payment"
                  : `${locale === "es" ? "Cuota" : "Installment"} ${best.installmentNumber}`}{" "}
                · {usd(best.installmentAmountCents)} · {locale === "es" ? "vence" : "due"}{" "}
                {formatDate(best.dueDate, locale)}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
                {locale === "es" ? "Confianza" : "Confidence"}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: "var(--accent)" }}>
                {best.score}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {signalChips(best.signals, locale).map((c) => (
              <Chip key={c}>{c}</Chip>
            ))}
          </div>
          {n.matches.length > 1 ? (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
              {locale === "es"
                ? `+${n.matches.length - 1} candidato(s) más — usa Reasignar para verlos.`
                : `+${n.matches.length - 1} more candidate(s) — use Reassign to view.`}
            </p>
          ) : null}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginTop: 14,
          flexWrap: "wrap",
        }}
      >
        {best ? <ConfirmControls busy={busy} locale={locale} onConfirm={confirm} /> : null}
        <GhostBtn full={false} size="md" onClick={() => setShowReassign(true)} disabled={busy}>
          <Icon name="route" size={14} />
          {best
            ? locale === "es"
              ? "Reasignar"
              : "Reassign"
            : locale === "es"
              ? "Asignar a un caso"
              : "Assign to a case"}
        </GhostBtn>
        <GhostBtn full={false} size="md" onClick={() => setShowReject((v) => !v)} disabled={busy}>
          <Icon name="x" size={14} />
          {locale === "es" ? "Descartar" : "Dismiss"}
        </GhostBtn>
        <GhostBtn full={false} size="md" onClick={viewEvidence} disabled={busy}>
          <Icon name="mail" size={14} />
          {locale === "es" ? "Ver correo" : "View email"}
        </GhostBtn>
      </div>

      {showReject ? (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={
              locale === "es" ? "Motivo (obligatorio)…" : "Reason (required)…"
            }
            style={{
              flex: 1,
              minWidth: 220,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--card)",
              color: "var(--ink)",
              fontSize: 13,
            }}
          />
          <GhostBtn full={false} size="md" onClick={reject} disabled={busy || !rejectReason.trim()}>
            {locale === "es" ? "Confirmar descarte" : "Confirm dismiss"}
          </GhostBtn>
        </div>
      ) : null}

      {showReassign ? (
        <ReassignPanel
          notification={n}
          locale={locale}
          actions={actions}
          onClose={() => setShowReassign(false)}
          onDone={() => {
            setShowReassign(false);
            onChanged();
          }}
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

type TrayId = "confirmar" | "sin-identificar" | "auto";

export function ConciliacionTab({ vm, locale, actions }: ConciliacionTabProps) {
  const router = useRouter();
  const [tray, setTray] = React.useState<TrayId>(
    vm.porConfirmar.length === 0 && vm.sinIdentificar.length > 0 ? "sin-identificar" : "confirmar",
  );
  const refresh = React.useCallback(() => router.refresh(), [router]);

  const trays: Array<{ id: TrayId; label: string; count: number }> = [
    {
      id: "confirmar",
      label: locale === "es" ? "Por confirmar" : "To confirm",
      count: vm.porConfirmar.length,
    },
    {
      id: "sin-identificar",
      label: locale === "es" ? "Sin identificar" : "Unidentified",
      count: vm.sinIdentificar.length,
    },
    {
      id: "auto",
      label: locale === "es" ? "Auto-aprobados (7d)" : "Auto-approved (7d)",
      count: vm.autoAprobados.length,
    },
  ];

  return (
    <div>
      {/* Config status line */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <IconTile name="bolt" color={vm.config.enabled ? "var(--accent)" : "var(--ink-3)"} size={34} iconSize={17} />
        <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
          {vm.config.enabled
            ? locale === "es"
              ? `Auto-aprobación ACTIVA · tope ${usd(vm.config.tier_a_max_amount_cents)} · requiere nº de caso en el memo`
              : `Auto-approval ON · cap ${usd(vm.config.tier_a_max_amount_cents)} · requires case # in the memo`
            : locale === "es"
              ? "Auto-aprobación desactivada (modo bandeja): todo pago espera tu confirmación"
              : "Auto-approval off (inbox mode): every payment awaits your confirmation"}
        </span>
      </div>

      {/* Tray selector */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {trays.map((t) => {
          const active = tray === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTray(t.id)}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: active ? "1.5px solid var(--accent)" : "1px solid var(--line)",
                background: active
                  ? "color-mix(in srgb, var(--accent) 10%, var(--card))"
                  : "var(--card)",
                color: active ? "var(--accent)" : "var(--ink-2)",
                fontWeight: active ? 800 : 600,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "var(--font-title)",
              }}
            >
              {t.label}
              {t.count > 0 ? ` · ${t.count}` : ""}
            </button>
          );
        })}
      </div>

      {tray === "confirmar" ? (
        vm.porConfirmar.length === 0 ? (
          <EmptyState
            text={
              locale === "es"
                ? "Nada por confirmar. Los pagos con sugerencia aparecerán aquí."
                : "Nothing to confirm. Payments with a suggestion will appear here."
            }
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {vm.porConfirmar.map((n) => (
              <NotificationCard
                key={n.notificationId}
                n={n}
                locale={locale}
                actions={actions}
                onChanged={refresh}
              />
            ))}
          </div>
        )
      ) : null}

      {tray === "sin-identificar" ? (
        vm.sinIdentificar.length === 0 ? (
          <EmptyState
            text={
              locale === "es"
                ? "No hay pagos sin identificar. 🎉"
                : "No unidentified payments. 🎉"
            }
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {vm.sinIdentificar.map((n) => (
              <NotificationCard
                key={n.notificationId}
                n={n}
                locale={locale}
                actions={actions}
                onChanged={refresh}
              />
            ))}
          </div>
        )
      ) : null}

      {tray === "auto" ? (
        vm.autoAprobados.length === 0 ? (
          <EmptyState
            text={
              locale === "es"
                ? "Aún no hay pagos auto-aprobados en los últimos 7 días."
                : "No auto-approved payments in the last 7 days yet."
            }
          />
        ) : (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {vm.autoAprobados.map((a, idx) => (
              <div
                key={a.notificationId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderTop: idx === 0 ? "none" : "1px solid var(--line)",
                }}
              >
                <IconTile name="check" color="var(--green, #157347)" size={34} iconSize={16} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                    {a.clientName} · {a.caseNumber} ·{" "}
                    {locale === "es" ? "cuota" : "installment"} {a.installmentNumber}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
                    {a.senderName} · txn {a.transactionNumber} ·{" "}
                    {a.appliedAt ? formatDate(a.appliedAt, locale) : "—"}
                  </p>
                </div>
                <span style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>
                  {usd(a.amountCents)}
                </span>
              </div>
            ))}
          </Card>
        )
      ) : null}
    </div>
  );
}
