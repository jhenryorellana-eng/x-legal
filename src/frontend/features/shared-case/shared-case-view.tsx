"use client";

/**
 * SharedCaseView — the single staff case workspace (DOC-50 §4, DOC-52/53).
 * Shared by Vanessa (/ventas/clientes/[caseId]) and Henry (/admin/casos/[caseId]).
 *
 * Rebuilt to the UI Vanessa design: header (← back, case number, StatusPill,
 * client · service · plan), admin-mode bar (RF-ADM-007), contextual banners,
 * the `.subtabs` tab bar (role-aware via buildTabs) and the active tab content.
 */

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/frontend/components/brand/icon";
import { Chip } from "@/frontend/components/brand/chip";
import { StatusPill } from "@/frontend/components/brand/status-pill";
import { buildTabs } from "./build-tabs";
import { ResumenTab } from "./tabs/resumen-tab";
import { ContratoTab } from "./tabs/contrato-tab";
import { CitasTab } from "./tabs/citas-tab";
import { DocumentosTab } from "./tabs/documentos-tab";
import { InformacionTab } from "./tabs/informacion-tab";
import { TraspasoTab } from "./tabs/traspaso-tab";
import { HistorialTab } from "./tabs/historial-tab";
import { PagosTab } from "./tabs/pagos-tab";
import { GeneracionesTab } from "./tabs/generaciones-tab";
import { ValidacionTab } from "./tabs/validacion-tab";
import { ExpedienteTab } from "./tabs/expediente-tab";
import { FasesAnterioresTab } from "./tabs/fases-anteriores-tab";
import { PreMortemTab } from "./tabs/pre-mortem-tab";
import { buildChatActions, type RawChatActions } from "@/frontend/features/messaging/build-chat-actions";
import { useMessagingController } from "@/frontend/features/messaging/messaging-controller";
import { stageLabel } from "./stage-label";
import type { CaseWorkspaceVM, CaseDetailActions, CaseTabId, StaffRoleVM } from "./types";
import type { CasosStrings } from "./strings";

export interface SharedCaseViewProps {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
  locale: "es" | "en";
  /** Back link to the casos list. */
  backHref: string;
  /** Admin-mode bar visible only for the admin role. */
  isAdmin: boolean;
  /** F7-Ola7a — raw messaging server actions (object of "use server" refs). */
  chatRaw?: RawChatActions;
  /**
   * Org admin override of the visible tabs, per role (from case_tab_role_access).
   * A role present → use its set; absent → the role's code default. The view
   * resolves the effective role (admin vs vm.role) itself.
   */
  tabAccessByRole?: Partial<Record<StaffRoleVM, readonly CaseTabId[]>> | null;
  /**
   * Tab to open on mount (deep link ?tab=… — e.g. the proof-submitted
   * notification opens Pagos directly). Ignored when not visible/unlocked.
   */
  initialTab?: CaseTabId;
}

export function SharedCaseView({
  vm,
  actions,
  strings,
  locale,
  backHref,
  isAdmin,
  chatRaw,
  tabAccessByRole,
  initialTab,
}: SharedCaseViewProps) {
  const t = strings.detail;
  const tb = t.tabs;
  const h = vm.header;
  const documentsToReview = vm.documents.filter((d) => d.status === "uploaded").length;

  // Full client name for the subtitle: the primary party's legal first+last
  // (client_profiles), falling back to the resolved display name.
  const primaryParty = vm.parties[0];
  const clientFullName =
    (primaryParty
      ? [primaryParty.firstName, primaryParty.lastName].filter(Boolean).join(" ")
      : "") ||
    primaryParty?.name ||
    h.clientName;

  const hasChat = React.useMemo(
    () => (chatRaw ? buildChatActions(chatRaw, vm.header.caseId) : null) != null,
    [chatRaw, vm.header.caseId],
  );

  const messaging = useMessagingController();

  const tabs = buildTabs({
    strings,
    isAdmin,
    role: vm.role,
    documentsToReview,
    isPaymentPending: vm.header.isPaymentPending,
    requiresLawyerValidation: vm.requiresLawyerValidation,
    hasPriorPhases: (vm.priorPhases?.length ?? 0) > 0,
    hasPreMortem: vm.preMortem?.enabled ?? false,
    allowedTabIds: tabAccessByRole?.[isAdmin ? "admin" : vm.role] ?? null,
  });
  const [active, setActive] = React.useState<CaseTabId>(() =>
    initialTab && tabs.some((tab) => tab.id === initialTab && !tab.locked)
      ? initialTab
      : "resumen",
  );
  // Shown when a locked tab is clicked before the case is active.
  const [lockedHint, setLockedHint] = React.useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Header */}
      <div style={{ padding: "4px 0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <Link
            href={backHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "var(--ink-2)",
              fontSize: 13.5,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            <Icon name="chevL" size={16} color="var(--ink-2)" />
            {t.back}
          </Link>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {isAdmin && (
              <HeaderLink href="/admin/auditoria" icon="scale">
                {t.auditLink}
              </HeaderLink>
            )}

            {hasChat && messaging && (
              <button
                type="button"
                onClick={() => messaging.openCaseChat(h.caseId)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--accent)",
                  cursor: "pointer",
                  border: "1px solid var(--line)",
                  borderRadius: 999,
                  padding: "6px 14px",
                  background: "var(--card, #fff)",
                }}
              >
                <Icon name="chat" size={15} color="var(--accent)" />
                {tb.mensajes}
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 24,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
            }}
          >
            {h.caseNumber}
          </h1>
          {h.statusPill === "amber" ? (
            <Chip tone="amber" dot>
              {h.statusLabel}
            </Chip>
          ) : (
            <StatusPill kind={h.statusPill}>{h.statusLabel}</StatusPill>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, color: "var(--ink-2)", fontWeight: 600 }}>
            {clientFullName}
            {h.clientPhone ? ` · ${h.clientPhone}` : ""} · {h.serviceLabel}
          </span>
          {h.planKind === "with_lawyer" ? (
            <Chip tone="gold">{strings.planWith}</Chip>
          ) : (
            <Chip tone="blue">{strings.planSelf}</Chip>
          )}
        </div>

        {/* Responsable / Etapa chip (eje propio) — so the owner never gets lost. */}
        {vm.stage && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontSize: 13,
                fontWeight: 700,
                color: "var(--ink-2)",
                border: "1px solid var(--line)",
                borderRadius: 999,
                padding: "5px 12px",
                background: "var(--card, #fff)",
              }}
            >
              <Icon name="user" size={14} color="var(--accent)" />
              {t.responsableLabel}: <strong style={{ color: "var(--ink)" }}>{vm.stage.ownerName ?? t.unassigned}</strong>
            </span>
            <Chip tone="blue">{t.etapaLabel}: {stageLabel(t, vm.stage.stage)}</Chip>
          </div>
        )}
      </div>

      {/* Admin-mode bar */}
      {isAdmin && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "var(--gold-soft)",
            border: "1px solid var(--gold-deep)",
            borderRadius: 12,
            padding: "10px 14px",
            marginBottom: 14,
          }}
        >
          <Icon name="shield" size={18} color="var(--gold-deep)" />
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--gold-deep)" }}>{t.adminBar}</span>
        </div>
      )}

      {/* Contextual banners */}
      {h.isPaymentPending && (
        <Banner icon="dollar" tone="accent">
          {t.bannerPaymentPending}
        </Banner>
      )}
      {!h.hasPhase && !h.isPaymentPending && (
        <Banner icon="info" tone="ink">
          {t.bannerNoPhase}
        </Banner>
      )}

      {/* Tab bar (.subtabs design) */}
      <div className="subtabs" role="tablist">
        {tabs.map((tab) => {
          const on = active === tab.id;
          if (tab.locked) {
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={false}
                aria-disabled
                type="button"
                className="subtab"
                title={t.lockedTabHint}
                onClick={() => setLockedHint(true)}
                style={{ opacity: 0.55, cursor: "not-allowed", display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <Icon name="lock" size={13} color="var(--ink-3)" />
                {tab.label}
              </button>
            );
          }
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={on}
              type="button"
              className={`subtab ${on ? "on" : ""}`}
              onClick={() => {
                setActive(tab.id);
                setLockedHint(false);
              }}
            >
              {tab.label}
              {!!tab.badge && tab.badge > 0 && <span className="subtab-badge">{tab.badge}</span>}
            </button>
          );
        })}
      </div>

      {/* Locked-tab hint — why the operativo tabs aren't available yet. */}
      {lockedHint && (
        <div style={{ marginTop: 12 }}>
          <Banner icon="info" tone="ink">
            {t.lockedTabHint}
          </Banner>
        </div>
      )}

      {/* Active tab */}
      <div role="tabpanel">
        {active === "resumen" && <ResumenTab vm={vm} actions={actions} strings={strings} locale={locale} />}
        {active === "contrato" && <ContratoTab vm={vm} actions={actions} strings={strings} locale={locale} />}
        {active === "citas" && <CitasTab vm={vm} actions={actions} strings={strings} />}
        {active === "documentos" && <DocumentosTab vm={vm} actions={actions} strings={strings} />}
        {active === "formularios" && (
          <InformacionTab
            vm={vm}
            actions={actions}
            strings={strings}
            onNavigateToGeneration={() => setActive(vm.isAdmin ? "generaciones" : "cartas")}
          />
        )}
        {active === "cartas" && <GeneracionesTab vm={vm} actions={actions} strings={strings} locale={locale} title={tb.cartas} />}
        {active === "generaciones" && <GeneracionesTab vm={vm} actions={actions} strings={strings} locale={locale} title={tb.generaciones} />}
        {active === "traspaso" && <TraspasoTab vm={vm} actions={actions} strings={strings} />}
        {active === "pagos" && <PagosTab vm={vm} actions={actions} strings={strings} locale={locale} />}
        {active === "expediente" && <ExpedienteTab vm={vm} strings={strings} title={tb.expediente} />}
        {active === "validacion" && <ValidacionTab vm={vm} strings={strings} title={tb.validacion} />}
        {active === "fasesAnteriores" && <FasesAnterioresTab vm={vm} actions={actions} strings={strings} />}
        {active === "preMortem" && <PreMortemTab vm={vm} actions={actions} strings={strings} />}
        {active === "historial" && <HistorialTab vm={vm} strings={strings} locale={locale} />}
      </div>
    </div>
  );
}

function Banner({
  icon,
  tone,
  children,
}: {
  icon: "dollar" | "info";
  tone: "accent" | "ink";
  children: React.ReactNode;
}) {
  const fg = tone === "accent" ? "var(--accent)" : "var(--ink-2)";
  const bg = tone === "accent" ? "var(--blue-soft)" : "var(--chip)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        background: bg,
        borderRadius: 12,
        padding: "10px 14px",
        marginBottom: 14,
      }}
    >
      <Icon name={icon} size={18} color={fg} />
      <span style={{ fontSize: 13.5, fontWeight: 700, color: fg }}>{children}</span>
    </div>
  );
}

function HeaderLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: "form" | "scale";
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        fontWeight: 700,
        color: "var(--accent)",
        textDecoration: "none",
        border: "1px solid var(--line)",
        borderRadius: 999,
        padding: "6px 14px",
        background: "var(--card, #fff)",
      }}
    >
      <Icon name={icon} size={15} color="var(--accent)" />
      {children}
    </Link>
  );
}
