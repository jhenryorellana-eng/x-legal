"use client";

/**
 * SeguimientoView — `/finanzas/seguimiento` (Andrium / admin · fidelización).
 *
 * Lifecycle "después": win-back, promotions/coupons, referrals, reviews/NPS.
 * Boundaries: no @/backend imports. Bilingual via inline tt() (no i18n keys).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, GradientBtn, GhostBtn, Icon, Chip } from "@/frontend/components/brand";
import { Modal, toast } from "@/frontend/components/desktop";

export interface PromotionVM {
  id: string;
  code: string;
  description: string | null;
  kind: "percent" | "amount";
  value: number;
  currency: string;
  validUntil: string | null;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
}

export interface ReferralVM {
  id: string;
  code: string;
  referrerName: string | null;
  status: "pending" | "converted" | "rewarded" | "void";
  convertedAt: string | null;
  rewardedAt: string | null;
  createdAt: string;
}

export interface ReviewVM {
  id: string;
  clientName: string | null;
  rating: number | null;
  nps: number | null;
  body: string | null;
  submittedAt: string | null;
  requestedAt: string | null;
}

export interface SeguimientoVM {
  promotions: PromotionVM[];
  referrals: { items: ReferralVM[]; stats: { total: number; converted: number; rewarded: number } };
  reviews: { items: ReviewVM[]; stats: { count: number; avgRating: number; nps: number } };
  locale: "es" | "en";
}

export interface SeguimientoActions {
  createPromotion: (input: {
    code: string;
    description?: string | null;
    kind: "percent" | "amount";
    value: number;
    validUntil?: string | null;
    maxUses?: number | null;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  setPromotionActive: (id: string, isActive: boolean) => Promise<{ ok: boolean; error?: { code: string } }>;
  deletePromotion: (id: string) => Promise<{ ok: boolean; error?: { code: string } }>;
  markReferralRewarded: (id: string) => Promise<{ ok: boolean; error?: { code: string } }>;
}

function tt(locale: "es" | "en", es: string, en: string) {
  return locale === "es" ? es : en;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-US", { day: "numeric", month: "short", year: "numeric" });
}

const sectionTitle: React.CSSProperties = { fontSize: 16, fontWeight: 800, color: "var(--ink)", margin: "0 0 4px", fontFamily: "var(--font-title)" };
const sectionSub: React.CSSProperties = { fontSize: 13, color: "var(--ink-3)", margin: "0 0 14px" };
const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 800, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em" };
const td: React.CSSProperties = { padding: "10px", fontSize: 13, color: "var(--ink)", borderTop: "1px solid var(--line)" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)", fontSize: 14, outline: "none" };
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--ink-2)", marginBottom: 6, display: "block" };

function Stat({ value, label, color }: { value: React.ReactNode; label: string; color?: string }) {
  return (
    <div style={{ textAlign: "center", flex: 1 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: color ?? "var(--ink)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create promotion modal
// ---------------------------------------------------------------------------

function PromoModal({
  open, onOpenChange, locale, busy, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locale: "es" | "en";
  busy: boolean;
  onConfirm: (input: { code: string; description: string | null; kind: "percent" | "amount"; value: number; validUntil: string | null; maxUses: number | null }) => void;
}) {
  const [code, setCode] = React.useState("");
  const [kind, setKind] = React.useState<"percent" | "amount">("percent");
  const [value, setValue] = React.useState("10");
  const [validUntil, setValidUntil] = React.useState("");
  const [maxUses, setMaxUses] = React.useState("");
  const [description, setDescription] = React.useState("");

  function submit() {
    const numValue = kind === "amount" ? Math.round(parseFloat(value) * 100) : parseInt(value, 10);
    if (!code.trim() || !Number.isFinite(numValue) || numValue <= 0) {
      toast.error(tt(locale, "Completa el código y un valor válido", "Fill in the code and a valid value"));
      return;
    }
    onConfirm({
      code: code.trim(),
      description: description.trim() || null,
      kind,
      value: numValue,
      validUntil: validUntil ? new Date(validUntil).toISOString() : null,
      maxUses: maxUses ? parseInt(maxUses, 10) : null,
    });
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={tt(locale, "Nueva promoción", "New promotion")}
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <GhostBtn size="md" full={false} onClick={() => onOpenChange(false)} disabled={busy}>{tt(locale, "Cancelar", "Cancel")}</GhostBtn>
          <GradientBtn size="md" full={false} onClick={submit} disabled={busy}>{busy ? "…" : tt(locale, "Crear", "Create")}</GradientBtn>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={labelStyle}>{tt(locale, "Código del cupón", "Coupon code")}</label>
          <input style={inputStyle} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="VERANO2026" maxLength={40} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{tt(locale, "Tipo", "Type")}</label>
            <select style={inputStyle} value={kind} onChange={(e) => setKind(e.target.value as "percent" | "amount")}>
              <option value="percent">{tt(locale, "Porcentaje (%)", "Percent (%)")}</option>
              <option value="amount">{tt(locale, "Monto ($)", "Amount ($)")}</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{kind === "percent" ? tt(locale, "Porcentaje", "Percent") : tt(locale, "Monto (USD)", "Amount (USD)")}</label>
            <input style={inputStyle} type="number" value={value} onChange={(e) => setValue(e.target.value)} min={1} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{tt(locale, "Vence (opcional)", "Expires (optional)")}</label>
            <input style={inputStyle} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{tt(locale, "Usos máx. (opcional)", "Max uses (optional)")}</label>
            <input style={inputStyle} type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} min={1} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>{tt(locale, "Descripción (opcional)", "Description (optional)")}</label>
          <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function SeguimientoView({ vm, actions }: { vm: SeguimientoVM; actions: SeguimientoActions }) {
  const router = useRouter();
  const locale = vm.locale;
  const [promoOpen, setPromoOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function createPromo(input: Parameters<SeguimientoActions["createPromotion"]>[0]) {
    setBusy(true);
    const res = await actions.createPromotion(input);
    setBusy(false);
    if (res.ok) {
      toast.success(tt(locale, "Promoción creada", "Promotion created"));
      setPromoOpen(false);
      router.refresh();
    } else {
      toast.error(`${tt(locale, "No se pudo crear", "Could not create")} [${res.error?.code ?? "?"}]`);
    }
  }
  async function togglePromo(id: string, next: boolean) {
    const res = await actions.setPromotionActive(id, next);
    if (res.ok) router.refresh();
    else toast.error(tt(locale, "No se pudo actualizar", "Could not update"));
  }
  async function removePromo(id: string) {
    if (!window.confirm(tt(locale, "¿Eliminar esta promoción?", "Delete this promotion?"))) return;
    const res = await actions.deletePromotion(id);
    if (res.ok) { toast.success(tt(locale, "Eliminada", "Deleted")); router.refresh(); }
    else toast.error(tt(locale, "No se pudo eliminar", "Could not delete"));
  }
  async function rewardReferral(id: string) {
    const res = await actions.markReferralRewarded(id);
    if (res.ok) { toast.success(tt(locale, "Referido recompensado", "Referral rewarded")); router.refresh(); }
    else toast.error(tt(locale, "No se pudo actualizar", "Could not update"));
  }

  const referralStatusChip = (s: ReferralVM["status"]) => {
    const map = {
      pending: { tone: "blue" as const, es: "Pendiente", en: "Pending" },
      converted: { tone: "gold" as const, es: "Convertido", en: "Converted" },
      rewarded: { tone: "green" as const, es: "Recompensado", en: "Rewarded" },
      void: { tone: "blue" as const, es: "Anulado", en: "Void" },
    };
    const c = map[s];
    return <Chip tone={c.tone}>{tt(locale, c.es, c.en)}</Chip>;
  };

  return (
    <div style={{ padding: "32px 36px", maxWidth: 1180 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--ink)", margin: "0 0 6px", fontFamily: "var(--font-title)" }}>
        {tt(locale, "Seguimiento y fidelización", "Follow-up & loyalty")}
      </h1>
      <p style={{ fontSize: 14, color: "var(--ink-2)", margin: "0 0 24px" }}>
        {tt(locale, "Acompaña al cliente antes, durante y después de su proceso.", "Stay with the client before, during and after their journey.")}
      </p>

      {/* Lifecycle strip + win-back */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {([
            ["before", tt(locale, "Antes", "Before"), tt(locale, "Prospectos y anuncios (ventas).", "Prospects & ads (sales)."), "var(--accent)"],
            ["during", tt(locale, "Durante", "During"), tt(locale, "Avisos de progreso, comunidad y correos.", "Progress alerts, community & emails."), "var(--gold-deep)"],
            ["after", tt(locale, "Después", "After"), tt(locale, "Win-back, promociones, referidos y reseñas.", "Win-back, promos, referrals & reviews."), "var(--green)"],
          ] as const).map(([k, title, sub, color]) => (
            <div key={k} style={{ padding: "12px 14px", borderRadius: 12, background: "var(--hover, rgba(47,107,255,0.04))", borderLeft: `3px solid ${color}` }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>{title}</div>
              <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--ink-2)", flex: 1 }}>
            {tt(locale, "Reactiva a quienes ya terminaron su trámite con una campaña de re-enganche.", "Re-engage clients who already finished their case with a win-back campaign.")}
          </span>
          <GradientBtn size="md" full={false} onClick={() => router.push("/finanzas/campanas")} style={{ height: 40, padding: "0 18px", borderRadius: 999 }}>
            <Icon name="megaphone" size={15} color="#fff" /> {tt(locale, "Crear campaña win-back", "Create win-back campaign")}
          </GradientBtn>
        </div>
      </Card>

      {/* Promotions */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <p style={sectionTitle}>{tt(locale, "Promociones y cupones", "Promotions & coupons")}</p>
            <p style={sectionSub}>{tt(locale, "Descuentos para que el cliente vuelva a contratar.", "Discounts to bring clients back.")}</p>
          </div>
          <GradientBtn size="md" full={false} onClick={() => setPromoOpen(true)} style={{ height: 38, padding: "0 16px", borderRadius: 999 }}>
            + {tt(locale, "Nueva", "New")}
          </GradientBtn>
        </div>
        {vm.promotions.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>{tt(locale, "Aún no hay promociones.", "No promotions yet.")}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>{tt(locale, "Código", "Code")}</th>
                <th style={th}>{tt(locale, "Descuento", "Discount")}</th>
                <th style={th}>{tt(locale, "Usos", "Uses")}</th>
                <th style={th}>{tt(locale, "Vence", "Expires")}</th>
                <th style={th}>{tt(locale, "Activa", "Active")}</th>
                <th style={th}></th>
              </tr></thead>
              <tbody>
                {vm.promotions.map((p) => (
                  <tr key={p.id}>
                    <td style={{ ...td, fontWeight: 800, fontFamily: "var(--font-mono, monospace)" }}>{p.code}</td>
                    <td style={td}>{p.kind === "percent" ? `${p.value}%` : `$${(p.value / 100).toFixed(2)}`}</td>
                    <td style={td}>{p.usedCount}{p.maxUses != null ? ` / ${p.maxUses}` : ""}</td>
                    <td style={td}>{fmtDate(p.validUntil)}</td>
                    <td style={td}>
                      <button type="button" onClick={() => togglePromo(p.id, !p.isActive)}
                        style={{ border: "none", cursor: "pointer", background: "transparent", padding: 0 }}>
                        <Chip tone={p.isActive ? "green" : "blue"}>{p.isActive ? tt(locale, "Sí", "Yes") : tt(locale, "No", "No")}</Chip>
                      </button>
                    </td>
                    <td style={td}>
                      <button type="button" aria-label={tt(locale, "Eliminar", "Delete")} onClick={() => removePromo(p.id)}
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--red)", fontWeight: 800, fontSize: 16 }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Referrals */}
      <Card style={{ marginBottom: 20 }}>
        <p style={sectionTitle}>{tt(locale, "Referidos", "Referrals")}</p>
        <p style={sectionSub}>{tt(locale, "Tus clientes traen nuevos clientes.", "Your clients bring new clients.")}</p>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <Stat value={vm.referrals.stats.total} label={tt(locale, "Total", "Total")} />
          <Stat value={vm.referrals.stats.converted} label={tt(locale, "Convertidos", "Converted")} color="var(--gold-deep)" />
          <Stat value={vm.referrals.stats.rewarded} label={tt(locale, "Recompensados", "Rewarded")} color="var(--green)" />
        </div>
        {vm.referrals.items.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>{tt(locale, "Aún no hay referidos.", "No referrals yet.")}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>{tt(locale, "Código", "Code")}</th>
                <th style={th}>{tt(locale, "Refiere", "Referrer")}</th>
                <th style={th}>{tt(locale, "Estado", "Status")}</th>
                <th style={th}>{tt(locale, "Fecha", "Date")}</th>
                <th style={th}></th>
              </tr></thead>
              <tbody>
                {vm.referrals.items.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontFamily: "var(--font-mono, monospace)" }}>{r.code}</td>
                    <td style={td}>{r.referrerName ?? "—"}</td>
                    <td style={td}>{referralStatusChip(r.status)}</td>
                    <td style={td}>{fmtDate(r.createdAt)}</td>
                    <td style={td}>
                      {r.status === "converted" && (
                        <GhostBtn size="md" full={false} onClick={() => rewardReferral(r.id)} style={{ height: 30, padding: "0 12px" }}>
                          {tt(locale, "Recompensar", "Reward")}
                        </GhostBtn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Reviews */}
      <Card>
        <p style={sectionTitle}>{tt(locale, "Reseñas y satisfacción", "Reviews & satisfaction")}</p>
        <p style={sectionSub}>{tt(locale, "Mide la experiencia y recoge testimonios.", "Measure the experience and collect testimonials.")}</p>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <Stat value={vm.reviews.stats.count} label={tt(locale, "Respondidas", "Submitted")} />
          <Stat value={vm.reviews.stats.avgRating > 0 ? `${vm.reviews.stats.avgRating} ★` : "—"} label={tt(locale, "Promedio", "Average")} color="var(--gold-deep)" />
          <Stat value={vm.reviews.stats.count > 0 ? vm.reviews.stats.nps : "—"} label="NPS" color={vm.reviews.stats.nps >= 0 ? "var(--green)" : "var(--red)"} />
        </div>
        {vm.reviews.items.filter((r) => r.submittedAt).length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>{tt(locale, "Aún no hay reseñas respondidas.", "No submitted reviews yet.")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {vm.reviews.items.filter((r) => r.submittedAt).map((r) => (
              <div key={r.id} style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 800, fontSize: 14, color: "var(--ink)" }}>{r.clientName ?? tt(locale, "Cliente", "Client")}</span>
                  {r.rating != null && <span style={{ color: "var(--gold-deep)", fontWeight: 700 }}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>}
                </div>
                {r.body && <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>{r.body}</p>}
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>{fmtDate(r.submittedAt)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <PromoModal open={promoOpen} onOpenChange={setPromoOpen} locale={locale} busy={busy} onConfirm={createPromo} />
    </div>
  );
}
