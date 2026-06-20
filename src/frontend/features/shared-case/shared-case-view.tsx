"use client";

/**
 * SharedCaseView — the single staff case workspace (DOC-50 §4, DOC-53 §3).
 *
 * First real consumer of `features/shared-case`. Renders:
 *  - Header: ← back, case number, StatusPill, client · service · plan chip.
 *  - Admin-mode bar (gold-soft, shield) — exclusive to the admin role (RF-ADM-007).
 *  - Contextual banners (payment_pending / no phase).
 *  - Data-driven tab bar (Resumen · Documentos · Partes for F2-W2-b) with badges.
 *  - The active tab content.
 *
 * Tabs are materialized by `buildTabs` (config, not forks). Future tabs slot in
 * via the registry without touching this component.
 */

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/frontend/components/brand/icon";
import { Chip } from "@/frontend/components/brand/chip";
import { StatusPill } from "@/frontend/components/brand/status-pill";
import { buildTabs } from "./build-tabs";
import { ResumenTab } from "./tabs/resumen-tab";
import { DocumentosTab } from "./tabs/documentos-tab";
import { PartesTab } from "./tabs/partes-tab";
import { MensajesTab } from "./tabs/mensajes-tab";
import { buildChatActions, type RawChatActions } from "@/frontend/features/messaging/build-chat-actions";
import type { CaseWorkspaceVM, CaseDetailActions, CaseTabId } from "./types";
import type { CasosStrings } from "./strings";

export interface SharedCaseViewProps {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
  locale: "es" | "en";
  /** Back link to the casos list (admin: /admin/casos). */
  backHref: string;
  /** Admin-mode bar visible only for the admin role. */
  isAdmin: boolean;
  /** F7-Ola7a — raw messaging server actions (object of "use server" refs). */
  chatRaw?: RawChatActions;
}

export function SharedCaseView({
  vm,
  actions,
  strings,
  locale,
  backHref,
  isAdmin,
  chatRaw,
}: SharedCaseViewProps) {
  const t = strings.detail;
  const h = vm.header;
  const documentsToReview = vm.documents.filter((d) => d.status === "uploaded").length;

  const chat = React.useMemo(
    () => (chatRaw ? buildChatActions(chatRaw, vm.header.caseId) : null),
    [chatRaw, vm.header.caseId],
  );

  const tabs = buildTabs({
    labels: {
      resumen: t.tabSummary,
      documentos: t.tabDocuments,
      partes: t.tabParties,
      mensajes: locale === "es" ? "Mensajes" : "Messages",
    },
    documentsToReview,
  }).filter((tab) => tab.id !== "mensajes" || !!chat);
  const [active, setActive] = React.useState<CaseTabId>("resumen");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Header */}
      <div style={{ padding: "4px 0 16px" }}>
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
            marginBottom: 12,
          }}
        >
          <Icon name="chevL" size={16} color="var(--ink-2)" />
          {t.back}
        </Link>

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
            {h.clientName} · {h.serviceLabel}
          </span>
          {h.planKind === "with_lawyer" ? (
            <Chip tone="gold">{strings.planWith}</Chip>
          ) : (
            <Chip tone="blue">{strings.planSelf}</Chip>
          )}
        </div>
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
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--gold-deep)" }}>
            {t.adminBar}
          </span>
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

      {/* Tab bar */}
      <div
        role="tablist"
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        {tabs.map((tab) => {
          const on = active === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={on}
              type="button"
              onClick={() => setActive(tab.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                height: 38,
                padding: "0 16px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                background: on ? "var(--accent-soft, var(--blue-soft))" : "transparent",
                color: on ? "var(--accent)" : "var(--ink-2)",
                fontFamily: "var(--font-title)",
                fontWeight: 800,
                fontSize: 14,
                transition: "background-color .14s var(--ease, ease)",
              }}
            >
              {tab.label}
              {!!tab.badge && tab.badge > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    minWidth: 20,
                    height: 20,
                    padding: "0 6px",
                    borderRadius: 999,
                    background: "var(--red)",
                    color: "#fff",
                    fontSize: 11.5,
                    fontWeight: 800,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active tab */}
      <div role="tabpanel">
        {active === "resumen" && (
          <ResumenTab vm={vm} actions={actions} strings={strings} locale={locale} />
        )}
        {active === "documentos" && (
          <DocumentosTab vm={vm} actions={actions} strings={strings} />
        )}
        {active === "partes" && <PartesTab vm={vm} strings={strings} />}
        {active === "mensajes" && chat && (
          <MensajesTab loadThread={chat.loadThread} actions={chat.actions} locale={locale} />
        )}
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
