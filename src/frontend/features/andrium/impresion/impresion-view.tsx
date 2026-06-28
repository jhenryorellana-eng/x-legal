"use client";

/**
 * ImpresionView — Cola de impresión de Andrium (`/finanzas/impresion`).
 *
 * RF-AND-023…027 / DOC-55 §2 / PROMPT-AND-02.
 *
 * Boundaries: MUST NOT import from @/backend. Types flow via VM structs below.
 * Server actions are injected as props from the RSC page.
 */

import * as React from "react";
import {
  Card,
  StatusPill,
  Chip,
  Avatar,
  GradientBtn,
  GhostBtn,
  Lex,
  Icon,
} from "@/frontend/components/brand";
import {
  Modal,
  SidePanel,
  Skeleton,
  toast,
} from "@/frontend/components/desktop";

// ---------------------------------------------------------------------------
// VM types (frontend only — no backend imports)
// ---------------------------------------------------------------------------

export interface PrintQueueItemVM {
  expedienteId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  /** Localised service label — caller picks the right locale. */
  serviceLabel: string | null;
  attemptNo: number;
  pageCount: number | null;
  /** "sent_to_finance" | "printed" */
  status: "sent_to_finance" | "printed";
  sentToFinanceAt: string | null;
  sentByName: string | null;
  withLawyer: boolean;
  shippedAt: string | null;
  filedAt: string | null;
  trackingRef: string | null;
  hasPdf: boolean;
}

export interface PrintHistoryAttemptVM {
  expedienteId: string;
  attemptNo: number;
  status: string;
  sentToFinanceAt: string | null;
  printedAt: string | null;
  shippedAt: string | null;
  filedAt: string | null;
  builtByName: string | null;
  printedByName: string | null;
  withLawyer: boolean;
  lawyerVerdict: string | null;
  isCurrentAttempt: boolean;
}

export interface ImpresionViewMessages {
  title: string;
  counterPending: string;
  filterPending: string;
  filterPrinted: string;
  filterShipped: string;
  filterFiled: string;
  filterAll: string;
  searchPlaceholder: string;
  colCase: string;
  colService: string;
  colAttempt: string;
  colPages: string;
  colSentBy: string;
  colStatus: string;
  colActions: string;
  viewPdf: string;
  download: string;
  markPrinted: string;
  confirmPrinted: string;
  confirmPrintedBody: string;
  logShipment: string;
  trackingLabel: string;
  trackingPlaceholder: string;
  markFiled: string;
  confirmFiled: string;
  confirmFiledBody: string;
  reprint: string;
  lawyerValidated: string;
  pdfUnavailable: string;
  pdfUnavailableAsk: string;
  emptyTitle: string;
  emptyBody: string;
  statusPending: string;
  statusPrinted: string;
  chipShipped: string;
  chipFiled: string;
  toastPrinted: string;
  toastShipped: string;
  toastFiled: string;
  toastError: string;
  historyTitle: string;
  historyAttempt: string;
  historyStatusLabel: string;
  historySent: string;
  historyPrinted: string;
  historyShipped: string;
  historyFiled: string;
  historyBuiltBy: string;
  historyPrintedBy: string;
  historyLawyerVerdict: string;
  historyDownloadOnly: string;
  pdfModalTitle: string;
  pdfModalPages: string;
  confirmCancel: string;
  confirmAction: string;
  cancel: string;
  confirm: string;
  save: string;
  attemptChip: string;
  // Phase advance (cycle restart)
  advancePhase: string;
  confirmAdvance: string;
  confirmAdvanceBody: string;
  advanceOwnerLabel: string;
  advanceOwnerHint: string;
  toastAdvanced: string;
  toastCompleted: string;
}

export interface AdvanceOwnerOptionVM {
  userId: string;
  displayName: string;
  role: string;
}

export interface ImpresionViewActions {
  markPrinted: (expedienteId: string) => Promise<{ ok: boolean; error?: { code: string } }>;
  markShipped: (expedienteId: string, trackingRef?: string) => Promise<{ ok: boolean; error?: { code: string } }>;
  markFiled: (expedienteId: string) => Promise<{ ok: boolean; error?: { code: string } }>;
  getPdfUrl: (expedienteId: string) => Promise<{ ok: boolean; data?: string; error?: { code: string } }>;
  /** Close the printed phase and restart the cycle (or complete the case). */
  advancePhase: (input: { caseId: string; toOwnerId?: string | null }) => Promise<{
    ok: boolean;
    completed?: boolean;
    phaseIndex?: number;
    phaseCount?: number;
    candidates?: AdvanceOwnerOptionVM[];
    error?: { code: string };
  }>;
}

export interface ImpresionViewProps {
  items: PrintQueueItemVM[];
  history: Record<string, PrintHistoryAttemptVM[]>;
  messages: ImpresionViewMessages;
  actions: ImpresionViewActions;
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

type FilterTab = "pending" | "printed" | "shipped" | "filed" | "all";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(isoString: string | null): string {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

function shortDate(isoString: string | null): string {
  if (!isoString) return "";
  return new Date(isoString).toLocaleDateString("es-US", {
    day: "numeric",
    month: "short",
  });
}

// ---------------------------------------------------------------------------
// Row action button — contextual per cycle step
// ---------------------------------------------------------------------------

interface RowActionBtnProps {
  item: PrintQueueItemVM;
  messages: ImpresionViewMessages;
  onMarkPrinted: () => void;
  onLogShipment: () => void;
  onMarkFiled: () => void;
}

function RowActionBtn({
  item,
  messages,
  onMarkPrinted,
  onLogShipment,
  onMarkFiled,
}: RowActionBtnProps) {
  const disabled = !item.hasPdf;

  if (item.status === "sent_to_finance") {
    return (
      <GradientBtn
        size="sm"
        full={false}
        disabled={disabled}
        onClick={disabled ? undefined : onMarkPrinted}
        aria-label={messages.markPrinted}
      >
        {messages.markPrinted}
      </GradientBtn>
    );
  }

  // printed
  if (!item.shippedAt) {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <GradientBtn
          size="sm"
          full={false}
          onClick={onLogShipment}
          aria-label={messages.logShipment}
        >
          {messages.logShipment}
        </GradientBtn>
        {!item.filedAt && (
          <GhostBtn
            size="md"
            full={false}
            onClick={onMarkFiled}
            aria-label={messages.markFiled}
          >
            {messages.markFiled}
          </GhostBtn>
        )}
      </div>
    );
  }

  if (!item.filedAt) {
    return (
      <GradientBtn
        size="sm"
        full={false}
        onClick={onMarkFiled}
        aria-label={messages.markFiled}
      >
        {messages.markFiled}
      </GradientBtn>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  cancelLabel: string;
}

function ConfirmModal({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  cancelLabel,
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <GhostBtn
            size="md"
            full={false}
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelLabel}
          </GhostBtn>
          <GradientBtn
            size="md"
            full={false}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "…" : confirmLabel}
          </GradientBtn>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--ink-2)" }}>
        {body}
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Shipment modal
// ---------------------------------------------------------------------------

interface ShipmentModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  messages: ImpresionViewMessages;
  busy: boolean;
  onConfirm: (trackingRef: string | undefined) => void;
}

function ShipmentModal({
  open,
  onOpenChange,
  messages,
  busy,
  onConfirm,
}: ShipmentModalProps) {
  const [tracking, setTracking] = React.useState("");

  function handleConfirm() {
    onConfirm(tracking.trim() || undefined);
  }

  function handleOpenChange(v: boolean) {
    if (!v) setTracking("");
    onOpenChange(v);
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title={messages.logShipment}
      footer={
        <>
          <GhostBtn
            size="md"
            full={false}
            onClick={() => handleOpenChange(false)}
            disabled={busy}
          >
            {messages.cancel}
          </GhostBtn>
          <GradientBtn
            size="md"
            full={false}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? "…" : messages.save}
          </GradientBtn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label
          style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-2)" }}
          htmlFor="tracking-input"
        >
          {messages.trackingLabel}
        </label>
        <input
          id="tracking-input"
          type="text"
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          placeholder={messages.trackingPlaceholder}
          style={{
            height: 44,
            borderRadius: 12,
            border: "2px solid var(--line)",
            padding: "0 14px",
            fontSize: 15,
            color: "var(--ink)",
            background: "var(--card)",
            outline: "none",
            fontFamily: "var(--font-title)",
            transition: "border-color 0.18s",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.boxShadow = "0 0 0 4px var(--accent-soft, rgba(47,107,255,0.14))";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--line)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Advance-phase modal (cycle restart)
// ---------------------------------------------------------------------------

interface AdvanceModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  messages: ImpresionViewMessages;
  busy: boolean;
  candidates: AdvanceOwnerOptionVM[] | null;
  selectedOwner: string;
  onSelectOwner: (id: string) => void;
  onConfirm: () => void;
}

function AdvanceModal({
  open,
  onOpenChange,
  messages,
  busy,
  candidates,
  selectedOwner,
  onSelectOwner,
  onConfirm,
}: AdvanceModalProps) {
  const needsOwner = !!candidates && candidates.length > 0;
  const confirmDisabled = busy || (needsOwner && !selectedOwner);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={messages.confirmAdvance}
      footer={
        <>
          <GhostBtn size="md" full={false} onClick={() => onOpenChange(false)} disabled={busy}>
            {messages.cancel}
          </GhostBtn>
          <GradientBtn size="md" full={false} onClick={onConfirm} disabled={confirmDisabled}>
            {busy ? "…" : messages.advancePhase}
          </GradientBtn>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--ink-2)" }}>
        {messages.confirmAdvanceBody}
      </p>
      {needsOwner && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <label
            htmlFor="advance-owner-select"
            style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-2)" }}
          >
            {messages.advanceOwnerLabel}
          </label>
          <select
            id="advance-owner-select"
            value={selectedOwner}
            onChange={(e) => onSelectOwner(e.target.value)}
            style={{
              height: 44,
              borderRadius: 12,
              border: "2px solid var(--line)",
              padding: "0 12px",
              fontSize: 15,
              color: "var(--ink)",
              background: "var(--card)",
              outline: "none",
              fontFamily: "var(--font-title)",
            }}
          >
            <option value="">—</option>
            {candidates!.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.displayName}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{messages.advanceOwnerHint}</span>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// PDF viewer modal
// ---------------------------------------------------------------------------

interface PdfViewerModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: PrintQueueItemVM | null;
  pdfUrl: string | null;
  loadingUrl: boolean;
  messages: ImpresionViewMessages;
  onDownload: () => void;
}

function PdfViewerModal({
  open,
  onOpenChange,
  item,
  pdfUrl,
  loadingUrl,
  messages,
  onDownload,
}: PdfViewerModalProps) {
  if (!item) return null;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${messages.pdfModalTitle} — ${item.caseNumber}`}
      description={`${messages.attemptChip} ${item.attemptNo} · ${item.pageCount ?? "—"} ${messages.pdfModalPages}`}
      width={900}
      footer={
        <GhostBtn
          size="md"
          full={false}
          onClick={onDownload}
          disabled={!pdfUrl}
        >
          {messages.download}
        </GhostBtn>
      }
    >
      <div
        style={{
          height: "65vh",
          border: "1px solid var(--line)",
          borderRadius: 12,
          overflow: "hidden",
          background: "var(--chip)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {loadingUrl && (
          <div style={{ textAlign: "center", color: "var(--ink-2)", fontSize: 14 }}>
            <Icon name="doc" size={32} color="var(--ink-3)" />
            <p style={{ margin: "10px 0 0" }}>Cargando PDF…</p>
          </div>
        )}
        {!loadingUrl && pdfUrl && (
          <iframe
            title={`PDF ${item.caseNumber}`}
            src={pdfUrl}
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        )}
        {!loadingUrl && !pdfUrl && (
          <div style={{ textAlign: "center", color: "var(--ink-2)", fontSize: 14 }}>
            <Icon name="info" size={32} color="var(--red)" />
            <p style={{ margin: "10px 0 0" }}>{messages.pdfUnavailable}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// History side panel
// ---------------------------------------------------------------------------

interface HistoryPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  attempts: PrintHistoryAttemptVM[];
  messages: ImpresionViewMessages;
  onDownload: (expedienteId: string) => void;
}

function HistoryPanel({
  open,
  onOpenChange,
  attempts,
  messages,
  onDownload,
}: HistoryPanelProps) {
  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={messages.historyTitle}
      width={420}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {attempts.map((a) => (
          <div
            key={a.expedienteId}
            style={{
              background: "var(--hover, rgba(47,107,255,0.04))",
              borderRadius: 14,
              padding: "14px 16px",
              border: a.isCurrentAttempt
                ? "2px solid var(--accent)"
                : "1px solid var(--line)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 14,
                  color: "var(--ink)",
                }}
              >
                {messages.historyAttempt} {a.attemptNo}
              </span>
              {a.isCurrentAttempt && (
                <Chip tone="blue">
                  {messages.statusPending}
                </Chip>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {[
                { label: messages.historySent, value: a.sentToFinanceAt },
                { label: messages.historyPrinted, value: a.printedAt },
                { label: messages.historyShipped, value: a.shippedAt },
                { label: messages.historyFiled, value: a.filedAt },
              ].map(({ label, value }) =>
                value ? (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      gap: 8,
                      fontSize: 13,
                      color: "var(--ink-2)",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "var(--ink-3)" }}>
                      {label}:
                    </span>
                    <span>{shortDate(value)}</span>
                  </div>
                ) : null,
              )}
              {a.builtByName && (
                <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
                  <span style={{ fontWeight: 700, color: "var(--ink-3)" }}>
                    {messages.historyBuiltBy}:
                  </span>{" "}
                  {a.builtByName}
                </div>
              )}
              {a.printedByName && (
                <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
                  <span style={{ fontWeight: 700, color: "var(--ink-3)" }}>
                    {messages.historyPrintedBy}:
                  </span>{" "}
                  {a.printedByName}
                </div>
              )}
              {a.withLawyer && a.lawyerVerdict && (
                <div style={{ marginTop: 6 }}>
                  <Chip tone={a.lawyerVerdict === "validated" ? "green" : "amber"}>
                    {messages.historyLawyerVerdict}: {a.lawyerVerdict}
                  </Chip>
                </div>
              )}
            </div>

            {!a.isCurrentAttempt && (
              <div style={{ marginTop: 10 }}>
                <GhostBtn
                  size="md"
                  full={false}
                  onClick={() => onDownload(a.expedienteId)}
                >
                  {messages.historyDownloadOnly}
                </GhostBtn>
              </div>
            )}
          </div>
        ))}
      </div>
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------
// Table row
// ---------------------------------------------------------------------------

interface TableRowProps {
  item: PrintQueueItemVM;
  messages: ImpresionViewMessages;
  onViewPdf: (item: PrintQueueItemVM) => void;
  onDownload: (item: PrintQueueItemVM) => void;
  onMarkPrinted: (item: PrintQueueItemVM) => void;
  onLogShipment: (item: PrintQueueItemVM) => void;
  onMarkFiled: (item: PrintQueueItemVM) => void;
  onAdvance: (item: PrintQueueItemVM) => void;
  onOpenHistory: (item: PrintQueueItemVM) => void;
}

function PrintRow({
  item,
  messages,
  onViewPdf,
  onDownload,
  onMarkPrinted,
  onLogShipment,
  onMarkFiled,
  onAdvance,
  onOpenHistory,
}: TableRowProps) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpenHistory(item)}
      style={{
        cursor: "pointer",
        background: hovered ? "var(--hover, rgba(47,107,255,0.04))" : "transparent",
        transition: "background 0.14s",
      }}
    >
      {/* Caso */}
      <td style={{ padding: "14px 16px", verticalAlign: "top" }}>
        <div
          style={{
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 13,
            color: "var(--ink)",
          }}
        >
          {item.caseNumber}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>
          {item.clientName}
        </div>
      </td>

      {/* Servicio */}
      <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
        {item.serviceLabel ? (
          <Chip tone="blue">{item.serviceLabel}</Chip>
        ) : (
          <span style={{ color: "var(--ink-3)", fontSize: 13 }}>—</span>
        )}
      </td>

      {/* Intento */}
      <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <Chip tone={item.attemptNo > 1 ? "gold" : "blue"}>
            {messages.attemptChip} {item.attemptNo}
          </Chip>
          {item.withLawyer && (
            <span
              title={messages.lawyerValidated}
              aria-label={messages.lawyerValidated}
              style={{ display: "inline-flex", cursor: "help" }}
            >
              <Icon name="scale" size={16} color="var(--gold-deep)" />
            </span>
          )}
        </div>
      </td>

      {/* Páginas */}
      <td
        style={{
          padding: "14px 16px",
          verticalAlign: "middle",
          fontFamily: "var(--font-title)",
          fontWeight: 700,
          fontSize: 14,
          color: "var(--ink)",
        }}
      >
        {item.pageCount ?? "—"}
      </td>

      {/* Enviado por */}
      <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {item.sentByName && (
            <Avatar
              name={item.sentByName}
              variant="staff"
              size={28}
            />
          )}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
              {item.sentByName ?? "—"}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {relativeTime(item.sentToFinanceAt)}
            </div>
          </div>
        </div>
      </td>

      {/* Estado */}
      <td style={{ padding: "14px 16px", verticalAlign: "middle" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          {!item.hasPdf ? (
            <StatusPill kind="corregir">{messages.pdfUnavailable}</StatusPill>
          ) : item.status === "sent_to_finance" ? (
            <StatusPill kind="pendiente">{messages.statusPending}</StatusPill>
          ) : (
            <StatusPill kind="hecho">{messages.statusPrinted}</StatusPill>
          )}
          {item.shippedAt && (
            <Chip tone="green">
              {messages.chipShipped.replace("{fecha}", shortDate(item.shippedAt))}
            </Chip>
          )}
          {item.filedAt && (
            <Chip tone="blue">
              {messages.chipFiled.replace("{fecha}", shortDate(item.filedAt))}
            </Chip>
          )}
        </div>
      </td>

      {/* Acciones */}
      <td
        style={{ padding: "14px 16px", verticalAlign: "middle" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {/* Ver PDF */}
          <GhostBtn
            size="md"
            full={false}
            icon="doc"
            disabled={!item.hasPdf}
            onClick={() => onViewPdf(item)}
            aria-label={messages.viewPdf}
          >
            {messages.viewPdf}
          </GhostBtn>

          {/* Descargar (solo si hay PDF) */}
          {item.hasPdf && (
            <GhostBtn
              size="md"
              full={false}
              onClick={() => onDownload(item)}
              aria-label={messages.download}
            >
              {messages.download}
            </GhostBtn>
          )}

          {/* Reimprimir (solo impresos) */}
          {item.status === "printed" && item.hasPdf && (
            <GhostBtn
              size="md"
              full={false}
              icon="doc"
              onClick={() => onDownload(item)}
              aria-label={messages.reprint}
            >
              {messages.reprint}
            </GhostBtn>
          )}

          {/* Cycle btn */}
          <RowActionBtn
            item={item}
            messages={messages}
            onMarkPrinted={() => onMarkPrinted(item)}
            onLogShipment={() => onLogShipment(item)}
            onMarkFiled={() => onMarkFiled(item)}
          />

          {/* Avanzar de fase — visible once the expediente is printed */}
          {item.status === "printed" && (
            <GhostBtn
              size="md"
              full={false}
              icon="chevR"
              onClick={() => onAdvance(item)}
              aria-label={messages.advancePhase}
              style={{ color: "var(--gold-deep)", borderColor: "var(--gold)" }}
            >
              {messages.advancePhase}
            </GhostBtn>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          {[120, 90, 80, 40, 130, 100, 160].map((w, j) => (
            <td key={j} style={{ padding: "14px 16px" }}>
              <Skeleton width={w} height={20} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ImpresionView({
  items: initialItems,
  history,
  messages,
  actions,
}: ImpresionViewProps) {
  // --- filter state ---
  const [activeFilter, setActiveFilter] = React.useState<FilterTab>("pending");
  const [search, setSearch] = React.useState("");

  // --- overlay state ---
  const [confirmPrintOpen, setConfirmPrintOpen] = React.useState(false);
  const [shipmentOpen, setShipmentOpen] = React.useState(false);
  const [confirmFiledOpen, setConfirmFiledOpen] = React.useState(false);
  const [advanceOpen, setAdvanceOpen] = React.useState(false);
  const [pdfOpen, setPdfOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  // --- selected item ---
  const [selectedItem, setSelectedItem] = React.useState<PrintQueueItemVM | null>(null);

  // --- pdf url state ---
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = React.useState(false);

  // --- busy state ---
  const [busyPrint, setBusyPrint] = React.useState(false);
  const [busyShip, setBusyShip] = React.useState(false);
  const [busyFiled, setBusyFiled] = React.useState(false);
  const [busyAdvance, setBusyAdvance] = React.useState(false);

  // --- advance-phase owner selection (when several sales owners are eligible) ---
  const [advanceCandidates, setAdvanceCandidates] = React.useState<AdvanceOwnerOptionVM[] | null>(null);
  const [advanceOwner, setAdvanceOwner] = React.useState("");

  // --- local items (optimistic reload on window.location.reload) ---
  const [items] = React.useState(initialItems);

  // ---------------------------------------------------------------------------
  // Computed: pending count + filtered items
  // ---------------------------------------------------------------------------

  const pendingCount = items.filter((i) => i.status === "sent_to_finance").length;

  const filtered = React.useMemo(() => {
    let result = items;

    if (activeFilter === "pending") {
      result = result.filter((i) => i.status === "sent_to_finance");
    } else if (activeFilter === "printed") {
      result = result.filter((i) => i.status === "printed");
    } else if (activeFilter === "shipped") {
      result = result.filter((i) => i.status === "printed" && !!i.shippedAt);
    } else if (activeFilter === "filed") {
      result = result.filter((i) => !!i.filedAt);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.caseNumber.toLowerCase().includes(q) ||
          i.clientName.toLowerCase().includes(q),
      );
    }

    return result;
  }, [items, activeFilter, search]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function openHistory(item: PrintQueueItemVM) {
    setSelectedItem(item);
    setHistoryOpen(true);
  }

  async function openPdf(item: PrintQueueItemVM) {
    setSelectedItem(item);
    setPdfUrl(null);
    setPdfOpen(true);
    setLoadingPdf(true);
    try {
      const res = await actions.getPdfUrl(item.expedienteId);
      if (res.ok && res.data) setPdfUrl(res.data);
    } finally {
      setLoadingPdf(false);
    }
  }

  async function downloadPdf(item: PrintQueueItemVM) {
    const res = await actions.getPdfUrl(item.expedienteId);
    if (res.ok && res.data) {
      const a = document.createElement("a");
      a.href = res.data;
      a.download = `${item.caseNumber}-intento-${item.attemptNo}.pdf`;
      a.click();
    } else {
      toast.error(messages.toastError);
    }
  }

  function requestMarkPrinted(item: PrintQueueItemVM) {
    setSelectedItem(item);
    setConfirmPrintOpen(true);
  }

  function requestLogShipment(item: PrintQueueItemVM) {
    setSelectedItem(item);
    setShipmentOpen(true);
  }

  function requestMarkFiled(item: PrintQueueItemVM) {
    setSelectedItem(item);
    setConfirmFiledOpen(true);
  }

  function requestAdvance(item: PrintQueueItemVM) {
    setSelectedItem(item);
    setAdvanceCandidates(null);
    setAdvanceOwner("");
    setAdvanceOpen(true);
  }

  async function handleConfirmPrint() {
    if (!selectedItem) return;
    setBusyPrint(true);
    try {
      const res = await actions.markPrinted(selectedItem.expedienteId);
      if (res.ok) {
        toast.success(messages.toastPrinted);
        setConfirmPrintOpen(false);
        window.location.reload();
      } else {
        toast.error(`${messages.toastError} [${res.error?.code ?? "?"}]`);
      }
    } finally {
      setBusyPrint(false);
    }
  }

  async function handleConfirmShipment(trackingRef: string | undefined) {
    if (!selectedItem) return;
    setBusyShip(true);
    try {
      const res = await actions.markShipped(selectedItem.expedienteId, trackingRef);
      if (res.ok) {
        toast.success(messages.toastShipped);
        setShipmentOpen(false);
        window.location.reload();
      } else {
        toast.error(`${messages.toastError} [${res.error?.code ?? "?"}]`);
      }
    } finally {
      setBusyShip(false);
    }
  }

  async function handleConfirmFiled() {
    if (!selectedItem) return;
    setBusyFiled(true);
    try {
      const res = await actions.markFiled(selectedItem.expedienteId);
      if (res.ok) {
        toast.success(messages.toastFiled);
        setConfirmFiledOpen(false);
        window.location.reload();
      } else {
        toast.error(`${messages.toastError} [${res.error?.code ?? "?"}]`);
      }
    } finally {
      setBusyFiled(false);
    }
  }

  async function handleConfirmAdvance() {
    if (!selectedItem) return;
    setBusyAdvance(true);
    try {
      const res = await actions.advancePhase({
        caseId: selectedItem.caseId,
        toOwnerId: advanceOwner || undefined,
      });
      if (res.ok) {
        toast.success(res.completed ? messages.toastCompleted : messages.toastAdvanced);
        setAdvanceOpen(false);
        window.location.reload();
      } else if (res.error?.code === "STAGE_OWNER_REQUIRED" && res.candidates) {
        // Several sales owners are eligible — keep the modal open and ask.
        setAdvanceCandidates(res.candidates);
      } else {
        toast.error(`${messages.toastError} [${res.error?.code ?? "?"}]`);
      }
    } finally {
      setBusyAdvance(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const FILTERS: { key: FilterTab; label: string }[] = [
    { key: "pending", label: messages.filterPending },
    { key: "printed", label: messages.filterPrinted },
    { key: "shipped", label: messages.filterShipped },
    { key: "filed", label: messages.filterFiled },
    { key: "all", label: messages.filterAll },
  ];

  const COL_HEADERS = [
    messages.colCase,
    messages.colService,
    messages.colAttempt,
    messages.colPages,
    messages.colSentBy,
    messages.colStatus,
    messages.colActions,
  ];

  return (
    <div style={{ padding: "32px 36px", maxWidth: 1280 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          marginBottom: 24,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 24,
            color: "var(--ink)",
            letterSpacing: "-0.02em",
          }}
        >
          {messages.title}
        </h1>
        {pendingCount > 0 && (
          <span style={{ fontSize: 15, color: "var(--ink-2)", fontWeight: 600 }}>
            {messages.counterPending.replace("{n}", String(pendingCount))}
          </span>
        )}
      </div>

      {/* Filters row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        {FILTERS.map(({ key, label }) => {
          const active = activeFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveFilter(key)}
              style={{
                height: 34,
                padding: "0 16px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-title)",
                fontWeight: 800,
                fontSize: 13,
                background: active ? "var(--accent)" : "var(--chip)",
                color: active ? "#fff" : "var(--ink-2)",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              {label}
            </button>
          );
        })}

        <div style={{ flex: 1, minWidth: 180, maxWidth: 260 }}>
          <div style={{ position: "relative" }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={messages.searchPlaceholder}
              aria-label={messages.searchPlaceholder}
              style={{
                width: "100%",
                height: 34,
                borderRadius: 999,
                border: "2px solid var(--line)",
                padding: "0 14px 0 36px",
                fontSize: 13,
                fontFamily: "var(--font-title)",
                color: "var(--ink)",
                background: "var(--card)",
                outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.boxShadow =
                  "0 0 0 4px var(--accent-soft, rgba(47,107,255,0.14))";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--line)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
              }}
            >
              <Icon name="search" size={16} color="var(--ink-3)" />
            </span>
          </div>
        </div>
      </div>

      {/* Table */}
      <Card style={{ padding: 0, overflow: "hidden", borderRadius: 20 }}>
        {filtered.length === 0 && !search ? (
          /* Empty state */
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "64px 32px",
              gap: 16,
            }}
          >
            <Lex mood="feliz" size={92} />
            <p
              style={{
                margin: 0,
                fontSize: 15,
                color: "var(--ink-2)",
                textAlign: "center",
                maxWidth: 360,
                lineHeight: 1.6,
              }}
            >
              {messages.emptyBody}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                tableLayout: "auto",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "var(--hover, rgba(47,107,255,0.04))",
                    borderBottom: "2px solid var(--line)",
                  }}
                >
                  {COL_HEADERS.map((col) => (
                    <th
                      key={col}
                      scope="col"
                      style={{
                        padding: "12px 16px",
                        textAlign: "left",
                        fontFamily: "var(--font-title)",
                        fontWeight: 800,
                        fontSize: 12,
                        color: "var(--ink-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody
                style={{ borderTop: "1px solid var(--line)" }}
              >
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        padding: "32px 16px",
                        textAlign: "center",
                        color: "var(--ink-3)",
                        fontSize: 14,
                      }}
                    >
                      Sin resultados para &ldquo;{search}&rdquo;
                    </td>
                  </tr>
                ) : (
                  filtered.map((item, idx) => (
                    <React.Fragment key={item.expedienteId}>
                      {idx > 0 && (
                        <tr aria-hidden="true">
                          <td
                            colSpan={7}
                            style={{
                              padding: 0,
                              borderTop: "1px solid var(--line)",
                              height: 0,
                            }}
                          />
                        </tr>
                      )}
                      <PrintRow
                        item={item}
                        messages={messages}
                        onViewPdf={openPdf}
                        onDownload={downloadPdf}
                        onMarkPrinted={requestMarkPrinted}
                        onLogShipment={requestLogShipment}
                        onMarkFiled={requestMarkFiled}
                        onAdvance={requestAdvance}
                        onOpenHistory={openHistory}
                      />
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Confirm print modal */}
      <ConfirmModal
        open={confirmPrintOpen}
        onOpenChange={setConfirmPrintOpen}
        title={messages.confirmPrinted}
        body={messages.confirmPrintedBody}
        confirmLabel={messages.markPrinted}
        busy={busyPrint}
        onConfirm={handleConfirmPrint}
        cancelLabel={messages.cancel}
      />

      {/* Shipment modal */}
      <ShipmentModal
        open={shipmentOpen}
        onOpenChange={setShipmentOpen}
        messages={messages}
        busy={busyShip}
        onConfirm={handleConfirmShipment}
      />

      {/* Confirm filed modal */}
      <ConfirmModal
        open={confirmFiledOpen}
        onOpenChange={setConfirmFiledOpen}
        title={messages.confirmFiled}
        body={messages.confirmFiledBody}
        confirmLabel={messages.markFiled}
        busy={busyFiled}
        onConfirm={handleConfirmFiled}
        cancelLabel={messages.cancel}
      />

      {/* Advance-phase modal */}
      <AdvanceModal
        open={advanceOpen}
        onOpenChange={setAdvanceOpen}
        messages={messages}
        busy={busyAdvance}
        candidates={advanceCandidates}
        selectedOwner={advanceOwner}
        onSelectOwner={setAdvanceOwner}
        onConfirm={handleConfirmAdvance}
      />

      {/* PDF viewer modal */}
      <PdfViewerModal
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        item={selectedItem}
        pdfUrl={pdfUrl}
        loadingUrl={loadingPdf}
        messages={messages}
        onDownload={() => selectedItem && downloadPdf(selectedItem)}
      />

      {/* History side panel */}
      <HistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        attempts={selectedItem ? (history[selectedItem.caseId] ?? []) : []}
        messages={messages}
        onDownload={(expedienteId) => {
          // build a minimal item for download lookup
          const a = document.createElement("a");
          void actions.getPdfUrl(expedienteId).then((res) => {
            if (res.ok && res.data) {
              a.href = res.data;
              a.download = `expediente-${expedienteId}.pdf`;
              a.click();
            }
          });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton page (used in Suspense / loading.tsx)
// ---------------------------------------------------------------------------

export function ImpresionSkeleton() {
  return (
    <div style={{ padding: "32px 36px", maxWidth: 1280 }}>
      <Skeleton width={220} height={28} radius={8} style={{ marginBottom: 24 }} />
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[100, 80, 90, 80, 60].map((w, i) => (
          <Skeleton key={i} width={w} height={34} radius={999} />
        ))}
      </div>
      <Card style={{ padding: 0, borderRadius: 20, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <TableSkeleton />
          </tbody>
        </table>
      </Card>
    </div>
  );
}
