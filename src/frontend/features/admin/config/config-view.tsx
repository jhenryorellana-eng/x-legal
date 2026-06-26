"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Modal, Switch, EmptyState, toast } from "@/frontend/components/desktop";
import { Card, GradientBtn, GhostBtn, Chip, Icon } from "@/frontend/components/brand";
import { ViewHead, FieldLabel, TextInput, SelectInput, PillTabs } from "../shared/chrome";
import { I18nField, type I18nValue } from "../shared/i18n-field";

/* ───────────────────────── Types ───────────────────────── */

export interface OrgConfigVM {
  id: string;
  name: string;
  settings: {
    contact_phones: { label: string; phone: string }[];
    default_timezone: string;
    logo_url: string | null;
    representative_name: string | null;
    payment_zelle_email: string | null;
    goals: Record<string, unknown>;
  };
}

export interface CoverTemplateVM {
  id: string;
  name: string;
  is_active: boolean;
}

export interface TermsVersionVM {
  id: string;
  version: string;
  title: string;
  is_active: boolean;
  published_at: string | null;
}

export interface ConfigViewProps {
  org: OrgConfigVM;
  covers: CoverTemplateVM[];
  terms: TermsVersionVM[];
  acceptances: Record<string, number>;
  timezones: string[];
  messages: Record<string, string>;
  actions: {
    saveOrg: (patch: {
      name?: string;
      contact_phones?: { label: string; phone: string }[];
      default_timezone?: string;
      representative_name?: string | null;
      payment_zelle_email?: string | null;
    }) => Promise<{ success: boolean; error?: { code: string; message: string } }>;
    setCoverActive: (
      id: string,
      active: boolean,
    ) => Promise<{ success: boolean; error?: { code: string; message: string } }>;
    createTerms: (input: {
      version: string;
      title_i18n: { es: string; en: string };
      body_md_i18n: { es: string; en: string };
    }) => Promise<{ success: boolean; error?: { code: string; message: string } }>;
    publishTerms: (
      id: string,
    ) => Promise<{ success: boolean; error?: { code: string; message: string } }>;
  };
}

/* ───────────────────────── View ───────────────────────── */

export function ConfigView({
  org,
  covers,
  terms,
  acceptances,
  timezones,
  messages: t,
  actions,
}: ConfigViewProps) {
  const [tab, setTab] = React.useState<"general" | "covers" | "terms">("general");

  return (
    <div className="anim-fade-in-up" style={{ padding: "28px clamp(18px,3vw,36px) 64px", maxWidth: 980 }}>
      <ViewHead title={t.title} sub={t.sub} />

      <div style={{ marginBottom: 22 }}>
        <PillTabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "general", label: t.tabGeneral },
            { id: "covers", label: t.tabCovers },
            { id: "terms", label: t.tabTerms },
          ]}
        />
      </div>

      {tab === "general" && <GeneralTab org={org} timezones={timezones} t={t} save={actions.saveOrg} />}
      {tab === "covers" && <CoversTab covers={covers} t={t} setActive={actions.setCoverActive} />}
      {tab === "terms" && (
        <TermsTab terms={terms} acceptances={acceptances} t={t} createTerms={actions.createTerms} publishTerms={actions.publishTerms} />
      )}
    </div>
  );
}

/* ───────────────────────── General ───────────────────────── */

function GeneralTab({
  org,
  timezones,
  t,
  save,
}: {
  org: OrgConfigVM;
  timezones: string[];
  t: Record<string, string>;
  save: ConfigViewProps["actions"]["saveOrg"];
}) {
  const router = useRouter();
  const [name, setName] = React.useState(org.name);
  const [phones, setPhones] = React.useState(
    org.settings.contact_phones.length ? org.settings.contact_phones : [{ label: "", phone: "" }],
  );
  const [tz, setTz] = React.useState(org.settings.default_timezone);
  const [representative, setRepresentative] = React.useState(org.settings.representative_name ?? "");
  const [zelle, setZelle] = React.useState(org.settings.payment_zelle_email ?? "");
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<boolean>(false);

  async function onSave() {
    setSaving(true);
    const r = await save({
      name,
      contact_phones: phones.filter((p) => p.phone.trim()),
      default_timezone: tz,
      representative_name: representative.trim() || null,
      payment_zelle_email: zelle.trim() || null,
    });
    setSaving(false);
    if (r.success) {
      setSavedAt(true);
      toast.success(t.saved);
      router.refresh();
    } else {
      toast.error(r.error?.message ?? t.invalidPhone);
    }
  }

  return (
    <Card style={{ padding: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 560 }}>
        <div>
          <FieldLabel>{t.orgName}</FieldLabel>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <FieldLabel>{t.contactPhones}</FieldLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {phones.map((p, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <TextInput
                  value={p.label}
                  placeholder={t.phoneLabel}
                  onChange={(e) =>
                    setPhones((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                  style={{ flex: "0 0 40%" }}
                />
                <TextInput
                  value={p.phone}
                  placeholder={t.phoneNumber}
                  onChange={(e) =>
                    setPhones((prev) => prev.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))
                  }
                  style={{ flex: 1 }}
                />
                {phones.length > 1 && (
                  <button
                    onClick={() => setPhones((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={t.delete}
                    style={iconBtn}
                  >
                    <Icon name="x" size={15} color="var(--ink-2)" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setPhones((prev) => [...prev, { label: "", phone: "" }])}
              style={{
                alignSelf: "flex-start",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--accent)",
                fontWeight: 800,
                fontSize: 13,
                padding: 0,
              }}
            >
              <Icon name="plus" size={15} color="var(--accent)" /> {t.addPhone}
            </button>
          </div>
        </div>

        <div>
          <FieldLabel>{t.timezone}</FieldLabel>
          <SelectInput value={tz} onChange={(e) => setTz(e.target.value)}>
            {timezones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </SelectInput>
        </div>

        <div>
          <FieldLabel>{t.representativeName}</FieldLabel>
          <TextInput
            value={representative}
            placeholder={t.representativePlaceholder}
            onChange={(e) => setRepresentative(e.target.value)}
          />
        </div>

        <div>
          <FieldLabel>{t.paymentZelle}</FieldLabel>
          <TextInput
            value={zelle}
            placeholder={t.paymentZellePlaceholder}
            onChange={(e) => setZelle(e.target.value)}
          />
        </div>

        <p
          style={{
            margin: 0,
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--chip)",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--ink-2)",
          }}
        >
          {t.generalNote}
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <GradientBtn size="md" full={false} disabled={saving} icon="check" onClick={onSave}>
            {t.save}
          </GradientBtn>
          {savedAt && (
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t.saved}</span>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ───────────────────────── Covers ───────────────────────── */

function CoversTab({
  covers,
  t,
  setActive,
}: {
  covers: CoverTemplateVM[];
  t: Record<string, string>;
  setActive: ConfigViewProps["actions"]["setCoverActive"];
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);

  if (covers.length === 0) {
    return <EmptyState mood="calma" title={t.coversEmptyTitle} subtitle={t.coversEmptySub} />;
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
        {covers.map((c) => (
          <Card key={c.id} style={{ padding: 16 }}>
            {/* PDF preview placeholder (paper sheet) */}
            <div
              style={{
                aspectRatio: "3 / 4",
                borderRadius: 10,
                background: "#fff",
                border: "1px solid var(--line)",
                display: "grid",
                placeItems: "center",
                marginBottom: 12,
                boxShadow: "inset 0 0 0 1px rgba(11,27,51,0.04)",
              }}
            >
              <Icon name="doc" size={36} color="var(--ink-3)" />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontWeight: 800, fontSize: 14, color: "var(--ink)" }}>{c.name}</span>
              <Switch
                checked={c.is_active}
                disabled={pending === c.id}
                aria-label={`${c.name} ${c.is_active ? t.coverActive : t.coverInactive}`}
                onCheckedChange={async (v) => {
                  setPending(c.id);
                  const r = await setActive(c.id, v);
                  setPending(null);
                  if (r.success) {
                    toast.success(v ? t.coverActive : t.coverInactive);
                    router.refresh();
                  } else toast.error(r.error?.message ?? "Error");
                }}
              />
            </div>
          </Card>
        ))}
      </div>
      <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--ink-3)" }}>{t.coverInactiveNote}</p>
    </div>
  );
}

/* ───────────────────────── Terms ───────────────────────── */

function TermsTab({
  terms,
  acceptances,
  t,
  createTerms,
  publishTerms,
}: {
  terms: TermsVersionVM[];
  acceptances: Record<string, number>;
  t: Record<string, string>;
  createTerms: ConfigViewProps["actions"]["createTerms"];
  publishTerms: ConfigViewProps["actions"]["publishTerms"];
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);
  const current = terms.find((v) => v.is_active) ?? null;
  const history = terms.filter((v) => !v.is_active);

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("es-US", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <GradientBtn size="md" full={false} icon="plus" onClick={() => setCreateOpen(true)}>
          {t.termsNewVersion}
        </GradientBtn>
      </div>

      {terms.length === 0 ? (
        <EmptyState
          mood="calma"
          title={t.termsEmptyTitle}
          subtitle={t.termsEmptySub}
          action={{ label: t.termsNewVersion, icon: "plus", onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <>
          {current && (
            <Card glow="var(--green)" style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 700, marginBottom: 4 }}>
                    {t.termsCurrent}
                  </div>
                  <div style={{ fontFamily: "var(--font-title)", fontWeight: 900, fontSize: 22, color: "var(--ink)" }}>
                    {current.version}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4 }}>
                    {t.termsPublished.replace("{date}", fmtDate(current.published_at))} ·{" "}
                    {t.termsAcceptedBy.replace("{n}", String(acceptances[current.version] ?? 0))}
                  </div>
                </div>
                <Chip tone="green" dot>
                  {t.termsCurrentChip}
                </Chip>
              </div>
            </Card>
          )}

          {history.length > 0 && (
            <div>
              <h3 style={{ fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 15, color: "var(--ink)", margin: "0 0 10px" }}>
                {t.termsHistory}
              </h3>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {history.map((v, i) => (
                  <div
                    key={v.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "14px 18px",
                      borderTop: i === 0 ? "none" : "1px solid var(--line-2, var(--line))",
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 800, fontSize: 14, color: "var(--ink)" }}>{v.version}</span>
                      <span style={{ marginLeft: 10, fontSize: 12.5, color: "var(--ink-3)" }}>
                        {t.termsAcceptedBy.replace("{n}", String(acceptances[v.version] ?? 0))}
                      </span>
                    </div>
                    <GhostBtn
                      size="md"
                      full={false}
                      onClick={async () => {
                        const r = await publishTerms(v.id);
                        if (r.success) {
                          toast.success(t.termsCurrentChip);
                          router.refresh();
                        } else toast.error(r.error?.message ?? "Error");
                      }}
                    >
                      {t.termsPublish}
                    </GhostBtn>
                  </div>
                ))}
              </Card>
            </div>
          )}

          <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>{t.termsImmutable}</p>
        </>
      )}

      {createOpen && (
        <NewTermsModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          t={t}
          create={createTerms}
          onDone={() => {
            setCreateOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function NewTermsModal({
  open,
  onClose,
  t,
  create,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  t: Record<string, string>;
  create: ConfigViewProps["actions"]["createTerms"];
  onDone: () => void;
}) {
  const [version, setVersion] = React.useState("");
  const [title, setTitle] = React.useState<I18nValue>({ es: "", en: "" });
  const [body, setBody] = React.useState<I18nValue>({ es: "", en: "" });
  const [saving, setSaving] = React.useState(false);

  const valid = version.trim() && title.es && title.en && body.es && body.en;

  async function submit() {
    setSaving(true);
    const r = await create({
      version: version.trim(),
      title_i18n: { es: title.es ?? "", en: title.en ?? "" },
      body_md_i18n: { es: body.es ?? "", en: body.en ?? "" },
    });
    setSaving(false);
    if (r.success) {
      toast.success(t.termsCurrentChip);
      onDone();
    } else toast.error(r.error?.message ?? "Error");
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t.termsNewVersion}
      width={640}
      footer={
        <>
          <GhostBtn size="md" full={false} onClick={onClose}>
            {t.cancel}
          </GhostBtn>
          <GradientBtn size="md" full={false} disabled={!valid || saving} icon="check" onClick={submit}>
            {t.termsPublish}
          </GradientBtn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <FieldLabel>{t.termsVersionId}</FieldLabel>
          <TextInput value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v2026-06" />
        </div>
        <I18nField label={t.termsTitle} value={title} onChange={setTitle} />
        <I18nField label={t.termsBody} value={body} onChange={setBody} multiline />
      </div>
    </Modal>
  );
}

/* ───────────────────────── styles ───────────────────────── */

const iconBtn: React.CSSProperties = {
  display: "inline-grid",
  placeItems: "center",
  width: 42,
  height: 42,
  borderRadius: 12,
  border: "1px solid var(--line)",
  background: "var(--panel-2, var(--card-alt))",
  cursor: "pointer",
  flexShrink: 0,
};
