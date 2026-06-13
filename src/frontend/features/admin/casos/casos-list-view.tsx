"use client";

/**
 * Admin casos list (DOC-53 §2, prompt ADM-02).
 *
 * DataTable of ALL org cases. Filters (service / status / search) live in the
 * URL (searchParams) so the list state is shareable (RF-ADM-006). StatusPill per
 * status, mini ProgressBar of phase position, "Cargar más" cursor pagination.
 * Header "Nuevo caso" opens the 2-step modal.
 */

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  DataTable,
  type Column,
} from "@/frontend/components/desktop/data-table";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import { Chip } from "@/frontend/components/brand/chip";
import { StatusPill, type StatusKind } from "@/frontend/components/brand/status-pill";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { Icon } from "@/frontend/components/brand/icon";
import { NewCaseModal, type NewCaseService } from "./new-case-modal";
import type { CasosStrings } from "@/frontend/features/shared-case";
import { interp } from "@/frontend/features/shared-case";
import type { NewCaseActions } from "./new-case-modal";

export interface CaseRowVM {
  id: string;
  caseNumber: string;
  clientName: string;
  serviceLabel: string;
  planKind: "self" | "with_lawyer";
  phaseLabel: string;
  phasePos: number;
  phaseTotal: number;
  status: string;
  statusPill: StatusKind | "amber";
  statusLabel: string;
  openedRel: string;
}

const STATUS_OPTIONS = [
  "payment_pending",
  "active",
  "in_validation",
  "ready_for_delivery",
  "delivered",
  "completed",
  "cancelled",
  "on_hold",
] as const;

export function CasosListView({
  rows,
  total,
  hasMore,
  nextCursor,
  services,
  strings,
  detailBasePath,
  newCaseActions,
  signingBaseUrl,
}: {
  rows: CaseRowVM[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  services: NewCaseService[];
  strings: CasosStrings;
  detailBasePath: string;
  newCaseActions: NewCaseActions;
  signingBaseUrl: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);

  const statusFilter = params.get("status") ?? "";
  const serviceFilter = params.get("service") ?? "";
  const search = params.get("q") ?? "";
  const [searchInput, setSearchInput] = React.useState(search);

  const hasFilters = !!(statusFilter || serviceFilter || search);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("cursor");
    router.push(`${pathname}?${next.toString()}`);
  }

  function clearFilters() {
    router.push(pathname);
    setSearchInput("");
  }

  function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const next = new URLSearchParams(params.toString());
    next.set("cursor", nextCursor);
    router.push(`${pathname}?${next.toString()}`);
  }

  const columns: Column<CaseRowVM>[] = [
    {
      id: "case",
      header: strings.colCase,
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 800, fontSize: 13, color: "var(--ink)" }}>{r.caseNumber}</div>
          <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{r.clientName}</div>
        </div>
      ),
    },
    {
      id: "service",
      header: strings.colService,
      cell: (r) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13.5, color: "var(--ink)" }}>{r.serviceLabel}</span>
          {r.planKind === "with_lawyer" ? (
            <Chip tone="gold">{strings.planWith}</Chip>
          ) : (
            <Chip tone="blue">{strings.planSelf}</Chip>
          )}
        </div>
      ),
    },
    {
      id: "phase",
      header: strings.colPhase,
      cell: (r) =>
        r.phaseTotal > 0 ? (
          <div style={{ minWidth: 130 }}>
            <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 5 }}>
              {r.phaseLabel} ({r.phasePos}/{r.phaseTotal})
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 999,
                background: "var(--line)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.round((r.phasePos / r.phaseTotal) * 100)}%`,
                  background: "linear-gradient(90deg, var(--gold), var(--gold-deep))",
                  borderRadius: 999,
                }}
              />
            </div>
          </div>
        ) : (
          <span style={{ color: "var(--ink-3)" }}>—</span>
        ),
    },
    {
      id: "status",
      header: strings.colStatus,
      cell: (r) =>
        r.statusPill === "amber" ? (
          <Chip tone="amber" dot>
            {r.statusLabel}
          </Chip>
        ) : (
          <StatusPill kind={r.statusPill}>{r.statusLabel}</StatusPill>
        ),
    },
    {
      id: "opened",
      header: strings.colOpened,
      cell: (r) => <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{r.openedRel}</span>,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* view-head */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--font-title)",
                fontWeight: 800,
                fontSize: 24,
                color: "var(--ink)",
              }}
            >
              {strings.title}
            </h1>
            <Chip tone="blue">{interp(strings.count, { n: String(total) })}</Chip>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--ink-2)" }}>{strings.sub}</p>
        </div>
        <GradientBtn size="md" full={false} icon="plus" onClick={() => setModalOpen(true)}>
          {strings.newCase}
        </GradientBtn>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <FilterSelect
          label={strings.filterService}
          value={serviceFilter}
          allLabel={strings.allOption}
          options={services.map((s) => ({ value: s.id, label: s.label }))}
          onChange={(v) => setParam("service", v)}
        />
        <FilterSelect
          label={strings.filterStatus}
          value={statusFilter}
          allLabel={strings.allOption}
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: strings.status[s] }))}
          onChange={(v) => setParam("status", v)}
        />
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>
            <Icon name="search" size={16} color="var(--ink-3)" />
          </span>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setParam("q", searchInput.trim());
            }}
            placeholder={strings.search}
            style={{
              width: "100%",
              height: 40,
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--card)",
              color: "var(--ink)",
              padding: "0 14px 0 34px",
              fontSize: 13.5,
              fontFamily: "var(--font-body)",
            }}
          />
        </div>
        {hasFilters && (
          <GhostBtn size="md" full={false} icon="x" onClick={clearFilters}>
            {strings.clearFilters}
          </GhostBtn>
        )}
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`${detailBasePath}/${r.id}`)}
        hasMore={hasMore}
        onLoadMore={loadMore}
        loadingMore={loadingMore}
        loadMoreLabel={strings.loadMore}
        empty={
          <EmptyState
            title={hasFilters ? strings.emptyFilteredTitle : strings.emptyTitle}
            subtitle={hasFilters ? undefined : strings.emptySub}
            mood="calma"
            action={
              hasFilters
                ? { label: strings.clearFilters, icon: "x", onClick: clearFilters }
                : undefined
            }
          />
        }
      />

      {/* New case modal */}
      <NewCaseModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        services={services}
        strings={strings}
        actions={newCaseActions}
        signingBaseUrl={signingBaseUrl}
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: string;
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 40,
        borderRadius: 999,
        border: "1px solid var(--line)",
        background: value ? "var(--blue-soft)" : "var(--card)",
        color: value ? "var(--accent)" : "var(--ink-2)",
        padding: "0 14px",
        fontSize: 13.5,
        fontWeight: 700,
        fontFamily: "var(--font-body)",
        cursor: "pointer",
      }}
    >
      <option value="">{label}: {allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
