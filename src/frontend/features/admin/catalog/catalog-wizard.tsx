"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Switch, toast } from "@/frontend/components/desktop";
import {
  Card,
  GradientBtn,
  GhostBtn,
  Stepper,
  Chip,
  Icon,
  Lex,
  type IconName,
} from "@/frontend/components/brand";
import { ViewHead, FieldLabel, TextInput, SelectInput } from "../shared/chrome";
import { I18nField, type I18nValue } from "../shared/i18n-field";

/* ───────────────────────── Types (editor tree VM) ───────────────────────── */

export interface WizardPlan {
  kind: "self" | "with_lawyer";
  offered: boolean;
  price_cents: number;
  currency: string;
  default_installments: number;
  default_downpayment_cents: number | null;
  is_active: boolean;
}

export interface WizardDoc {
  id: string;
  slug: string;
  label: I18nValue;
  help: I18nValue;
  category: I18nValue;
  is_required: boolean;
  is_per_party: boolean;
  party_roles: string[];
  ai_extract: boolean;
  is_active: boolean;
}

export interface WizardForm {
  id: string;
  slug: string;
  label: I18nValue;
  kind: "ai_letter" | "pdf_automation";
  filled_by: "client" | "staff" | "both";
  is_active: boolean;
}

export interface WizardPhase {
  id: string;
  slug: string;
  label: I18nValue;
  description: I18nValue;
  client_explainer: I18nValue;
  appointment_count: number;
  duration_minutes: number;
  kind: "video" | "phone" | "presencial";
  milestoneCount: number;
  docs: WizardDoc[];
  forms: WizardForm[];
}

export interface WizardService {
  id: string;
  slug: string;
  category: "migratorio" | "empresarial" | "familiar";
  label: I18nValue;
  description: I18nValue;
  icon: string;
  color: string;
  is_public: boolean;
  is_active: boolean;
}

export interface PublicationIssueVM {
  code: string;
  severity: "blocking" | "warning";
  detail: string;
}

export interface CatalogWizardProps {
  /** Existing service tree (edit mode) or null (create mode). */
  service: WizardService | null;
  plans: WizardPlan[];
  phases: WizardPhase[];
  slugLocked: boolean;
  messages: Record<string, string>;
  listHref: string;
  actions: {
    createService: (input: Record<string, unknown>) => Promise<ActionRes<{ id: string }>>;
    updateService: (id: string, patch: Record<string, unknown>) => Promise<ActionRes<unknown>>;
    upsertPlan: (input: Record<string, unknown>) => Promise<ActionRes<unknown>>;
    createPhase: (input: Record<string, unknown>) => Promise<ActionRes<{ id: string }>>;
    updatePhase: (id: string, patch: Record<string, unknown>) => Promise<ActionRes<unknown>>;
    deletePhase: (id: string) => Promise<ActionRes<unknown>>;
    upsertPolicy: (input: Record<string, unknown>) => Promise<ActionRes<unknown>>;
    activate: (id: string) => Promise<ActionRes<{ ok: boolean; issues: PublicationIssueVM[] }>>;
  };
}

type ActionRes<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

const STEP_IDS = ["basics", "plans", "phases", "docs", "forms", "publish"] as const;
type StepId = (typeof STEP_IDS)[number];

const COLOR_SWATCHES: { id: string; value: string }[] = [
  { id: "accent", value: "var(--accent)" },
  { id: "gold", value: "var(--gold-deep)" },
  { id: "green", value: "var(--green)" },
  { id: "red", value: "var(--red)" },
  { id: "navy", value: "var(--brand-navy)" },
  { id: "purple", value: "var(--purple)" },
];

const ICON_CHOICES: IconName[] = ["scale", "family", "shield", "briefcase", "doc", "globe", "card", "heart"];

/* ───────────────────────── Wizard ───────────────────────── */

export function CatalogWizard({
  service,
  plans: initialPlans,
  phases: initialPhases,
  slugLocked,
  messages: t,
  listHref,
  actions,
}: CatalogWizardProps) {
  const router = useRouter();
  const isEdit = service !== null;

  const [step, setStep] = React.useState<StepId>("basics");
  const [serviceId, setServiceId] = React.useState<string | null>(service?.id ?? null);
  const [saving, setSaving] = React.useState(false);

  // Step 1 state
  const [slug, setSlug] = React.useState(service?.slug ?? "");
  const [category, setCategory] = React.useState<WizardService["category"]>(service?.category ?? "migratorio");
  const [label, setLabel] = React.useState<I18nValue>(service?.label ?? { es: "", en: "" });
  const [description, setDescription] = React.useState<I18nValue>(service?.description ?? { es: "", en: "" });
  const [icon, setIcon] = React.useState<string>(service?.icon ?? "scale");
  const [color, setColor] = React.useState<string>(service?.color ?? "accent");
  const [isPublic, setIsPublic] = React.useState<boolean>(service?.is_public ?? true);

  // Step 2 plans
  const [plans, setPlans] = React.useState<WizardPlan[]>(
    initialPlans.length
      ? initialPlans
      : [
          { kind: "self", offered: false, price_cents: 0, currency: "USD", default_installments: 1, default_downpayment_cents: null, is_active: false },
          { kind: "with_lawyer", offered: false, price_cents: 0, currency: "USD", default_installments: 1, default_downpayment_cents: null, is_active: false },
        ],
  );

  // Step 3 phases
  const [phases, setPhases] = React.useState<WizardPhase[]>(initialPhases);
  const [activePhaseIdx, setActivePhaseIdx] = React.useState(0);

  // Step 6 publish
  const [pubIssues, setPubIssues] = React.useState<PublicationIssueVM[] | null>(null);
  const [published, setPublished] = React.useState(false);

  const stepIndex = STEP_IDS.indexOf(step);
  const stepperSteps = STEP_IDS.map((id, i) => ({
    id,
    label: t[`step${i + 1}`],
    state: (i < stepIndex ? "done" : i === stepIndex ? "current" : "upcoming") as "done" | "current" | "upcoming",
  }));

  /** Persists step 1 (create on first save, update afterwards). Returns the id. */
  async function saveBasics(): Promise<string | null> {
    setSaving(true);
    const payload = {
      slug,
      category,
      label_i18n: { es: label.es ?? "", en: label.en ?? "" },
      description_i18n: { es: description.es ?? "", en: description.en ?? "" },
      icon,
      color,
      is_public: isPublic,
    };
    let id = serviceId;
    if (!id) {
      const r = await actions.createService(payload);
      setSaving(false);
      if (!r.success || !r.data) {
        toast.error(r.error?.message ?? "Error");
        return null;
      }
      id = r.data.id;
      setServiceId(id);
    } else {
      const r = await actions.updateService(id, payload);
      setSaving(false);
      if (!r.success) {
        toast.error(r.error?.message ?? "Error");
        return null;
      }
    }
    toast.success(t.saved);
    return id;
  }

  async function next() {
    if (step === "basics") {
      if (!slug || !label.es) {
        toast.error(t.missingEn);
        return;
      }
      const id = await saveBasics();
      if (id) setStep("plans");
      return;
    }
    if (step === "plans") {
      await savePlans();
      setStep("phases");
      return;
    }
    const order: StepId[] = [...STEP_IDS];
    const i = order.indexOf(step);
    if (i < order.length - 1) setStep(order[i + 1]);
  }

  function back() {
    const i = STEP_IDS.indexOf(step);
    if (i > 0) setStep(STEP_IDS[i - 1]);
  }

  async function savePlans() {
    if (!serviceId) return;
    setSaving(true);
    for (const p of plans) {
      if (!p.offered) continue;
      await actions.upsertPlan({
        service_id: serviceId,
        kind: p.kind,
        price_cents: p.price_cents,
        currency: p.currency,
        requires_lawyer_validation: p.kind === "with_lawyer",
        default_installments: p.default_installments,
        default_downpayment_cents: p.default_downpayment_cents,
        is_active: p.is_active,
      });
    }
    setSaving(false);
  }

  async function publish() {
    if (!serviceId) return;
    setSaving(true);
    const r = await actions.activate(serviceId);
    setSaving(false);
    if (r.success && r.data) {
      if (r.data.ok) {
        setPublished(true);
        setPubIssues(r.data.issues.filter((i) => i.severity === "warning"));
        toast.success(t.celebrate.replace("{service}", label.es ?? slug));
        setTimeout(() => router.push(listHref), 1800);
      } else {
        setPubIssues(r.data.issues);
      }
    } else {
      toast.error(r.error?.message ?? "Error");
    }
  }

  const headTitle = isEdit ? label.es || slug : t.newService;

  return (
    <div className="anim-fade-in-up" style={{ padding: "28px clamp(18px,3vw,36px) 64px", maxWidth: 1100 }}>
      <button
        onClick={() => router.push(listHref)}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontWeight: 700, fontSize: 13, marginBottom: 12, padding: 0 }}
      >
        <Icon name="arrowL" size={16} color="var(--accent)" /> {t.backToList}
      </button>

      <ViewHead title={headTitle} sub={t.sub} />

      {isEdit && service?.is_active && (
        <div style={bannerStyle}>
          <Icon name="info" size={16} color="var(--gold-deep)" />
          {t.bannerProd}
        </div>
      )}

      {/* Stepper */}
      <div style={{ margin: "8px 0 26px" }}>
        <Stepper orientation="horizontal" steps={stepperSteps} />
      </div>

      <Card style={{ padding: 26 }}>
        {step === "basics" && (
          <BasicsStep
            {...{ slug, setSlug, slugLocked, category, setCategory, label, setLabel, description, setDescription, icon, setIcon, color, setColor, isPublic, setIsPublic, t }}
          />
        )}
        {step === "plans" && <PlansStep plans={plans} setPlans={setPlans} t={t} />}
        {step === "phases" && (
          <PhasesStep
            serviceId={serviceId}
            phases={phases}
            setPhases={setPhases}
            activeIdx={activePhaseIdx}
            setActiveIdx={setActivePhaseIdx}
            actions={actions}
            t={t}
          />
        )}
        {step === "docs" && <DocsStep phases={phases} t={t} />}
        {step === "forms" && <FormsStep t={t} />}
        {step === "publish" && <PublishStep issues={pubIssues} published={published} label={label.es ?? slug} t={t} onGoToStep={setStep} />}
      </Card>

      {/* Footer nav */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
        <GhostBtn size="md" full={false} disabled={stepIndex === 0} onClick={back}>
          {t.back}
        </GhostBtn>
        {step === "publish" ? (
          <GradientBtn size="lg" full={false} disabled={saving || published} icon="check" onClick={publish}>
            {t.activateService}
          </GradientBtn>
        ) : (
          <GradientBtn size="md" full={false} disabled={saving} onClick={next}>
            {t.next}
          </GradientBtn>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Step 1: Basics ───────────────────────── */

function BasicsStep(p: {
  slug: string;
  setSlug: (v: string) => void;
  slugLocked: boolean;
  category: WizardService["category"];
  setCategory: (v: WizardService["category"]) => void;
  label: I18nValue;
  setLabel: (v: I18nValue) => void;
  description: I18nValue;
  setDescription: (v: I18nValue) => void;
  icon: string;
  setIcon: (v: string) => void;
  color: string;
  setColor: (v: string) => void;
  isPublic: boolean;
  setIsPublic: (v: boolean) => void;
  t: Record<string, string>;
}) {
  const { t } = p;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 28 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <FieldLabel>{t.slug}</FieldLabel>
          <TextInput
            value={p.slug}
            disabled={p.slugLocked}
            title={p.slugLocked ? t.slugLocked : undefined}
            onChange={(e) => p.setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            placeholder="asilo-politico"
          />
          {p.slugLocked && <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--ink-3)" }}>{t.slugLocked}</p>}
        </div>

        <div>
          <FieldLabel>{t.category}</FieldLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {(["migratorio", "empresarial", "familiar"] as const).map((c) => {
              const on = p.category === c;
              return (
                <button
                  key={c}
                  onClick={() => p.setCategory(c)}
                  style={{
                    padding: "12px 8px",
                    borderRadius: 12,
                    cursor: "pointer",
                    border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`,
                    background: on ? "var(--accent-soft)" : "var(--panel-2, var(--card-alt))",
                    fontFamily: "var(--font-title)",
                    fontWeight: 800,
                    fontSize: 12.5,
                    color: on ? "var(--accent)" : "var(--ink-2)",
                  }}
                >
                  {c === "migratorio" ? t.catMigratorio : c === "empresarial" ? t.catEmpresarial : t.catFamiliar}
                </button>
              );
            })}
          </div>
        </div>

        <I18nField label={t.labelField} value={p.label} onChange={p.setLabel} />
        <I18nField label={t.descShort} value={p.description} onChange={p.setDescription} multiline />

        <div>
          <FieldLabel>{t.icon}</FieldLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {ICON_CHOICES.map((ic) => {
              const on = p.icon === ic;
              return (
                <button
                  key={ic}
                  onClick={() => p.setIcon(ic)}
                  aria-label={ic}
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    cursor: "pointer",
                    border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`,
                    background: on ? "var(--accent-soft)" : "var(--panel-2, var(--card-alt))",
                  }}
                >
                  <Icon name={ic} size={20} color={on ? "var(--accent)" : "var(--ink-2)"} />
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel>{t.color}</FieldLabel>
          <div style={{ display: "flex", gap: 10 }}>
            {COLOR_SWATCHES.map((sw) => {
              const on = p.color === sw.id;
              return (
                <button
                  key={sw.id}
                  onClick={() => p.setColor(sw.id)}
                  aria-label={sw.id}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 999,
                    cursor: "pointer",
                    background: sw.value,
                    border: on ? "3px solid var(--ink)" : "3px solid transparent",
                    boxShadow: "inset 0 0 0 1px rgba(11,27,51,0.1)",
                  }}
                />
              );
            })}
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <Switch checked={p.isPublic} aria-label={t.isPublic} onCheckedChange={p.setIsPublic} />
          <span style={{ fontSize: 13.5, color: "var(--ink)" }}>{t.isPublic}</span>
        </label>
      </div>

      {/* Mobile preview */}
      <div>
        <FieldLabel>{t.previewMobile}</FieldLabel>
        <PreviewCard label={p.label.es || p.slug} desc={p.description.es} icon={p.icon} color={p.color} t={t} category={p.category} />
      </div>
    </div>
  );
}

function PreviewCard({ label, desc, icon, color, category, t }: { label: string; desc?: string; icon: string; color: string; category: string; t: Record<string, string> }) {
  const c = COLOR_SWATCHES.find((s) => s.id === color)?.value ?? "var(--accent)";
  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid var(--line)",
        background: "var(--panel-2, var(--card-alt))",
        padding: 16,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <span style={{ display: "inline-grid", placeItems: "center", width: 48, height: 48, borderRadius: 14, background: `color-mix(in srgb, ${c} 14%, transparent)`, marginBottom: 12 }}>
        <Icon name={(icon as IconName) ?? "doc"} size={24} color={c} stroke={2.3} />
      </span>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)", marginBottom: 4 }}>
        {category === "migratorio" ? t.catMigratorio : category === "empresarial" ? t.catEmpresarial : t.catFamiliar}
      </div>
      <div style={{ fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 17, color: "var(--ink)" }}>{label || "—"}</div>
      {desc && <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.45, color: "var(--ink-2)" }}>{desc}</p>}
    </div>
  );
}

/* ───────────────────────── Step 2: Plans ───────────────────────── */

function PlansStep({ plans, setPlans, t }: { plans: WizardPlan[]; setPlans: React.Dispatch<React.SetStateAction<WizardPlan[]>>; t: Record<string, string> }) {
  function update(kind: "self" | "with_lawyer", patch: Partial<WizardPlan>) {
    setPlans((prev) => prev.map((p) => (p.kind === kind ? { ...p, ...patch } : p)));
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      {plans.map((p) => (
        <div key={p.kind} style={{ borderRadius: 16, border: `1.5px solid ${p.offered ? "var(--accent)" : "var(--line)"}`, padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 16, color: "var(--ink)" }}>
              {p.kind === "self" ? t.planSelf : t.planLawyer}
            </span>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-2)", cursor: "pointer" }}>
              <Switch checked={p.offered} aria-label={t.offerPlan} onCheckedChange={(v) => update(p.kind, { offered: v, is_active: v })} />
              {t.offerPlan}
            </label>
          </div>
          {p.kind === "with_lawyer" && (
            <div style={{ marginBottom: 12 }}>
              <Chip tone="gold" dot>{t.lawyerIncluded}</Chip>
              <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.4, color: "var(--ink-2)" }}>{t.lawyerNote}</p>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: p.offered ? 1 : 0.45, pointerEvents: p.offered ? "auto" : "none" }}>
            <div>
              <FieldLabel>{t.price}</FieldLabel>
              <TextInput
                type="number"
                value={p.price_cents ? String(p.price_cents / 100) : ""}
                onChange={(e) => update(p.kind, { price_cents: Math.round(Number(e.target.value) * 100) })}
                placeholder="3800"
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <FieldLabel>{t.installments}</FieldLabel>
                <TextInput type="number" value={String(p.default_installments)} onChange={(e) => update(p.kind, { default_installments: Math.max(1, Number(e.target.value)) })} />
              </div>
              <div>
                <FieldLabel>{t.downpayment}</FieldLabel>
                <TextInput
                  type="number"
                  value={p.default_downpayment_cents != null ? String(p.default_downpayment_cents / 100) : ""}
                  onChange={(e) => update(p.kind, { default_downpayment_cents: e.target.value ? Math.round(Number(e.target.value) * 100) : null })}
                />
              </div>
            </div>
          </div>
        </div>
      ))}
      <p style={{ gridColumn: "1 / -1", margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>{t.priceNote}</p>
    </div>
  );
}

/* ───────────────────────── Step 3: Phases ───────────────────────── */

function PhasesStep({
  serviceId,
  phases,
  setPhases,
  activeIdx,
  setActiveIdx,
  actions,
  t,
}: {
  serviceId: string | null;
  phases: WizardPhase[];
  setPhases: React.Dispatch<React.SetStateAction<WizardPhase[]>>;
  activeIdx: number;
  setActiveIdx: (i: number) => void;
  actions: CatalogWizardProps["actions"];
  t: Record<string, string>;
}) {
  const [savingPhase, setSavingPhase] = React.useState(false);

  async function addPhase() {
    if (!serviceId) {
      toast.error("—");
      return;
    }
    const slug = `fase-${phases.length + 1}`;
    setSavingPhase(true);
    const r = await actions.createPhase({ service_id: serviceId, slug, label_i18n: { es: "", en: "" } });
    setSavingPhase(false);
    if (r.success && r.data) {
      setPhases((prev) => [
        ...prev,
        { id: r.data!.id, slug, label: { es: "", en: "" }, description: { es: "", en: "" }, client_explainer: { es: "", en: "" }, appointment_count: 1, duration_minutes: 30, kind: "video", milestoneCount: 0, docs: [], forms: [] },
      ]);
      setActiveIdx(phases.length);
    } else toast.error(r.error?.message ?? "Error");
  }

  async function savePhase(idx: number) {
    const ph = phases[idx];
    setSavingPhase(true);
    await actions.updatePhase(ph.id, {
      label_i18n: { es: ph.label.es ?? "", en: ph.label.en ?? "" },
      description_i18n: { es: ph.description.es ?? "", en: ph.description.en ?? "" },
      client_explainer_i18n: { es: ph.client_explainer.es ?? "", en: ph.client_explainer.en ?? "" },
    });
    await actions.upsertPolicy({
      service_phase_id: ph.id,
      appointment_count: ph.appointment_count,
      duration_minutes: ph.duration_minutes,
      kind: ph.kind,
    });
    setSavingPhase(false);
    toast.success(t.saved);
  }

  async function removePhase(idx: number) {
    const ph = phases[idx];
    const r = await actions.deletePhase(ph.id);
    if (r.success) {
      setPhases((prev) => prev.filter((_, i) => i !== idx));
      setActiveIdx(Math.max(0, idx - 1));
    } else toast.error(r.error?.message ?? "Error");
  }

  function update(idx: number, patch: Partial<WizardPhase>) {
    setPhases((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  const active = phases[activeIdx];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 22 }}>
      {/* Phase list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {phases.map((ph, i) => {
          const on = i === activeIdx;
          return (
            <button
              key={ph.id}
              onClick={() => setActiveIdx(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 12,
                cursor: "pointer",
                border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`,
                background: on ? "var(--accent-soft)" : "var(--panel-2, var(--card-alt))",
              }}
            >
              <span style={{ width: 22, height: 22, borderRadius: 7, display: "grid", placeItems: "center", background: "var(--chip)", fontSize: 11, fontWeight: 800, color: "var(--ink-2)" }}>
                {i + 1}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {ph.label.es || ph.slug}
              </span>
            </button>
          );
        })}
        <button
          onClick={addPhase}
          disabled={savingPhase}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 12, cursor: "pointer", border: "1.5px dashed var(--line)", background: "transparent", color: "var(--accent)", fontWeight: 700, fontSize: 13 }}
        >
          <Icon name="plus" size={15} color="var(--accent)" /> {t.addPhase}
        </button>
      </div>

      {/* Phase editor */}
      {active ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <I18nField label={t.phaseLabel} value={active.label} onChange={(v) => update(activeIdx, { label: v })} />
          <I18nField label={t.clientExplainer} value={active.client_explainer} onChange={(v) => update(activeIdx, { client_explainer: v })} multiline />

          <div>
            <FieldLabel>{t.apptPolicy}</FieldLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: 10 }}>
              <div>
                <span style={subLabel}>{t.apptCount}</span>
                <TextInput type="number" value={String(active.appointment_count)} onChange={(e) => update(activeIdx, { appointment_count: Math.max(1, Number(e.target.value)) })} />
              </div>
              <div>
                <span style={subLabel}>{t.apptDuration}</span>
                <TextInput type="number" value={String(active.duration_minutes)} onChange={(e) => update(activeIdx, { duration_minutes: Number(e.target.value) })} />
              </div>
              <div>
                <span style={subLabel}>{t.apptKind}</span>
                <SelectInput value={active.kind} onChange={(e) => update(activeIdx, { kind: e.target.value as WizardPhase["kind"] })}>
                  <option value="video">{t.apptVideo}</option>
                  <option value="phone">{t.apptPhone}</option>
                  <option value="presencial">{t.apptPresencial}</option>
                </SelectInput>
              </div>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-3)" }}>{t.apptNote}</p>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
            <GhostBtn size="md" full={false} color="var(--red)" onClick={() => removePhase(activeIdx)}>
              {t.delete}
            </GhostBtn>
            <GradientBtn size="md" full={false} disabled={savingPhase} icon="check" onClick={() => savePhase(activeIdx)}>
              {t.save}
            </GradientBtn>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", placeItems: "center", minHeight: 200, color: "var(--ink-3)", fontSize: 14 }}>
          {t.addPhase}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Step 4: Documents ───────────────────────── */

function DocsStep({ phases, t }: { phases: WizardPhase[]; t: Record<string, string> }) {
  const [phaseIdx, setPhaseIdx] = React.useState(0);
  const phase = phases[phaseIdx];

  return (
    <div>
      <div style={{ marginBottom: 16, maxWidth: 320 }}>
        <FieldLabel>{t.selectPhase}</FieldLabel>
        <SelectInput value={String(phaseIdx)} onChange={(e) => setPhaseIdx(Number(e.target.value))}>
          {phases.map((ph, i) => (
            <option key={ph.id} value={i}>
              {ph.label.es || ph.slug}
            </option>
          ))}
        </SelectInput>
      </div>

      {!phase ? (
        <p style={{ color: "var(--ink-3)" }}>{t.addPhase}</p>
      ) : (
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={docHead}>{t.docDocument}</th>
                <th style={docHead}>{t.docCategory}</th>
                <th style={{ ...docHead, textAlign: "center" }}>{t.docRequired}</th>
                <th style={{ ...docHead, textAlign: "center" }}>{t.docPerParty}</th>
                <th style={{ ...docHead, textAlign: "center" }}>{t.docAiExtract}</th>
              </tr>
            </thead>
            <tbody>
              {phase.docs.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...docCell, textAlign: "center", color: "var(--ink-3)", padding: "26px" }}>
                    {t.emptyTitle ?? "—"}
                  </td>
                </tr>
              ) : (
                phase.docs.map((d) => (
                  <tr key={d.id}>
                    <td style={docCell}>
                      <div style={{ fontWeight: 700, color: "var(--ink)" }}>{d.label.es || d.slug}</div>
                      <code style={{ fontSize: 11, color: "var(--ink-3)" }}>{d.slug}</code>
                    </td>
                    <td style={docCell}>{d.category.es || "—"}</td>
                    <td style={{ ...docCell, textAlign: "center" }}>{d.is_required ? <Icon name="check" size={16} color="var(--green)" /> : "—"}</td>
                    <td style={{ ...docCell, textAlign: "center" }}>{d.is_per_party ? <Icon name="check" size={16} color="var(--green)" /> : "—"}</td>
                    <td style={{ ...docCell, textAlign: "center" }}>{d.ai_extract ? <Chip tone="gold" dot>{t.docAiExtract}</Chip> : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Step 5: Forms (F4 stub) ───────────────────────── */

function FormsStep({ t }: { t: Record<string, string> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 8, padding: "40px 24px" }}>
      <Lex size={120} mood="señala" />
      <h3 style={{ margin: "6px 0 0", fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 17, color: "var(--ink)" }}>{t.formStub}</h3>
      <p style={{ margin: 0, maxWidth: 420, fontSize: 14, lineHeight: 1.5, color: "var(--ink-2)" }}>{t.formStubSub}</p>
    </div>
  );
}

/* ───────────────────────── Step 6: Publish ───────────────────────── */

function PublishStep({
  issues,
  published,
  label,
  t,
  onGoToStep,
}: {
  issues: PublicationIssueVM[] | null;
  published: boolean;
  label: string;
  t: Record<string, string>;
  onGoToStep: (s: StepId) => void;
}) {
  const blocking = (issues ?? []).filter((i) => i.severity === "blocking");
  const warnings = (issues ?? []).filter((i) => i.severity === "warning");

  if (published) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, padding: "36px 24px" }}>
        <Lex size={130} mood="celebra" />
        <p style={{ margin: 0, maxWidth: 460, fontSize: 15, lineHeight: 1.5, color: "var(--ink)", fontWeight: 600 }}>
          {t.celebrate.replace("{service}", label)}
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ margin: "0 0 16px", fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 16, color: "var(--ink)" }}>
        {t.publishTitle}
      </h3>

      {issues === null ? (
        <p style={{ fontSize: 14, color: "var(--ink-2)" }}>{t.publishReady}</p>
      ) : blocking.length === 0 && warnings.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--green)", fontWeight: 700 }}>
          <Icon name="check" size={18} color="var(--green)" /> {t.publishReady}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[...blocking, ...warnings].map((iss, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 10,
                background: iss.severity === "blocking" ? "var(--red-soft)" : "var(--gold-soft)",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 999, marginTop: 5, background: iss.severity === "blocking" ? "var(--red)" : "var(--gold-deep)", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: iss.severity === "blocking" ? "var(--red)" : "var(--gold-deep)" }}>
                  {iss.severity === "blocking" ? t.issueBlocking : t.issueWarning}
                </span>
                <p style={{ margin: "2px 0 0", fontSize: 13.5, color: "var(--ink)" }}>{iss.detail}</p>
                <code style={{ fontSize: 11, color: "var(--ink-3)" }}>{iss.code}</code>
              </div>
              <button onClick={() => onGoToStep(stepForIssue(iss.code))} style={fixBtn}>
                {t.menuEdit}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function stepForIssue(code: string): StepId {
  if (code.includes("PLAN")) return "plans";
  if (code.includes("PHASE") || code.includes("EXPLAINER")) return "phases";
  return "basics";
}

/* ───────────────────────── styles ───────────────────────── */

const bannerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 16px",
  borderRadius: 12,
  background: "var(--gold-soft)",
  border: "1px solid var(--gold-deep)",
  color: "var(--gold-deep)",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 18,
};

const subLabel: React.CSSProperties = {
  display: "block",
  fontSize: 11.5,
  fontWeight: 700,
  color: "var(--ink-3)",
  marginBottom: 4,
};

const fixBtn: React.CSSProperties = {
  height: 30,
  padding: "0 12px",
  borderRadius: 999,
  border: "1px solid var(--line)",
  background: "var(--panel, var(--card))",
  color: "var(--accent)",
  fontWeight: 800,
  fontSize: 12.5,
  cursor: "pointer",
  flexShrink: 0,
};

const docHead: React.CSSProperties = {
  textAlign: "left",
  padding: "9px 14px",
  background: "var(--panel-2, var(--card-alt))",
  fontFamily: "var(--font-title)",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--ink-3)",
  borderBottom: "1px solid var(--line)",
};

const docCell: React.CSSProperties = {
  padding: "11px 14px",
  fontSize: 13,
  color: "var(--ink)",
  borderBottom: "1px solid var(--line-2, var(--line))",
};
