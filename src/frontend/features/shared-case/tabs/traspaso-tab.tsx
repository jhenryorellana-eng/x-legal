"use client";

/**
 * Traspaso tab (DOC-52 §5.9) — handoff readiness checklist computed from real
 * case signals (payment, contract, documents, forms). The "enviar a expediente"
 * action (creates the paralegal task, P-52-05) lands in a later wave.
 */

import { Card } from "@/frontend/components/brand/card";
import { Icon } from "@/frontend/components/brand/icon";
import type { CaseWorkspaceVM } from "../types";
import type { CasosStrings } from "../strings";

export function TraspasoTab({
  vm,
  strings,
}: {
  vm: CaseWorkspaceVM;
  strings: CasosStrings;
}) {
  const t = strings.detail;

  const items = [
    { label: t.checkPayment, ok: vm.header.status !== "payment_pending" },
    { label: t.checkContract, ok: vm.header.contractStatus === "signed" },
    { label: t.checkDocs, ok: vm.docsTotal === 0 || vm.docsApproved >= vm.docsTotal },
    { label: t.checkForms, ok: vm.formsTotal === 0 || vm.formsDone >= vm.formsTotal },
  ];
  const allReady = items.every((i) => i.ok);

  return (
    <Card>
      <h2 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 18, color: "var(--ink)" }}>
        {t.traspasoTitle}
      </h2>
      <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{t.traspasoSub}</p>

      <div style={{ marginTop: 18 }}>
        {items.map((it) => (
          <div key={it.label} className="tras-item">
            <span className={`tras-check ${it.ok ? "ok" : "no"}`}>
              <Icon name={it.ok ? "check" : "info"} size={16} color={it.ok ? "#fff" : "#b5740b"} />
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{it.label}</span>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: allReady ? "var(--green-soft)" : "var(--gold-soft)",
          borderRadius: 12,
          padding: "12px 14px",
        }}
      >
        <Icon name={allReady ? "check" : "clock"} size={18} color={allReady ? "var(--green)" : "var(--gold-deep)"} />
        <span style={{ fontSize: 13.5, fontWeight: 700, color: allReady ? "var(--green)" : "var(--gold-deep)" }}>
          {allReady ? t.traspasoReady : t.traspasoNotReady}
        </span>
      </div>
    </Card>
  );
}
