"use client";

/**
 * ZelleReconConfigCard — finance-owned circuit breakers of the Zelle
 * reconciliation (kill switch, caps, tier-B mode). Lives in
 * /finanzas/configuracion; changes apply WITHOUT deploy (orgs.settings).
 *
 * Boundaries: no @/backend imports — config + action via props.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, GradientBtn, Icon } from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";

export interface ZelleReconConfigVM {
  enabled: boolean;
  tier_a_max_amount_cents: number;
  daily_auto_max_cents: number;
  daily_auto_max_count: number;
  per_payer_daily_max: number;
  tier_b_mode: "review_only" | "auto";
}

export interface ZelleReconConfigCardProps {
  config: ZelleReconConfigVM;
  locale: "es" | "en";
  updateAction: (patch: Partial<ZelleReconConfigVM>) => Promise<{ ok: boolean; error?: { code: string } }>;
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "10px 0",
  borderBottom: "1px solid var(--line)",
};

const inputStyle: React.CSSProperties = {
  width: 110,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "var(--card)",
  color: "var(--ink)",
  fontSize: 14,
  textAlign: "right",
};

export function ZelleReconConfigCard({ config, locale, updateAction }: ZelleReconConfigCardProps) {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(config.enabled);
  const [capUsd, setCapUsd] = React.useState(String(config.tier_a_max_amount_cents / 100));
  const [dailyUsd, setDailyUsd] = React.useState(String(config.daily_auto_max_cents / 100));
  const [dailyCount, setDailyCount] = React.useState(String(config.daily_auto_max_count));
  const [perPayer, setPerPayer] = React.useState(String(config.per_payer_daily_max));
  const [tierB, setTierB] = React.useState(config.tier_b_mode);
  const [busy, setBusy] = React.useState(false);

  const es = locale === "es";

  const save = async () => {
    const capCents = Math.round(Number(capUsd) * 100);
    const dailyCents = Math.round(Number(dailyUsd) * 100);
    const count = Number(dailyCount);
    const payer = Number(perPayer);
    if (![capCents, dailyCents, count, payer].every((n) => Number.isFinite(n) && n > 0)) {
      toast(es ? "Revisa los valores: deben ser positivos" : "Check the values: must be positive");
      return;
    }
    setBusy(true);
    const res = await updateAction({
      enabled,
      tier_a_max_amount_cents: capCents,
      daily_auto_max_cents: dailyCents,
      daily_auto_max_count: count,
      per_payer_daily_max: payer,
      tier_b_mode: tierB,
    });
    setBusy(false);
    if (res.ok) {
      toast(es ? "Configuración de conciliación guardada" : "Reconciliation settings saved");
      router.refresh();
    } else {
      toast(es ? `No se pudo guardar (${res.error?.code})` : `Could not save (${res.error?.code})`);
    }
  };

  return (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <Icon name="bolt" size={18} color="var(--accent)" />
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>
          {es ? "Conciliación automática de Zelle" : "Automatic Zelle reconciliation"}
        </p>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-2)" }}>
        {es
          ? "Controla cuándo un pago Zelle verificado por el banco se marca pagado sin intervención. Con el interruptor apagado, todo pago espera confirmación en la bandeja."
          : "Controls when a bank-verified Zelle payment settles without a human. With the switch off, every payment waits in the inbox."}
      </p>

      <div style={rowStyle}>
        <span style={{ fontSize: 14, color: "var(--ink)" }}>
          {es ? "Auto-aprobación (interruptor general)" : "Auto-approval (kill switch)"}
        </span>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={busy}
            style={{ width: 18, height: 18 }}
          />
          <span style={{ fontSize: 13, fontWeight: 700, color: enabled ? "var(--accent)" : "var(--ink-3)" }}>
            {enabled ? (es ? "Activa" : "On") : es ? "Apagada" : "Off"}
          </span>
        </label>
      </div>

      <div style={rowStyle}>
        <span style={{ fontSize: 14, color: "var(--ink)" }}>
          {es ? "Tope por pago (USD)" : "Per-payment cap (USD)"}
        </span>
        <input type="number" min={1} value={capUsd} onChange={(e) => setCapUsd(e.target.value)} disabled={busy} style={inputStyle} />
      </div>

      <div style={rowStyle}>
        <span style={{ fontSize: 14, color: "var(--ink)" }}>
          {es ? "Tope diario agregado (USD)" : "Daily aggregate cap (USD)"}
        </span>
        <input type="number" min={1} value={dailyUsd} onChange={(e) => setDailyUsd(e.target.value)} disabled={busy} style={inputStyle} />
      </div>

      <div style={rowStyle}>
        <span style={{ fontSize: 14, color: "var(--ink)" }}>
          {es ? "Máx. auto-aprobaciones por día" : "Max auto-approvals per day"}
        </span>
        <input type="number" min={1} value={dailyCount} onChange={(e) => setDailyCount(e.target.value)} disabled={busy} style={inputStyle} />
      </div>

      <div style={rowStyle}>
        <span style={{ fontSize: 14, color: "var(--ink)" }}>
          {es ? "Máx. por mismo pagador al día" : "Max per payer per day"}
        </span>
        <input type="number" min={1} value={perPayer} onChange={(e) => setPerPayer(e.target.value)} disabled={busy} style={inputStyle} />
      </div>

      <div style={{ ...rowStyle, borderBottom: "none" }}>
        <span style={{ fontSize: 14, color: "var(--ink)" }}>
          {es ? "Pagos sin código de referencia (tier B)" : "Payments without a reference code (tier B)"}
        </span>
        <select
          value={tierB}
          onChange={(e) => setTierB(e.target.value as "review_only" | "auto")}
          disabled={busy}
          style={{ ...inputStyle, width: 190, textAlign: "left" }}
        >
          <option value="review_only">{es ? "Siempre a revisión" : "Always review"}</option>
          <option value="auto">{es ? "Auto si la confianza es alta" : "Auto when confidence is high"}</option>
        </select>
      </div>

      <div style={{ marginTop: 12 }}>
        <GradientBtn full={false} size="md" onClick={save} disabled={busy}>
          {es ? "Guardar" : "Save"}
        </GradientBtn>
      </div>
    </Card>
  );
}
