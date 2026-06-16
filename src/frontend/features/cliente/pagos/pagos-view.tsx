"use client";

/**
 * PagosView — `/pagos` cliente screen (DOC-51 §8, PROMPT-CLI-08).
 *
 * Client component: all interactive state lives here.
 * Data arrives fully resolved from the RSC page (no backend imports allowed).
 *
 * Zones:
 *   1 — h1 "Pagos"
 *   2 — Navy summary card (nextDue / allPaid)
 *   3 — "Tu plan de pago" installment list
 *   4 — "¿Cómo quieres pagar?" Zelle / Tarjeta radio cards
 *   5 — Footer safety badge
 *
 * Server actions passed as props (boundary rule from DOC-21):
 *   - createCheckout(installmentId) → { ok, data?: { url }, error? }
 *   - getZelleUploadUrl(installmentId) → { ok, data?: { uploadUrl, path }, error? }
 *   - confirmZelleProof(installmentId, path) → { ok, error? }
 */

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";
import { Chip } from "@/frontend/components/brand/chip";
import { StatusPill } from "@/frontend/components/brand/status-pill";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { Lex } from "@/frontend/components/brand/lex";

// ---------------------------------------------------------------------------
// View-model types (no backend types cross the boundary)
// ---------------------------------------------------------------------------

export interface InstallmentVM {
  id: string;
  number: number;
  isDownpayment: boolean;
  amountCents: number;
  /** Localized display label, e.g. "5 mar" */
  dateLabel: string;
  /** Derived from status + position relative to nextDue */
  displayStatus: "paid" | "due" | "scheduled" | "processing" | "waived" | "overdue";
}

export interface PagosLabels {
  title: string;
  nextLabel: string;
  dueDate: string; // "{date}" placeholder substituted in RSC
  progressLabel: string; // "{paid}" and "{total}" substituted in RSC
  payNow: string;
  allPaid: string;
  planTitle: string;
  installmentRow: string; // "{n}" and "{amount}" substituted inline
  statusPaid: string;
  statusDue: string;
  statusScheduled: string;
  statusProcessing: string;
  statusWaived: string;
  statusOverdue: string;
  howToPayTitle: string;
  zelleLabel: string;
  zelleRecommended: string;
  zelleDestinationLabel: string;
  zelleUploadBtn: string;
  zelleNote: string;
  cardLabel: string;
  cardSub: string;
  cardPayBtn: string;
  footerSafe: string;
  emptyTitle: string;
  emptyBody: string;
  uploadSuccess: string;
  uploadError: string;
  stripeRedirecting: string;
  stripeError: string;
  offlineBanner: string;
  downpaymentLabel: string;
  zelleDestinationTodo: string;
}

export interface PagosViewProps {
  /** null = no plan yet (empty state) */
  installments: InstallmentVM[] | null;
  /** The installment the "Pay now" CTA targets */
  nextDueId: string | null;
  /** e.g. "$150" — already formatted */
  nextDueAmount: string | null;
  /** e.g. "5 de junio" — already localized */
  nextDueDateLabel: string | null;
  paidCount: number;
  totalCount: number;
  /** 0-100 */
  progressPct: number;
  /** Zelle destination from orgs.settings; null = not configured yet */
  zelleDestination: string | null;
  labels: PagosLabels;
  /** Stripe Checkout URL (server action) */
  onCreateCheckout: (
    installmentId: string,
  ) => Promise<{ ok: true; data: { url: string } } | { ok: false; error: string }>;
  /** Signed upload URL for Zelle proof */
  onGetZelleUploadUrl: (
    installmentId: string,
    filename: string,
    contentType: string,
  ) => Promise<
    | { ok: true; data: { uploadUrl: string; path: string } }
    | { ok: false; error: string }
  >;
  /** Confirm that the proof was uploaded to storage */
  onConfirmZelleProof: (
    installmentId: string,
    path: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** True when the browser is offline (passed from online event listener in
   *  the RSC shell — actually just an initial value; real updates from navigator) */
  isOffline?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Gold progress bar styled for the navy card (white track) */
function NavyProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        height: 8,
        borderRadius: 999,
        background: "rgba(255,255,255,0.20)",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <div
        style={{
          width: `${clamped}%`,
          height: "100%",
          borderRadius: 999,
          background: "linear-gradient(90deg, var(--gold), var(--gold-deep))",
          transition: "width 0.9s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </div>
  );
}

/** Numbered disc for the installment list */
function InstallmentDisc({
  number,
  isActive,
}: {
  number: number;
  isActive: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 34,
        height: 34,
        borderRadius: 999,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: isActive ? "var(--blue-soft)" : "var(--line)",
        color: isActive ? "var(--accent)" : "var(--ink-3)",
        fontFamily: "var(--font-title)",
        fontWeight: 800,
        fontSize: 14,
        transition: "background 0.2s, color 0.2s",
      }}
    >
      {number}
    </div>
  );
}

/** Toast notification (transient) */
function Toast({
  message,
  tone,
  onClose,
}: {
  message: string;
  tone: "success" | "error";
  onClose: () => void;
}) {
  React.useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 120,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        background: tone === "success" ? "var(--green)" : "var(--gold-deep)",
        color: "#fff",
        borderRadius: 18,
        padding: "14px 20px",
        fontFamily: "var(--font-title)",
        fontWeight: 700,
        fontSize: 15,
        boxShadow: "0 8px 24px rgba(11,27,51,0.18)",
        maxWidth: 340,
        textAlign: "center",
        lineHeight: 1.4,
      }}
    >
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PagosView({
  installments,
  nextDueId,
  nextDueAmount,
  nextDueDateLabel,
  paidCount,
  totalCount,
  progressPct,
  zelleDestination,
  labels,
  onCreateCheckout,
  onGetZelleUploadUrl,
  onConfirmZelleProof,
  isOffline: initialOffline = false,
}: PagosViewProps) {
  const [selectedMethod, setSelectedMethod] = React.useState<"zelle" | "card">("zelle");
  const [busyCheckout, setBusyCheckout] = React.useState(false);
  const [busyUpload, setBusyUpload] = React.useState(false);
  const [toast, setToast] = React.useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [isOffline, setIsOffline] = React.useState(initialOffline);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Track online/offline
  React.useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const showToast = React.useCallback((message: string, tone: "success" | "error") => {
    setToast({ message, tone });
  }, []);

  // "Pagar con tarjeta" → Stripe Checkout
  const handleStripeCheckout = React.useCallback(async () => {
    if (!nextDueId || isOffline) return;
    setBusyCheckout(true);
    try {
      const result = await onCreateCheckout(nextDueId);
      if (result.ok) {
        window.location.href = result.data.url;
      } else {
        showToast(labels.stripeError, "error");
        setBusyCheckout(false);
      }
    } catch {
      showToast(labels.stripeError, "error");
      setBusyCheckout(false);
    }
  }, [nextDueId, isOffline, onCreateCheckout, labels.stripeError, showToast]);

  // "Subir comprobante Zelle" → signed-URL upload
  const handleZelleUpload = React.useCallback(
    async (file: File) => {
      if (!nextDueId || isOffline) return;
      setBusyUpload(true);
      try {
        const urlResult = await onGetZelleUploadUrl(
          nextDueId,
          file.name,
          file.type || "application/octet-stream",
        );
        if (!urlResult.ok) {
          showToast(labels.uploadError, "error");
          setBusyUpload(false);
          return;
        }
        const { uploadUrl, path } = urlResult.data;

        // PUT to signed URL
        const uploadResp = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        if (!uploadResp.ok) {
          showToast(labels.uploadError, "error");
          setBusyUpload(false);
          return;
        }

        // Confirm with server
        const confirmResult = await onConfirmZelleProof(nextDueId, path);
        if (confirmResult.ok) {
          showToast(labels.uploadSuccess, "success");
          // Reload to reflect new "processing" status
          setTimeout(() => window.location.reload(), 1500);
        } else {
          showToast(labels.uploadError, "error");
        }
      } catch {
        showToast(labels.uploadError, "error");
      } finally {
        setBusyUpload(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [
      nextDueId,
      isOffline,
      onGetZelleUploadUrl,
      onConfirmZelleProof,
      labels.uploadError,
      labels.uploadSuccess,
      showToast,
    ],
  );

  const handleFileChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleZelleUpload(file);
    },
    [handleZelleUpload],
  );

  const allPaid = installments !== null && paidCount >= totalCount && totalCount > 0;
  const hasNextDue = Boolean(nextDueId && nextDueAmount && nextDueDateLabel);

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 20px 116px",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      {/* Zone 1 — Title */}
      <h1
        className="t-black"
        style={{ margin: "0 0 20px", fontSize: 27, color: "var(--navy)" }}
      >
        {labels.title}
      </h1>

      {/* Offline banner */}
      {isOffline && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--gold-soft)",
            color: "var(--gold-deep)",
            borderRadius: 16,
            padding: "12px 16px",
            marginBottom: 16,
            fontFamily: "var(--font-title)",
            fontWeight: 700,
            fontSize: 14.5,
          }}
        >
          <Icon name="info" size={18} color="var(--gold-deep)" />
          {labels.offlineBanner}
        </div>
      )}

      {/* Empty state */}
      {installments === null || installments.length === 0 ? (
        <EmptyState labels={labels} />
      ) : (
        <>
          {/* Zone 2 — Navy summary card */}
          <NavySummaryCard
            allPaid={allPaid}
            hasNextDue={hasNextDue}
            nextDueAmount={nextDueAmount}
            nextDueDateLabel={nextDueDateLabel}
            paidCount={paidCount}
            totalCount={totalCount}
            progressPct={progressPct}
            labels={labels}
            onPayNow={() => {
              if (selectedMethod === "card") {
                void handleStripeCheckout();
              } else {
                // Scroll to payment method section
                document.getElementById("how-to-pay")?.scrollIntoView({ behavior: "smooth" });
              }
            }}
            isOffline={isOffline}
            busyCheckout={busyCheckout}
          />

          {/* Zone 3 — Payment plan */}
          <section style={{ marginBottom: 24 }}>
            <h2
              className="t-title"
              style={{
                margin: "0 0 12px",
                fontSize: 18,
                color: "var(--navy)",
                fontWeight: 700,
              }}
            >
              {labels.planTitle}
            </h2>
            <div
              style={{
                background: "var(--card)",
                borderRadius: 24,
                boxShadow: "0 10px 30px rgba(11,27,51,.07)",
                overflow: "hidden",
              }}
            >
              {installments.map((inst, idx) => (
                <InstallmentRow
                  key={inst.id}
                  inst={inst}
                  labels={labels}
                  isLast={idx === installments.length - 1}
                />
              ))}
            </div>
          </section>

          {/* Zone 4 — How to pay */}
          {hasNextDue && !allPaid && (
            <section id="how-to-pay" style={{ marginBottom: 24 }}>
              <h2
                className="t-title"
                style={{
                  margin: "0 0 12px",
                  fontSize: 18,
                  color: "var(--navy)",
                  fontWeight: 700,
                }}
              >
                {labels.howToPayTitle}
              </h2>

              {/* Zelle card */}
              <PaymentMethodCard
                selected={selectedMethod === "zelle"}
                onSelect={() => setSelectedMethod("zelle")}
                ariaLabel={labels.zelleLabel}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: selectedMethod === "zelle" ? 16 : 0 }}>
                  {/* Icon tile — dollar green */}
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 13,
                      background: "var(--green-soft)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="dollar" size={24} color="var(--green)" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      className="t-title"
                      style={{ fontSize: 16, color: "var(--navy)", fontWeight: 700, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                    >
                      {labels.zelleLabel}
                      <Chip tone="green">{labels.zelleRecommended}</Chip>
                    </div>
                    {zelleDestination && (
                      <div style={{ fontSize: 13.5, color: "var(--ink-2)", fontWeight: 600, marginTop: 2 }}>
                        {zelleDestination}
                      </div>
                    )}
                  </div>
                  <RadioDot selected={selectedMethod === "zelle"} />
                </div>

                {/* Expanded Zelle body */}
                {selectedMethod === "zelle" && (
                  <div>
                    {/* Destination info block */}
                    {zelleDestination && (
                      <div
                        style={{
                          background: "var(--green-soft)",
                          borderRadius: 14,
                          padding: "10px 14px",
                          marginBottom: 14,
                          fontSize: 14.5,
                          color: "var(--green)",
                          fontWeight: 700,
                        }}
                      >
                        <span style={{ color: "var(--ink-2)", fontWeight: 600 }}>
                          {labels.zelleDestinationLabel}:{" "}
                        </span>
                        {zelleDestination}
                      </div>
                    )}

                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      style={{ display: "none" }}
                      aria-label={labels.zelleUploadBtn}
                      onChange={handleFileChange}
                      tabIndex={-1}
                    />

                    <GhostBtn
                      icon="camera"
                      disabled={isOffline || busyUpload}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {busyUpload ? "Subiendo…" : labels.zelleUploadBtn}
                    </GhostBtn>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 14,
                        color: "var(--ink-2)",
                        fontSize: 14,
                        fontWeight: 600,
                      }}
                    >
                      <Icon name="clock" size={16} color="var(--ink-3)" />
                      {labels.zelleNote}
                    </div>
                  </div>
                )}
              </PaymentMethodCard>

              {/* Tarjeta / Card card */}
              <PaymentMethodCard
                selected={selectedMethod === "card"}
                onSelect={() => setSelectedMethod("card")}
                ariaLabel={labels.cardLabel}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: selectedMethod === "card" ? 16 : 0 }}>
                  {/* Icon tile — card accent */}
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 13,
                      background: "var(--blue-soft)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="card" size={24} color="var(--accent)" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      className="t-title"
                      style={{ fontSize: 16, color: "var(--navy)", fontWeight: 700 }}
                    >
                      {labels.cardLabel}
                    </div>
                    <div style={{ fontSize: 13.5, color: "var(--ink-2)", fontWeight: 600, marginTop: 2 }}>
                      {labels.cardSub}
                    </div>
                  </div>
                  <RadioDot selected={selectedMethod === "card"} />
                </div>

                {/* Expanded card body */}
                {selectedMethod === "card" && (
                  <GradientBtn
                    icon="card"
                    disabled={isOffline || busyCheckout}
                    onClick={() => void handleStripeCheckout()}
                  >
                    {busyCheckout ? labels.stripeRedirecting : labels.cardPayBtn}
                  </GradientBtn>
                )}
              </PaymentMethodCard>
            </section>
          )}

          {/* Zone 5 — Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "var(--ink-3)",
              fontSize: 14,
              fontWeight: 600,
              marginTop: 8,
            }}
          >
            <Icon name="lock" size={16} color="var(--green)" />
            <span>{labels.footerSafe}</span>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          tone={toast.tone}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navy Summary Card
// ---------------------------------------------------------------------------

function NavySummaryCard({
  allPaid,
  hasNextDue,
  nextDueAmount,
  nextDueDateLabel,
  paidCount,
  totalCount,
  progressPct,
  labels,
  onPayNow,
  isOffline,
  busyCheckout,
}: {
  allPaid: boolean;
  hasNextDue: boolean;
  nextDueAmount: string | null;
  nextDueDateLabel: string | null;
  paidCount: number;
  totalCount: number;
  progressPct: number;
  labels: PagosLabels;
  onPayNow: () => void;
  isOffline: boolean;
  busyCheckout: boolean;
}) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        background: "linear-gradient(135deg, var(--brand-navy, #002855), #013a73)",
        borderRadius: 24,
        padding: "24px 20px 20px",
        marginBottom: 24,
        boxShadow: "0 18px 40px color-mix(in srgb, #002855 25%, transparent)",
      }}
    >
      {/* Halo dorado decorativo */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          right: -30,
          top: -30,
          width: 160,
          height: 160,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--gold) 22%, transparent), transparent 68%)",
          pointerEvents: "none",
        }}
      />

      {/* Label */}
      <div
        style={{
          color: "rgba(255,255,255,0.65)",
          fontSize: 13.5,
          fontWeight: 700,
          marginBottom: 6,
          position: "relative",
        }}
      >
        {allPaid ? " " : labels.nextLabel}
      </div>

      {allPaid ? (
        /* All paid state */
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              background: "var(--green)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="check" size={24} color="#fff" />
          </div>
          <span
            className="t-black"
            style={{ fontSize: 32, color: "#fff", fontWeight: 900 }}
          >
            {labels.allPaid}
          </span>
        </div>
      ) : hasNextDue ? (
        /* Next due state */
        <div style={{ position: "relative" }}>
          <div
            className="t-black"
            style={{ fontSize: 44, color: "#fff", fontWeight: 900, lineHeight: 1.05, marginBottom: 4 }}
          >
            {nextDueAmount}
          </div>
          <div style={{ color: "rgba(255,255,255,0.80)", fontSize: 15, fontWeight: 600, marginBottom: 18 }}>
            {labels.dueDate.replace("{date}", nextDueDateLabel ?? "")}
          </div>
        </div>
      ) : null}

      {/* Progress bar + label */}
      {totalCount > 0 && (
        <div style={{ position: "relative", marginBottom: 18 }}>
          <NavyProgressBar pct={progressPct} />
          <div style={{ color: "rgba(255,255,255,0.70)", fontSize: 13.5, fontWeight: 600, marginTop: 8 }}>
            {labels.progressLabel
              .replace("{paid}", String(paidCount))
              .replace("{total}", String(totalCount))}
          </div>
        </div>
      )}

      {/* CTA pill — only when there's a next due and not all paid */}
      {hasNextDue && !allPaid && (
        <button
          type="button"
          onClick={isOffline ? undefined : onPayNow}
          disabled={isOffline || busyCheckout}
          aria-label={labels.payNow}
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            height: 54,
            padding: "0 24px",
            borderRadius: 999,
            border: "none",
            background: "#fff",
            color: "var(--accent)",
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 17,
            cursor: isOffline ? "default" : "pointer",
            opacity: isOffline ? 0.55 : 1,
            boxShadow: "0 6px 18px rgba(11,27,51,0.18)",
            transition: "transform 0.18s var(--ease), box-shadow 0.18s var(--ease)",
          }}
        >
          <Icon name="bolt" size={20} color="var(--accent)" fill="var(--accent)" />
          {labels.payNow}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installment Row
// ---------------------------------------------------------------------------

function InstallmentRow({
  inst,
  labels,
  isLast,
}: {
  inst: InstallmentVM;
  labels: PagosLabels;
  isLast: boolean;
}) {
  const isDue = inst.displayStatus === "due";
  const isScheduled = inst.displayStatus === "scheduled";
  const isWaived = inst.displayStatus === "waived";
  const isPaid = inst.displayStatus === "paid";
  const isProcessing = inst.displayStatus === "processing";
  const isOverdue = inst.displayStatus === "overdue";

  const rowOpacity = isScheduled ? 0.5 : 1;

  const displayLabel = inst.isDownpayment
    ? labels.downpaymentLabel
    : labels.installmentRow
        .replace("{n}", String(inst.number))
        .replace("{amount}", formatCents(inst.amountCents));

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "15px 18px",
        borderBottom: isLast ? "none" : "1px solid var(--line)",
        opacity: rowOpacity,
        transition: "opacity 0.2s",
      }}
    >
      <InstallmentDisc number={inst.number} isActive={isDue || isOverdue} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="t-title"
          style={{
            fontSize: 15.5,
            color: "var(--navy)",
            fontWeight: isDue ? 800 : 700,
            lineHeight: 1.25,
          }}
        >
          {displayLabel}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 600, marginTop: 2 }}>
          {inst.dateLabel}
        </div>
      </div>

      {/* Status indicator */}
      <div style={{ flexShrink: 0 }}>
        {isPaid && <StatusPill kind="hecho">{labels.statusPaid}</StatusPill>}
        {isDue && <StatusPill kind="pendiente">{labels.statusDue}</StatusPill>}
        {isProcessing && <StatusPill kind="revision">{labels.statusProcessing}</StatusPill>}
        {isOverdue && (
          /* Overdue: gold-deep chip, non-punitive */
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "var(--gold-soft)",
              color: "var(--gold-deep)",
              borderRadius: 999,
              padding: "7px 13px",
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 14,
              whiteSpace: "nowrap",
            }}
          >
            <Icon name="clock" size={16} color="var(--gold-deep)" />
            {labels.statusOverdue}
          </span>
        )}
        {isWaived && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "var(--blue-soft)",
              color: "var(--ink-2)",
              borderRadius: 999,
              padding: "7px 13px",
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 14,
              whiteSpace: "nowrap",
            }}
          >
            {labels.statusWaived}
          </span>
        )}
        {isScheduled && (
          <span
            style={{
              fontSize: 13.5,
              color: "var(--ink-3)",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {labels.statusScheduled}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment method card (radio)
// ---------------------------------------------------------------------------

function PaymentMethodCard({
  selected,
  onSelect,
  ariaLabel,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        background: "var(--card)",
        borderRadius: 20,
        padding: 18,
        marginBottom: 12,
        border: selected ? "2px solid var(--accent)" : "2px solid transparent",
        boxShadow: selected
          ? "0 6px 20px color-mix(in srgb, var(--accent) 14%, transparent)"
          : "0 4px 12px rgba(11,27,51,0.05)",
        cursor: "pointer",
        transition: "border-color 0.2s, box-shadow 0.2s",
        outline: "none",
      }}
    >
      {children}
    </div>
  );
}

/** Radio dot indicator */
function RadioDot({ selected }: { selected: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 22,
        height: 22,
        borderRadius: 999,
        border: `2px solid ${selected ? "var(--accent)" : "var(--line)"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transition: "border-color 0.2s",
      }}
    >
      {selected && (
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            background: "var(--accent)",
            transition: "transform 0.15s",
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ labels }: { labels: PagosLabels }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "40px 20px",
        gap: 16,
      }}
    >
      <Lex size={100} mood="calma" />
      <h2
        className="t-title"
        style={{ margin: 0, fontSize: 20, color: "var(--navy)", fontWeight: 800 }}
      >
        {labels.emptyTitle}
      </h2>
      <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 16, lineHeight: 1.5, maxWidth: 300 }}>
        {labels.emptyBody}
      </p>
    </div>
  );
}
