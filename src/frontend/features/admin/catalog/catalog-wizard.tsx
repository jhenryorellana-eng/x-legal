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
import { slugify } from "@/shared/strings";
import { ExtractionSchemaModal, schemaFieldCount } from "./extraction-schema-modal";
import {
  PARTY_ROLE_KEYS,
  DEFAULT_PARTY_ROLE_LABELS,
  PRINCIPAL_ROLE_KEY,
  type PartyRoleKey,
} from "@/shared/constants/party-roles";

/* ───────────────────────── Types (editor tree VM) ───────────────────────── */

export interface WizardPlan {
  kind: "self" | "with_lawyer";
  offered: boolean;
  price_cents: number;
  currency: string;
  default_installments: number;
  default_downpayment_cents: number | null;
  default_frequency: "weekly" | "monthly";
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
  /** JSON Schema (Gemini-portable subset) of the fields the AI extracts. null = not configured. */
  extraction_schema: Record<string, unknown> | null;
  accepted_format: "pdf" | "png";
  /** Admin-configured: client may upload more than one file for this requirement. */
  allow_multiple: boolean;
  is_active: boolean;
}

export interface WizardPartyRole {
  id: string;
  role_key: string;
  label: I18nValue;
  cardinality: "single" | "multiple";
  is_required: boolean;
  include_in_contract: boolean;
  position: number;
}

export interface WizardForm {
  id: string;
  slug: string;
  label: I18nValue;
  kind: "ai_letter" | "pdf_automation";
  filled_by: "client" | "staff" | "both";
  is_active: boolean;
  position: number;
  /** Ola 2 gate: when false, this form is exempt from the "documents 100%" gate. */
  requires_documents_complete: boolean;
  /** Published version number (pdf_automation only); null = no published version yet. */
  published_version: number | null;
}

export interface WizardObjective {
  id: string;
  text: I18nValue;
}

export interface WizardScheduleItem {
  sequence_number: number;
  duration_minutes: number;
  kind: "video" | "phone" | "presencial";
  week_offset: number;
  /** Admin-defined objectives shown in the cita detail + marked on complete. */
  objectives: WizardObjective[];
}

/** A "Mi proceso" milestone (hito) edited in the phase step. */
export interface WizardMilestone {
  /** Real id when loaded from the DB; absent/temporary for newly added rows. */
  id: string;
  slug: string;
  label: I18nValue;
  glossary: I18nValue;
  icon: string;
  /** Approximate week (drives the "Semana N" label + ordering vs citas), or null. */
  week_offset: number | null;
}

export interface WizardPhase {
  id: string;
  slug: string;
  label: I18nValue;
  description: I18nValue;
  client_explainer: I18nValue;
  /** Legacy uniform policy (kept as fallback + kind source; derived from schedule on save). */
  appointment_count: number;
  duration_minutes: number;
  kind: "video" | "phone" | "presencial";
  /** Per-cita cronograma: each cita's own duration + week offset. */
  schedule: WizardScheduleItem[];
  /** Trailing "trámite" weeks this phase contributes to the cronograma. */
  processing_weeks: number;
  /** Client-visible milestones ("Mi proceso") for this phase. */
  milestones: WizardMilestone[];
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
  /** Per-service contract content (DOC-51). scope is newline-joined per locale for editing. */
  contract_object: I18nValue;
  contract_scope: I18nValue;
  contract_special: I18nValue;
  /** Per-service certified-translation signing (migration 0057). */
  translation_signer_name: string | null;
  translation_signature_path: string | null;
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
  partyRoles: WizardPartyRole[];
  phases: WizardPhase[];
  slugLocked: boolean;
  messages: Record<string, string>;
  listHref: string;
  actions: {
    createService: (input: Record<string, unknown>) => Promise<ActionRes<{ id: string }>>;
    updateService: (id: string, patch: Record<string, unknown>) => Promise<ActionRes<unknown>>;
    uploadSignatureUrl: (
      serviceId: string,
      filename: string,
    ) => Promise<ActionRes<{ signedUrl: string; path: string }>>;
    getSignaturePreviewUrl: (serviceId: string) => Promise<ActionRes<string | null>>;
    upsertPlan: (input: Record<string, unknown>) => Promise<ActionRes<unknown>>;
    createPhase: (input: Record<string, unknown>) => Promise<ActionRes<{ id: string }>>;
    updatePhase: (id: string, patch: Record<string, unknown>) => Promise<ActionRes<unknown>>;
    deletePhase: (id: string) => Promise<ActionRes<unknown>>;
    upsertPolicy: (input: Record<string, unknown>) => Promise<ActionRes<unknown>>;
    upsertSchedule: (input: Record<string, unknown>) => Promise<ActionRes<unknown>>;
    upsertMilestones: (
      servicePhaseId: string,
      items: Array<Record<string, unknown>>,
    ) => Promise<ActionRes<unknown>>;
    createRequiredDoc: (input: Record<string, unknown>) => Promise<ActionRes<{ id: string }>>;
    updateRequiredDoc: (id: string, patch: Record<string, unknown>) => Promise<ActionRes<{ id: string }>>;
    createPartyRole: (input: Record<string, unknown>) => Promise<ActionRes<{ id: string }>>;
    updatePartyRole: (id: string, patch: Record<string, unknown>) => Promise<ActionRes<unknown>>;
    deletePartyRole: (id: string) => Promise<ActionRes<unknown>>;
    createForm: (input: Record<string, unknown>) => Promise<ActionRes<{ id: string }>>;
    updateForm: (id: string, patch: Record<string, unknown>) => Promise<ActionRes<unknown>>;
    activate: (id: string) => Promise<ActionRes<{ ok: boolean; issues: PublicationIssueVM[] }>>;
    proposeExtractionSchema: (input: {
      service_phase_id: string;
      label: string;
      help?: string;
    }) => Promise<ActionRes<object>>;
    validateExtractionSchema: (
      schema: unknown,
    ) => Promise<ActionRes<{ valid: boolean; reason?: string }>>;
  };
}

type ActionRes<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

/** Stable, valid slug for a milestone: keep an existing one, else derive from the
 *  ES label (kebab-case, accent-stripped), falling back to "hito-N". */
function milestoneSlug(m: WizardMilestone, i: number): string {
  if (m.slug && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.slug)) return m.slug;
  return slugify(m.label.es || m.label.en || "") || `hito-${i + 1}`;
}

const STEP_IDS = ["basics", "plans", "parties", "phases", "docs", "forms", "translation", "contract", "publish"] as const;
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
  partyRoles: initialPartyRoles,
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
          { kind: "self", offered: false, price_cents: 0, currency: "USD", default_installments: 1, default_downpayment_cents: null, default_frequency: "monthly", is_active: false },
          { kind: "with_lawyer", offered: false, price_cents: 0, currency: "USD", default_installments: 1, default_downpayment_cents: null, default_frequency: "monthly", is_active: false },
        ],
  );

  // Step 3 parties (additional case roles)
  const [partyRoles, setPartyRoles] = React.useState<WizardPartyRole[]>(initialPartyRoles);

  // Step 4 phases
  const [phases, setPhases] = React.useState<WizardPhase[]>(initialPhases);
  const [activePhaseIdx, setActivePhaseIdx] = React.useState(0);

  // Step "contract" — per-service contract content
  const [contractObject, setContractObject] = React.useState<I18nValue>(
    service?.contract_object ?? { es: "", en: "" },
  );
  const [contractScope, setContractScope] = React.useState<I18nValue>(
    service?.contract_scope ?? { es: "", en: "" },
  );
  const [contractSpecial, setContractSpecial] = React.useState<I18nValue>(
    service?.contract_special ?? { es: "", en: "" },
  );

  // Step "translation" — per-service translator signature config
  const [signerName, setSignerName] = React.useState<string>(service?.translation_signer_name ?? "");
  const [sigPath, setSigPath] = React.useState<string | null>(service?.translation_signature_path ?? null);

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
      setStep("parties");
      return;
    }
    if (step === "translation") {
      const ok = await saveTranslation();
      if (ok) setStep("contract");
      return;
    }
    if (step === "contract") {
      const ok = await saveContract();
      if (ok) setStep("publish");
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
        default_frequency: p.default_frequency,
        is_active: p.is_active,
      });
    }
    setSaving(false);
  }

  /** Persists the per-service contract content (object/scope/special). */
  async function saveContract(): Promise<boolean> {
    if (!serviceId) return false;
    setSaving(true);
    const toList = (s?: string) =>
      (s ?? "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
    const r = await actions.updateService(serviceId, {
      contract_object_i18n: { es: contractObject.es ?? "", en: contractObject.en ?? "" },
      contract_scope_i18n: { es: toList(contractScope.es), en: toList(contractScope.en) },
      contract_special_clause_i18n: { es: contractSpecial.es ?? "", en: contractSpecial.en ?? "" },
    });
    setSaving(false);
    if (!r.success) {
      toast.error(r.error?.message ?? "Error");
      return false;
    }
    toast.success(t.saved);
    return true;
  }

  /** Persists the per-service translator signature config (name + image path). */
  async function saveTranslation(): Promise<boolean> {
    if (!serviceId) return true; // create-mode shell: nothing to persist yet
    setSaving(true);
    const r = await actions.updateService(serviceId, {
      translation_signer_name: signerName.trim() || null,
      translation_signature_path: sigPath,
    });
    setSaving(false);
    if (!r.success) {
      toast.error(r.error?.message ?? "Error");
      return false;
    }
    toast.success(t.saved);
    return true;
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
        {step === "parties" && (
          <PartiesStep
            serviceId={serviceId}
            partyRoles={partyRoles}
            setPartyRoles={setPartyRoles}
            actions={actions}
            t={t}
          />
        )}
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
        {step === "docs" && (
          <DocsStep phases={phases} setPhases={setPhases} partyRoles={partyRoles} actions={actions} t={t} />
        )}
        {step === "forms" && <FormsStep t={t} serviceId={serviceId} phases={phases} setPhases={setPhases} actions={actions} />}
        {step === "translation" && (
          <TranslationStep
            serviceId={serviceId}
            signerName={signerName}
            setSignerName={setSignerName}
            sigPath={sigPath}
            setSigPath={setSigPath}
            actions={actions}
            t={t}
          />
        )}
        {step === "contract" && (
          <ContractStep
            object={contractObject}
            setObject={setContractObject}
            scope={contractScope}
            setScope={setContractScope}
            special={contractSpecial}
            setSpecial={setContractSpecial}
            t={t}
          />
        )}
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

/* ───────────────────────── Step: Translation signature ───────────────────────── */

function TranslationStep({
  serviceId,
  signerName,
  setSignerName,
  sigPath,
  setSigPath,
  actions,
  t,
}: {
  serviceId: string | null;
  signerName: string;
  setSignerName: (v: string) => void;
  sigPath: string | null;
  setSigPath: (v: string | null) => void;
  actions: CatalogWizardProps["actions"];
  t: Record<string, string>;
}) {
  const [preview, setPreview] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Load the STORED signature image preview once (edit mode).
  React.useEffect(() => {
    let alive = true;
    if (serviceId && sigPath) {
      void actions.getSignaturePreviewUrl(serviceId).then((r) => {
        if (alive && r.success && r.data) setPreview(r.data);
      });
    }
    return () => {
      alive = false;
    };
    // mount-once: shows the already-saved signature when editing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onPick(file: File) {
    if (!serviceId) {
      toast.error(t.translationSaveServiceFirst);
      return;
    }
    if (!/\.(png|jpe?g)$/i.test(file.name)) {
      toast.error(t.translationImageType);
      return;
    }
    setUploading(true);
    try {
      const urlRes = await actions.uploadSignatureUrl(serviceId, file.name);
      if (!urlRes.success || !urlRes.data) throw new Error(urlRes.error?.message ?? "upload");
      const put = await fetch(urlRes.data.signedUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type },
      });
      if (!put.ok) throw new Error("upload_failed");
      setSigPath(urlRes.data.path);
      setPreview(URL.createObjectURL(file)); // immediate local preview of the new image
      toast.success(t.translationImageUploaded);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <ViewHead title={t.translationStepTitle} sub={t.translationStepSub} />
      <div style={bannerStyle}>
        <Icon name="info" size={16} color="var(--gold-deep)" />
        {t.translationStepNote}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 12, maxWidth: 720 }}>
        <div>
          <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)" }}>
            {t.translationSignerName}
          </label>
          <input
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder={t.translationSignerNamePh}
            maxLength={160}
            style={{
              width: "100%",
              marginTop: 6,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              fontSize: 14,
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)" }}>
            {t.translationSignatureImage}
          </label>
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              marginTop: 6,
              border: "1.5px dashed var(--line)",
              borderRadius: 12,
              padding: 18,
              textAlign: "center",
              cursor: "pointer",
              background: "var(--card)",
            }}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt={t.translationSignatureImage} style={{ maxHeight: 90, maxWidth: "100%" }} />
            ) : (
              <span style={{ color: "var(--ink-3)", fontSize: 13.5 }}>
                {uploading ? t.translationUploading : t.translationDrop}
              </span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPick(f);
              e.target.value = "";
            }}
          />
          <p style={{ color: "var(--ink-3)", fontSize: 12.5, marginTop: 6 }}>{t.translationImageHint}</p>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Step: Contract content ───────────────────────── */

function ContractStep({
  object,
  setObject,
  scope,
  setScope,
  special,
  setSpecial,
  t,
}: {
  object: I18nValue;
  setObject: (v: I18nValue) => void;
  scope: I18nValue;
  setScope: (v: I18nValue) => void;
  special: I18nValue;
  setSpecial: (v: I18nValue) => void;
  t: Record<string, string>;
}) {
  return (
    <div>
      <ViewHead title={t.contractStepTitle} sub={t.contractStepSub} />
      <div style={bannerStyle}>
        <Icon name="info" size={16} color="var(--gold-deep)" />
        {t.contractStepNote}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 12, maxWidth: 720 }}>
        <I18nField label={t.contractObject} value={object} onChange={setObject} multiline />
        <div>
          <I18nField label={t.contractScope} value={scope} onChange={setScope} multiline />
          <p style={{ color: "var(--ink-3)", fontSize: 12.5, marginTop: 6 }}>{t.contractScopeHint}</p>
        </div>
        <I18nField label={t.contractSpecial} value={special} onChange={setSpecial} multiline />
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
                  aria-label={c}
                  aria-pressed={on}
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
            <div>
              <FieldLabel>{t.frequency}</FieldLabel>
              <SelectInput
                value={p.default_frequency}
                onChange={(e) => update(p.kind, { default_frequency: e.target.value === "weekly" ? "weekly" : "monthly" })}
              >
                <option value="monthly">{t.frequencyMonthly}</option>
                <option value="weekly">{t.frequencyWeekly}</option>
              </SelectInput>
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
        { id: r.data!.id, slug, label: { es: "", en: "" }, description: { es: "", en: "" }, client_explainer: { es: "", en: "" }, appointment_count: 1, duration_minutes: 30, kind: "video", schedule: [], processing_weeks: 0, milestones: [], docs: [], forms: [] },
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
    // Keep the legacy phase policy in sync (fallback + kind source for cases
    // without a schedule). Count/duration/kind derive from the cronograma.
    const first = ph.schedule[0];
    await actions.upsertPolicy({
      service_phase_id: ph.id,
      appointment_count: ph.schedule.length > 0 ? ph.schedule.length : ph.appointment_count,
      duration_minutes: first?.duration_minutes ?? ph.duration_minutes,
      kind: first?.kind ?? ph.kind,
    });
    // Persist the per-cita cronograma + trailing processing weeks.
    await actions.upsertSchedule({
      service_phase_id: ph.id,
      processing_weeks: ph.processing_weeks,
      items: ph.schedule.map((s, i) => ({
        sequence_number: i + 1,
        duration_minutes: s.duration_minutes,
        kind: s.kind,
        week_offset: s.week_offset,
        objectives: s.objectives
          .filter((o) => (o.text.es ?? "").trim() || (o.text.en ?? "").trim())
          .map((o) => ({ id: o.id, text: o.text })),
      })),
    });
    // Persist the "Mi proceso" milestones (hitos) — full-list upsert.
    await actions.upsertMilestones(
      ph.id,
      ph.milestones.map((m, i) => ({
        id: m.id || null,
        slug: milestoneSlug(m, i),
        label_i18n: { es: m.label.es ?? "", en: m.label.en ?? "" },
        glossary_i18n: { es: m.glossary.es ?? "", en: m.glossary.en ?? "" },
        icon: m.icon || "route",
        week_offset: m.week_offset,
      })),
    );
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

  function updateCita(ci: number, patch: Partial<WizardScheduleItem>) {
    update(activeIdx, {
      schedule: active.schedule.map((s, i) => (i === ci ? { ...s, ...patch } : s)),
    });
  }
  function removeCita(ci: number) {
    update(activeIdx, { schedule: active.schedule.filter((_, i) => i !== ci) });
  }
  function addCita() {
    const nextWeek = active.schedule.reduce((m, s) => Math.max(m, s.week_offset), 0) + 1;
    update(activeIdx, {
      schedule: [
        ...active.schedule,
        { sequence_number: active.schedule.length + 1, duration_minutes: 45, kind: "video", week_offset: nextWeek, objectives: [] },
      ],
    });
  }
  // Objectives editor (per cita): add / edit / remove.
  function addObjective(ci: number) {
    const item = active.schedule[ci];
    updateCita(ci, { objectives: [...item.objectives, { id: crypto.randomUUID(), text: { es: "", en: "" } }] });
  }
  function updateObjective(ci: number, oi: number, text: I18nValue) {
    const item = active.schedule[ci];
    updateCita(ci, { objectives: item.objectives.map((o, i) => (i === oi ? { ...o, text } : o)) });
  }
  function removeObjective(ci: number, oi: number) {
    const item = active.schedule[ci];
    updateCita(ci, { objectives: item.objectives.filter((_, i) => i !== oi) });
  }
  // Milestones ("Mi proceso" hitos) editor: add / edit / remove.
  function updateMilestone(mi: number, patch: Partial<WizardMilestone>) {
    update(activeIdx, {
      milestones: active.milestones.map((m, i) => (i === mi ? { ...m, ...patch } : m)),
    });
  }
  function removeMilestone(mi: number) {
    update(activeIdx, { milestones: active.milestones.filter((_, i) => i !== mi) });
  }
  function addMilestone() {
    const nextWeek = active.milestones.reduce((mx, m) => Math.max(mx, m.week_offset ?? 0), 0) + 1;
    update(activeIdx, {
      milestones: [
        ...active.milestones,
        { id: "", slug: "", label: { es: "", en: "" }, glossary: { es: "", en: "" }, icon: "route", week_offset: nextWeek },
      ],
    });
  }
  const cronoLastWeek = (active?.schedule ?? []).reduce((m, s) => Math.max(m, s.week_offset), 0);
  const cronoTotalWeeks = cronoLastWeek + (active?.processing_weeks ?? 0);

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
              aria-label={`Fase ${i + 1}: ${ph.label.es || ph.slug}`}
              aria-pressed={on}
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
          aria-label={t.addPhase}
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

          {/* Hitos del "Mi proceso" (DOC-53 §4.2) */}
          <div>
            <FieldLabel>{t.milestonesTitle}</FieldLabel>
            <p style={{ ...subLabel, marginBottom: 8 }}>{t.milestonesHelp}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {active.milestones.map((m, mi) => (
                <div
                  key={mi}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    padding: 12,
                    background: "var(--panel-2, var(--card-alt))",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ ...subLabel, margin: 0, fontWeight: 800 }}>
                      {t.milestoneN.replace("{n}", String(mi + 1))}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ ...subLabel, margin: 0 }}>{t.citaWeek}</span>
                      <div style={{ width: 80 }}>
                        <TextInput
                          type="number"
                          value={m.week_offset == null ? "" : String(m.week_offset)}
                          onChange={(e) =>
                            updateMilestone(mi, {
                              week_offset: e.target.value === "" ? null : Math.max(1, Number(e.target.value)),
                            })
                          }
                        />
                      </div>
                      <button
                        type="button"
                        aria-label={t.delete}
                        onClick={() => removeMilestone(mi)}
                        style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel, var(--card))", cursor: "pointer", display: "grid", placeItems: "center" }}
                      >
                        <Icon name="x" size={14} color="var(--ink-3)" />
                      </button>
                    </div>
                  </div>
                  <I18nField label={t.milestoneLabel} value={m.label} onChange={(v) => updateMilestone(mi, { label: v })} />
                  <I18nField label={t.milestoneGlossary} value={m.glossary} onChange={(v) => updateMilestone(mi, { glossary: v })} multiline />
                </div>
              ))}
              <button
                type="button"
                onClick={addMilestone}
                aria-label={t.addMilestone}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 10, cursor: "pointer", border: "1.5px dashed var(--line)", background: "transparent", color: "var(--accent)", fontWeight: 700, fontSize: 13 }}
              >
                <Icon name="plus" size={14} color="var(--accent)" /> {t.addMilestone}
              </button>
            </div>
          </div>

          <div>
            <FieldLabel>{t.apptScheduleTitle}</FieldLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {active.schedule.map((s, ci) => (
                <div key={ci} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10, background: "var(--panel-2, var(--card-alt))" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "54px 1fr 1fr 1.3fr 32px", gap: 8, alignItems: "end" }}>
                    <span style={{ ...subLabel, alignSelf: "center", margin: 0 }}>{t.citaN.replace("{n}", String(ci + 1))}</span>
                    <div>
                      <span style={subLabel}>{t.apptDuration}</span>
                      <TextInput type="number" value={String(s.duration_minutes)} onChange={(e) => updateCita(ci, { duration_minutes: Math.max(5, Number(e.target.value)) })} />
                    </div>
                    <div>
                      <span style={subLabel}>{t.citaWeek}</span>
                      <TextInput type="number" value={String(s.week_offset)} onChange={(e) => updateCita(ci, { week_offset: Math.max(1, Number(e.target.value)) })} />
                    </div>
                    <div>
                      <span style={subLabel}>{t.apptKind}</span>
                      <SelectInput value={s.kind} onChange={(e) => updateCita(ci, { kind: e.target.value as WizardScheduleItem["kind"] })}>
                        <option value="video">{t.apptVideo}</option>
                        <option value="phone">{t.apptPhone}</option>
                        <option value="presencial">{t.apptPresencial}</option>
                      </SelectInput>
                    </div>
                    <button
                      type="button"
                      aria-label={t.delete}
                      onClick={() => removeCita(ci)}
                      style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel, var(--card))", cursor: "pointer", display: "grid", placeItems: "center" }}
                    >
                      <Icon name="x" size={14} color="var(--ink-3)" />
                    </button>
                  </div>
                  {/* Objectives for this cita */}
                  <div style={{ marginTop: 10 }}>
                    <span style={subLabel}>{t.objectivesLabel}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {s.objectives.map((o, oi) => (
                        <div key={o.id} style={{ display: "grid", gridTemplateColumns: "1fr 32px", gap: 8, alignItems: "center" }}>
                          <TextInput
                            value={o.text.es ?? ""}
                            placeholder={t.objectivePh}
                            onChange={(e) => updateObjective(ci, oi, { es: e.target.value, en: o.text.en ?? "" })}
                          />
                          <button
                            type="button"
                            aria-label={t.delete}
                            onClick={() => removeObjective(ci, oi)}
                            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel, var(--card))", cursor: "pointer", display: "grid", placeItems: "center" }}
                          >
                            <Icon name="x" size={14} color="var(--ink-3)" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addObjective(ci)}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, cursor: "pointer", border: "1px dashed var(--line)", background: "transparent", color: "var(--accent)", fontWeight: 700, fontSize: 12.5, alignSelf: "flex-start" }}
                      >
                        <Icon name="plus" size={13} color="var(--accent)" /> {t.addObjective}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addCita}
                aria-label={t.addCita}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 10, cursor: "pointer", border: "1.5px dashed var(--line)", background: "transparent", color: "var(--accent)", fontWeight: 700, fontSize: 13 }}
              >
                <Icon name="plus" size={14} color="var(--accent)" /> {t.addCita}
              </button>
            </div>

            <div style={{ marginTop: 12, maxWidth: 220 }}>
              <span style={subLabel}>{t.processingWeeks}</span>
              <TextInput type="number" value={String(active.processing_weeks)} onChange={(e) => update(activeIdx, { processing_weeks: Math.max(0, Number(e.target.value)) })} />
            </div>

            <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "var(--accent-soft)", fontSize: 12.5, color: "var(--ink-2)", fontWeight: 700, lineHeight: 1.5 }}>
              {active.schedule.length === 0 && active.processing_weeks === 0
                ? t.cronogramaEmpty
                : t.cronogramaTotal.replace("{n}", String(cronoTotalWeeks))}
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

/* ───────────────────────── Step 3: Parties ───────────────────────── */

function PartiesStep({
  serviceId,
  partyRoles,
  setPartyRoles,
  actions,
  t,
}: {
  serviceId: string | null;
  partyRoles: WizardPartyRole[];
  setPartyRoles: React.Dispatch<React.SetStateAction<WizardPartyRole[]>>;
  actions: CatalogWizardProps["actions"];
  t: Record<string, string>;
}) {
  // Available role types = the 8 keys minus the implicit applicant and any
  // already-defined role (unique per service).
  const used = new Set(partyRoles.map((r) => r.role_key));
  const available = PARTY_ROLE_KEYS.filter(
    (k) => k !== PRINCIPAL_ROLE_KEY && !used.has(k),
  );

  const [roleKey, setRoleKey] = React.useState<PartyRoleKey | "">(available[0] ?? "");
  const [label, setLabel] = React.useState<I18nValue>(
    available[0] ? { ...DEFAULT_PARTY_ROLE_LABELS[available[0]] } : { es: "", en: "" },
  );
  const [cardinality, setCardinality] = React.useState<"single" | "multiple">("single");
  const [required, setRequired] = React.useState(false);
  const [includeInContract, setIncludeInContract] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  function pickRole(k: string) {
    const key = k as PartyRoleKey;
    setRoleKey(key);
    // Default the label to the role's canonical label (admin may override).
    setLabel({ ...DEFAULT_PARTY_ROLE_LABELS[key] });
  }

  async function addRole() {
    if (!serviceId || !roleKey) return;
    if (!label.es?.trim()) {
      toast.error(t.partyNeedLabel);
      return;
    }
    if (used.has(roleKey)) {
      toast.error(t.partyDup);
      return;
    }
    setSaving(true);
    // Next position = max existing + 1 (robust to add/remove; `partyRoles.length`
    // could collide after a deletion and make the order non-deterministic).
    const nextPos = partyRoles.reduce((m, r) => Math.max(m, r.position), -1) + 1;
    const r = await actions.createPartyRole({
      service_id: serviceId,
      role_key: roleKey,
      label_i18n: { es: label.es ?? "", en: label.en ?? "" },
      cardinality,
      is_required: required,
      include_in_contract: includeInContract,
      position: nextPos,
    });
    setSaving(false);
    if (r.success && r.data) {
      const created: WizardPartyRole = {
        id: r.data.id,
        role_key: roleKey,
        label: { es: label.es ?? "", en: label.en ?? "" },
        cardinality,
        is_required: required,
        include_in_contract: includeInContract,
        position: nextPos,
      };
      setPartyRoles((prev) => [...prev, created]);
      // Derive the next available role from the UPDATED list (not the render-time
      // `used` set, which doesn't yet include the role we just added).
      const usedNow = new Set([...partyRoles, created].map((r) => r.role_key));
      const nextAvailable = PARTY_ROLE_KEYS.filter(
        (k) => k !== PRINCIPAL_ROLE_KEY && !usedNow.has(k),
      );
      setRoleKey(nextAvailable[0] ?? "");
      setLabel(nextAvailable[0] ? { ...DEFAULT_PARTY_ROLE_LABELS[nextAvailable[0]] } : { es: "", en: "" });
      setCardinality("single");
      setRequired(false);
      setIncludeInContract(true);
      toast.success(t.saved);
    } else {
      toast.error(r.error?.message ?? "Error");
    }
  }

  async function removeRole(id: string) {
    const r = await actions.deletePartyRole(id);
    if (r.success) {
      setPartyRoles((prev) => prev.filter((x) => x.id !== id));
      toast.success(t.saved);
    } else {
      toast.error(r.error?.message ?? "Error");
    }
  }

  // Inline toggle: whether parties of this role are committed in the contract.
  // Optimistic update + rollback on failure (the only per-row editable field).
  async function toggleContract(id: string, next: boolean) {
    setPartyRoles((prev) =>
      prev.map((x) => (x.id === id ? { ...x, include_in_contract: next } : x)),
    );
    const r = await actions.updatePartyRole(id, { include_in_contract: next });
    if (r.success) {
      toast.success(t.saved);
    } else {
      setPartyRoles((prev) =>
        prev.map((x) => (x.id === id ? { ...x, include_in_contract: !next } : x)),
      );
      toast.error(r.error?.message ?? "Error");
    }
  }

  return (
    <div>
      <ViewHead title={t.partiesTitle} sub={t.partiesSub} />
      <div style={bannerStyle}>
        <Icon name="info" size={16} color="var(--gold-deep)" />
        {t.partiesApplicantNote}
      </div>

      {serviceId && available.length > 0 && (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: 16,
            margin: "12px 0 16px",
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ minWidth: 180 }}>
              <FieldLabel>{t.partyType}</FieldLabel>
              <SelectInput value={roleKey} onChange={(e) => pickRole(e.target.value)}>
                {available.map((k) => (
                  <option key={k} value={k}>
                    {DEFAULT_PARTY_ROLE_LABELS[k].es}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div style={{ minWidth: 180 }}>
              <FieldLabel>{t.partyCardinality}</FieldLabel>
              <SelectInput
                value={cardinality}
                onChange={(e) => setCardinality(e.target.value as "single" | "multiple")}
              >
                <option value="single">{t.partySingle}</option>
                <option value="multiple">{t.partyMultiple}</option>
              </SelectInput>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", paddingBottom: 8 }}>
              <Switch checked={required} onCheckedChange={setRequired} aria-label={t.partyRequired} />
              {t.partyRequired}
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", paddingBottom: 8 }}>
              <Switch
                checked={includeInContract}
                onCheckedChange={setIncludeInContract}
                aria-label={t.partyInContract}
              />
              {t.partyInContract}
            </label>
          </div>
          <I18nField label={t.partyLabel} value={label} onChange={setLabel} />
          <div>
            <GradientBtn onClick={addRole} disabled={saving || !roleKey} aria-label={t.partiesAdd}>
              {saving ? "…" : t.partiesAdd}
            </GradientBtn>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {/* Solicitante — implicit principal party (PRINCIPAL_ROLE_KEY): always
            present, auto-included, and NOT removable (DOC-41). Shown fixed at the
            top so the admin sees it's part of every case. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "10px 14px",
            background: "var(--blue-soft)",
          }}
        >
          <span style={{ fontWeight: 700, color: "var(--ink)" }}>
            {DEFAULT_PARTY_ROLE_LABELS[PRINCIPAL_ROLE_KEY].es}
          </span>
          <Chip tone="gold">{t.partySingle}</Chip>
          <Chip tone="green">{t.partyRequired}</Chip>
          <Chip tone="blue">{t.partyInContract}</Chip>
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--ink-3)",
            }}
          >
            <Icon name="lock" size={14} color="var(--ink-3)" />
            {t.partyApplicantFixed}
          </span>
        </div>

        {partyRoles.map((r) => (
          <div
            key={r.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "10px 14px",
            }}
          >
            <span style={{ fontWeight: 700, color: "var(--ink)" }}>{r.label.es || r.role_key}</span>
            <Chip tone={r.cardinality === "multiple" ? "blue" : "gold"}>
              {r.cardinality === "multiple" ? t.partyMultiple : t.partySingle}
            </Chip>
            {r.is_required && <Chip tone="green">{t.partyRequired}</Chip>}
            <label
              style={{
                marginLeft: "auto",
                display: "flex",
                gap: 8,
                alignItems: "center",
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: 700,
                color: "var(--ink-3)",
              }}
            >
              <Switch
                checked={r.include_in_contract}
                onCheckedChange={(v) => toggleContract(r.id, v)}
                aria-label={t.partyInContract}
              />
              {t.partyInContract}
            </label>
            <button
              type="button"
              onClick={() => removeRole(r.id)}
              aria-label={t.partyRemove}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Icon name="x" size={16} color="var(--ink-3)" />
            </button>
          </div>
        ))}
      </div>

      {partyRoles.length === 0 && (
        <p style={{ color: "var(--ink-3)", fontSize: 14, marginTop: 10 }}>{t.partiesEmpty}</p>
      )}
    </div>
  );
}

/* ───────────────────────── Step 4: Documents ───────────────────────── */

function DocsStep({
  phases,
  setPhases,
  partyRoles,
  actions,
  t,
}: {
  phases: WizardPhase[];
  setPhases: React.Dispatch<React.SetStateAction<WizardPhase[]>>;
  partyRoles: WizardPartyRole[];
  actions: CatalogWizardProps["actions"];
  t: Record<string, string>;
}) {
  const [phaseIdx, setPhaseIdx] = React.useState(0);
  const phase = phases[phaseIdx];

  // Role options for the per-party picker: the implicit applicant + this
  // service's declared additional roles. The doc is requested from whoever is checked.
  const roleOptions: { key: string; label: string }[] = [
    { key: PRINCIPAL_ROLE_KEY, label: t.docPartyApplicant },
    ...partyRoles.map((r) => ({ key: r.role_key, label: r.label.es || r.role_key })),
  ];

  // Add-document form (RF-ADM-023)
  const [docLabel, setDocLabel] = React.useState<I18nValue>({ es: "", en: "" });
  const [docCategory, setDocCategory] = React.useState("");
  const [docRequired, setDocRequired] = React.useState(true);
  const [docPerParty, setDocPerParty] = React.useState(false);
  // Domain rule: is_per_party requires party_roles (CATALOG_PER_PARTY_WITHOUT_ROLES).
  // Constrained to the service's roles via the multiselect below.
  const [docPartyRoles, setDocPartyRoles] = React.useState<string[]>([]);
  const [docAiExtract, setDocAiExtract] = React.useState(false);
  // The fields the AI extracts (JSON Schema). Edited in the "Esquema…" modal.
  const [docExtractionSchema, setDocExtractionSchema] =
    React.useState<Record<string, unknown> | null>(null);
  const [schemaModalOpen, setSchemaModalOpen] = React.useState(false);
  // Admin-chosen upload format for this document: pdf | png (default pdf).
  const [docFormat, setDocFormat] = React.useState<"pdf" | "png">("pdf");
  // Admin-chosen: client may upload more than one file for this document.
  const [docAllowMultiple, setDocAllowMultiple] = React.useState(false);
  const [savingDoc, setSavingDoc] = React.useState(false);
  // null = create mode; a doc id = editing that document in place.
  const [editingDocId, setEditingDocId] = React.useState<string | null>(null);

  function togglePartyRole(key: string) {
    setDocPartyRoles((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  // Quick lookup of a role's display label for the "Partes" column.
  const roleLabelByKey = new Map(roleOptions.map((o) => [o.key, o.label]));

  function resetDocForm() {
    setEditingDocId(null);
    setDocLabel({ es: "", en: "" });
    setDocCategory("");
    setDocRequired(true);
    setDocPerParty(false);
    setDocPartyRoles([]);
    setDocAiExtract(false);
    setDocExtractionSchema(null);
    setDocFormat("pdf");
    setDocAllowMultiple(false);
  }

  function startEditDoc(d: WizardDoc) {
    setEditingDocId(d.id);
    setDocLabel({ es: d.label.es ?? "", en: d.label.en ?? "" });
    setDocCategory(d.category.es ?? "");
    setDocRequired(d.is_required);
    setDocPerParty(d.is_per_party);
    setDocPartyRoles(d.party_roles ?? []);
    setDocAiExtract(d.ai_extract);
    setDocExtractionSchema(d.extraction_schema ?? null);
    setDocFormat(d.accepted_format ?? "pdf");
    setDocAllowMultiple(d.allow_multiple ?? false);
  }

  const docSlugFrom = (es: string) =>
    slugify(es).slice(0, 60) || `documento-${(phase?.docs.length ?? 0) + 1}`;

  async function saveDocument() {
    if (!phase) return;
    if (!docLabel.es?.trim()) {
      toast.error(t.docNeedName);
      return;
    }
    if (docPerParty && docPartyRoles.length === 0) {
      toast.error(t.docNeedRoles);
      return;
    }
    const docRoles = docPerParty ? docPartyRoles : null;
    const labelI18n = { es: docLabel.es ?? "", en: docLabel.en ?? "" };
    const categoryI18n = docCategory.trim() ? { es: docCategory.trim(), en: "" } : null;
    setSavingDoc(true);

    // --- Edit an existing document in place (party assignment, required, label) ---
    if (editingDocId) {
      const r = await actions.updateRequiredDoc(editingDocId, {
        label_i18n: labelI18n,
        category_i18n: categoryI18n,
        is_required: docRequired,
        is_per_party: docPerParty,
        party_roles: docRoles,
        ai_extract: docAiExtract,
        extraction_schema: docAiExtract ? docExtractionSchema : null,
        accepted_format: docFormat,
        allow_multiple: docAllowMultiple,
      });
      setSavingDoc(false);
      if (r.success) {
        setPhases((prev) =>
          prev.map((p, i) =>
            i === phaseIdx
              ? {
                  ...p,
                  docs: p.docs.map((d) =>
                    d.id === editingDocId
                      ? {
                          ...d,
                          label: labelI18n,
                          category: { es: docCategory.trim(), en: "" },
                          is_required: docRequired,
                          is_per_party: docPerParty,
                          party_roles: docRoles ?? [],
                          ai_extract: docAiExtract,
                          extraction_schema: docAiExtract ? docExtractionSchema : null,
                          accepted_format: docFormat,
                          allow_multiple: docAllowMultiple,
                        }
                      : d,
                  ),
                }
              : p,
          ),
        );
        resetDocForm();
        toast.success(t.saved);
      } else {
        toast.error(r.error?.message ?? "Error");
      }
      return;
    }

    // --- Create a new document ---
    const r = await actions.createRequiredDoc({
      service_phase_id: phase.id,
      slug: docSlugFrom(docLabel.es),
      label_i18n: labelI18n,
      category_i18n: categoryI18n,
      is_required: docRequired,
      is_per_party: docPerParty,
      party_roles: docRoles,
      ai_extract: docAiExtract,
      extraction_schema: docAiExtract ? docExtractionSchema : null,
      accepted_format: docFormat,
      allow_multiple: docAllowMultiple,
      position: phase.docs.length,
    });
    setSavingDoc(false);
    if (r.success && r.data) {
      const created: WizardDoc = {
        id: r.data.id,
        slug: docSlugFrom(docLabel.es),
        label: labelI18n,
        help: { es: "", en: "" },
        category: { es: docCategory.trim(), en: "" },
        is_required: docRequired,
        is_per_party: docPerParty,
        party_roles: docRoles ?? [],
        ai_extract: docAiExtract,
        extraction_schema: docAiExtract ? docExtractionSchema : null,
        accepted_format: docFormat,
        allow_multiple: docAllowMultiple,
        is_active: true,
      };
      setPhases((prev) =>
        prev.map((p, i) => (i === phaseIdx ? { ...p, docs: [...p.docs, created] } : p)),
      );
      resetDocForm();
      toast.success(t.saved);
    } else {
      toast.error(r.error?.message ?? "Error");
    }
  }

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

      {phase && (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
            display: "grid",
            gap: 12,
          }}
        >
          <I18nField label={t.docDocument} value={docLabel} onChange={setDocLabel} />
          <div style={{ maxWidth: 320 }}>
            <FieldLabel>{t.docCategory}</FieldLabel>
            <TextInput
              value={docCategory}
              placeholder="Identidad"
              onChange={(e) => setDocCategory(e.target.value)}
            />
          </div>
          <div style={{ maxWidth: 320 }}>
            <FieldLabel>{t.docFormat}</FieldLabel>
            <div style={{ display: "flex", gap: 8 }}>
              {(["pdf", "png"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={docFormat === f}
                  onClick={() => setDocFormat(f)}
                  style={{
                    flex: 1,
                    padding: "9px 14px",
                    borderRadius: 10,
                    border: docFormat === f ? "2px solid var(--accent)" : "1px solid var(--line)",
                    background: docFormat === f ? "var(--blue-soft)" : "var(--card)",
                    color: "var(--ink)",
                    fontFamily: "var(--font-title)",
                    fontWeight: 800,
                    fontSize: 13.5,
                    cursor: "pointer",
                  }}
                >
                  {f === "pdf" ? t.docFormatPdf : t.docFormatPng}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <Switch checked={docRequired} onCheckedChange={setDocRequired} aria-label={t.docRequired} />
              {t.docRequired}
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <Switch checked={docPerParty} onCheckedChange={setDocPerParty} aria-label={t.docPerParty} />
              {t.docPerParty}
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <Switch checked={docAiExtract} onCheckedChange={setDocAiExtract} aria-label={t.docAiExtract} />
              {t.docAiExtract}
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <Switch checked={docAllowMultiple} onCheckedChange={setDocAllowMultiple} aria-label={t.docAllowMultiple} />
              {t.docAllowMultiple}
            </label>
            {docAiExtract && (
              <GhostBtn size="md" full={false} icon="sparkle" onClick={() => setSchemaModalOpen(true)}>
                {t.docSchema}
                {schemaFieldCount(docExtractionSchema) > 0 ? ` · ${schemaFieldCount(docExtractionSchema)}` : ""}
              </GhostBtn>
            )}
            <GradientBtn onClick={saveDocument} disabled={savingDoc} aria-label={editingDocId ? t.docSave : t.docAdd}>
              {savingDoc ? "…" : editingDocId ? t.docSave : t.docAdd}
            </GradientBtn>
            {editingDocId && (
              <GhostBtn size="md" full={false} onClick={resetDocForm}>
                {t.docCancelEdit}
              </GhostBtn>
            )}
          </div>

          {docPerParty && (
            <div>
              <FieldLabel>{t.docPartyRolesLabel}</FieldLabel>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4 }}>
                {roleOptions.map((opt) => (
                  <label
                    key={opt.key}
                    style={{ display: "flex", gap: 7, alignItems: "center", cursor: "pointer", fontSize: 13.5 }}
                  >
                    <input
                      type="checkbox"
                      checked={docPartyRoles.includes(opt.key)}
                      onChange={() => togglePartyRole(opt.key)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
                <th style={docHead}>{t.docPartiesColumn}</th>
                <th style={{ ...docHead, textAlign: "center" }}>{t.docFormat}</th>
                <th style={{ ...docHead, textAlign: "center" }}>{t.docMultiple}</th>
                <th style={{ ...docHead, textAlign: "center" }}>{t.docAiExtract}</th>
                <th style={{ ...docHead, textAlign: "right" }} aria-label={t.docActions} />
              </tr>
            </thead>
            <tbody>
              {phase.docs.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ ...docCell, textAlign: "center", color: "var(--ink-3)", padding: "26px" }}>
                    {t.emptyTitle ?? "—"}
                  </td>
                </tr>
              ) : (
                phase.docs.map((d) => (
                  <tr key={d.id} style={editingDocId === d.id ? { background: "var(--blue-soft)" } : undefined}>
                    <td style={docCell}>
                      <div style={{ fontWeight: 700, color: "var(--ink)" }}>{d.label.es || d.slug}</div>
                      <code style={{ fontSize: 11, color: "var(--ink-3)" }}>{d.slug}</code>
                    </td>
                    <td style={docCell}>{d.category.es || "—"}</td>
                    <td style={{ ...docCell, textAlign: "center" }}>{d.is_required ? <Icon name="check" size={16} color="var(--green)" /> : "—"}</td>
                    <td style={{ ...docCell, textAlign: "center" }}>{d.is_per_party ? <Icon name="check" size={16} color="var(--green)" /> : "—"}</td>
                    <td style={docCell}>
                      {d.is_per_party && d.party_roles.length > 0
                        ? d.party_roles.map((k) => roleLabelByKey.get(k) ?? k).join(", ")
                        : "—"}
                    </td>
                    <td style={{ ...docCell, textAlign: "center" }}>
                      <Chip tone="blue">{(d.accepted_format ?? "pdf").toUpperCase()}</Chip>
                    </td>
                    <td style={{ ...docCell, textAlign: "center" }}>
                      {d.allow_multiple ? <Icon name="check" size={16} color="var(--green)" /> : "—"}
                    </td>
                    <td style={{ ...docCell, textAlign: "center" }}>
                      {d.ai_extract ? (
                        <Chip tone="gold" dot>
                          {t.docAiExtract}
                          {schemaFieldCount(d.extraction_schema) > 0 ? ` · ${schemaFieldCount(d.extraction_schema)}` : ""}
                        </Chip>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ ...docCell, textAlign: "right" }}>
                      <GhostBtn size="md" full={false} icon="edit" onClick={() => startEditDoc(d)}>
                        {t.docEdit}
                      </GhostBtn>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {schemaModalOpen && phase && (
        <ExtractionSchemaModal
          value={docExtractionSchema}
          servicePhaseId={phase.id}
          documentLabel={docLabel.en || docLabel.es || ""}
          documentHelp={docCategory.trim() || undefined}
          t={t}
          proposeAction={actions.proposeExtractionSchema}
          validateAction={actions.validateExtractionSchema}
          onClose={() => setSchemaModalOpen(false)}
          onSave={(schema) => {
            setDocExtractionSchema(schema);
            setSchemaModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ───────────────────────── Step 5: Forms (DOC-40 §3.5/§3.6) ───────────────────────── */

function formSlugFrom(es: string, fallbackIdx: number): string {
  return slugify(es).slice(0, 60) || `formulario-${fallbackIdx}`;
}

function FormsStep({
  t,
  serviceId,
  phases,
  setPhases,
  actions,
}: {
  t: Record<string, string>;
  serviceId: string | null;
  phases: WizardPhase[];
  setPhases: React.Dispatch<React.SetStateAction<WizardPhase[]>>;
  actions: CatalogWizardProps["actions"];
}) {
  const [phaseIdx, setPhaseIdx] = React.useState(0);
  const phase = phases[phaseIdx];

  // Create-form state
  const [formKind, setFormKind] = React.useState<"pdf_automation" | "ai_letter">("pdf_automation");
  const [formLabel, setFormLabel] = React.useState<I18nValue>({ es: "", en: "" });
  const [formSlug, setFormSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [formFilledBy, setFormFilledBy] = React.useState<"client" | "staff" | "both">("client");
  const [saving, setSaving] = React.useState(false);
  const [togglingIds, setTogglingIds] = React.useState<Set<string>>(() => new Set());

  // Reset the create-form draft when switching phases so a slug typed for one
  // phase never leaks into another (forms are scoped per phase).
  React.useEffect(() => {
    setFormLabel({ es: "", en: "" });
    setFormSlug("");
    setSlugTouched(false);
  }, [phaseIdx]);

  // No persisted service yet → forms need a phase id (service must be saved first).
  if (!serviceId || phases.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 8, padding: "40px 24px" }}>
        <Lex size={120} mood="señala" />
        <h3 style={{ margin: "6px 0 0", fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 17, color: "var(--ink)" }}>{t.formsNeedPhaseTitle}</h3>
        <p style={{ margin: 0, maxWidth: 420, fontSize: 14, lineHeight: 1.5, color: "var(--ink-2)" }}>{t.formsNeedPhaseSub}</p>
      </div>
    );
  }

  function onLabelChange(v: I18nValue) {
    setFormLabel(v);
    if (!slugTouched) setFormSlug(formSlugFrom(v.es ?? "", (phase?.forms.length ?? 0) + 1));
  }

  async function addForm() {
    if (!phase) return;
    if (!formLabel.es?.trim()) {
      toast.error(t.formsNeedName);
      return;
    }
    const slug = (formSlug.trim() || formSlugFrom(formLabel.es, phase.forms.length + 1));
    setSaving(true);
    const r = await actions.createForm({
      service_phase_id: phase.id,
      slug,
      kind: formKind,
      label_i18n: { es: formLabel.es ?? "", en: formLabel.en ?? "" },
      filled_by: formFilledBy,
      position: phase.forms.length,
    });
    setSaving(false);
    if (r.success && r.data) {
      const created: WizardForm = {
        id: r.data.id,
        slug,
        label: { es: formLabel.es ?? "", en: formLabel.en ?? "" },
        kind: formKind,
        filled_by: formFilledBy,
        is_active: true,
        position: phase.forms.length,
        requires_documents_complete: true,
        published_version: null,
      };
      setPhases((prev) => prev.map((p, i) => (i === phaseIdx ? { ...p, forms: [...p.forms, created] } : p)));
      setFormLabel({ es: "", en: "" });
      setFormSlug("");
      setSlugTouched(false);
      setFormFilledBy("client");
      toast.success(t.formsCreated);
    } else {
      toast.error(r.error?.message ?? "Error");
    }
  }

  async function toggleActive(form: WizardForm) {
    if (togglingIds.has(form.id)) return; // guard against double-click races
    setTogglingIds((s) => new Set(s).add(form.id));
    const next = !form.is_active;
    const r = await actions.updateForm(form.id, { is_active: next });
    if (r.success) {
      setPhases((prev) =>
        prev.map((p, i) =>
          i === phaseIdx ? { ...p, forms: p.forms.map((f) => (f.id === form.id ? { ...f, is_active: next } : f)) } : p,
        ),
      );
    } else {
      toast.error(r.error?.message ?? "Error");
    }
    setTogglingIds((s) => {
      const n = new Set(s);
      n.delete(form.id);
      return n;
    });
  }

  // Ola 2 — per-form override of the "documents 100% → forms" gate. Mirrors
  // toggleActive: optimistic + guarded, persisted via updateForm.
  async function toggleRequiresDocs(form: WizardForm) {
    if (togglingIds.has(form.id)) return;
    setTogglingIds((s) => new Set(s).add(form.id));
    const next = !form.requires_documents_complete;
    const r = await actions.updateForm(form.id, { requires_documents_complete: next });
    if (r.success) {
      setPhases((prev) =>
        prev.map((p, i) =>
          i === phaseIdx ? { ...p, forms: p.forms.map((f) => (f.id === form.id ? { ...f, requires_documents_complete: next } : f)) } : p,
        ),
      );
    } else {
      toast.error(r.error?.message ?? "Error");
    }
    setTogglingIds((s) => {
      const n = new Set(s);
      n.delete(form.id);
      return n;
    });
  }

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

      {phase && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 16, marginBottom: 16, display: "grid", gap: 12 }}>
          {/* Kind selector */}
          <div>
            <FieldLabel>{t.formsKind}</FieldLabel>
            <div role="radiogroup" aria-label={t.formsKind} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["pdf_automation", "ai_letter"] as const).map((k) => {
                const on = formKind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setFormKind(k)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      height: 40,
                      padding: "0 14px",
                      borderRadius: 12,
                      border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`,
                      background: on ? "var(--accent-soft)" : "var(--card,#fff)",
                      color: on ? "var(--accent)" : "var(--ink-2)",
                      fontWeight: 800,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    <Icon name={k === "ai_letter" ? "sparkle" : "form"} size={16} />
                    {k === "ai_letter" ? t.formsKindLetter : t.formsKindPdf}
                  </button>
                );
              })}
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.4 }}>
              {formKind === "ai_letter" ? t.formsKindLetterHint : t.formsKindPdfHint}
            </p>
          </div>

          <I18nField label={t.formsLabel} value={formLabel} onChange={onLabelChange} />

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 240px", minWidth: 200 }}>
              <FieldLabel>{t.formsSlug}</FieldLabel>
              <TextInput
                value={formSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setFormSlug(e.target.value);
                }}
                placeholder="formulario-i589"
                aria-label={t.formsSlug}
              />
            </div>
            <div style={{ flex: "0 1 200px", minWidth: 160 }}>
              <FieldLabel>{t.formsFilledBy}</FieldLabel>
              <SelectInput value={formFilledBy} aria-label={t.formsFilledBy} onChange={(e) => setFormFilledBy(e.target.value as "client" | "staff" | "both")}>
                <option value="client">{t.formsFilledClient}</option>
                <option value="staff">{t.formsFilledStaff}</option>
                <option value="both">{t.formsFilledBoth}</option>
              </SelectInput>
            </div>
            <GradientBtn onClick={addForm} disabled={saving} aria-label={t.formsCreate}>
              {saving ? "…" : t.formsCreate}
            </GradientBtn>
          </div>
        </div>
      )}

      {/* Forms list for the selected phase */}
      {phase && phase.forms.length === 0 ? (
        <p style={{ color: "var(--ink-3)" }}>{t.formsEmpty}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {phase?.forms.map((f) => (
            <div
              key={f.id}
              style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 14, border: "1px solid var(--line)", background: "var(--card,#fff)", padding: "12px 16px" }}
            >
              <Icon name={f.kind === "ai_letter" ? "sparkle" : "form"} size={20} color={f.kind === "ai_letter" ? "var(--gold-deep)" : "var(--accent)"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{f.label.es || f.label.en || f.slug}</div>
                <code style={{ fontSize: 11, color: "var(--ink-3)" }}>{f.slug}</code>
              </div>
              <Chip tone={f.kind === "ai_letter" ? "gold" : "blue"}>{f.kind === "ai_letter" ? t.formsKindLetter : t.formsKindPdf}</Chip>
              {f.kind === "pdf_automation" && (
                <Chip tone={f.published_version ? "green" : "amber"} dot>
                  {f.published_version ? `v${f.published_version}` : t.formsDraft}
                </Chip>
              )}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-2)", cursor: "pointer" }} title={t.formsRequiresDocsHint}>
                <Switch checked={f.requires_documents_complete} disabled={togglingIds.has(f.id)} onCheckedChange={() => toggleRequiresDocs(f)} aria-label={t.formsRequiresDocs} />
                {t.formsRequiresDocs}
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-2)", cursor: "pointer" }}>
                <Switch checked={f.is_active} disabled={togglingIds.has(f.id)} onCheckedChange={() => toggleActive(f)} aria-label={t.formsActive} />
                {t.formsActive}
              </label>
              <a
                href={`/admin/catalogo/${serviceId}/formularios/${f.id}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700, color: "var(--accent)", textDecoration: "none" }}
              >
                {t.formsConfigure} <Icon name="chevR" size={15} color="var(--accent)" />
              </a>
            </div>
          ))}
        </div>
      )}
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
