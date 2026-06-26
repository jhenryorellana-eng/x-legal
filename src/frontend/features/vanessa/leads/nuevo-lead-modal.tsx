"use client";

/**
 * Nuevo lead modal (DOC-52 §2.6, RF-VAN-014) — replica of NewLeadModal.
 *
 * Phone-first (E.164 normalize + duplicate check warning), optional name,
 * source + service of interest, category chips (+ create inline), initial note.
 * Submit → createLead. Phone invalid → field error (LEAD_PHONE_INVALID).
 */

import * as React from "react";
import { MSym } from "../shared/msym";
import { useToast } from "../shared/toast-bridge";
import { Modal } from "@/frontend/components/desktop";
import { CATEGORY_COLOR_TOKENS, categoryColorHex } from "./category-colors";

export interface CategoryOption {
  id: string;
  label: string;
  color: string;
}
export interface ServiceOption {
  id: string;
  label: string;
}
export interface SourceOption {
  value: string;
  label: string;
}

export interface NuevoLeadStrings {
  title: string;
  sub: string;
  phone: string;
  phonePh: string;
  dupWarn: string; // "Ya existe un lead con este teléfono ({name}) · Ver"
  view: string;
  name: string;
  namePh: string;
  source: string;
  service: string;
  category: string;
  createCat: string;
  catNamePh: string;
  catSave: string;
  note: string;
  notePh: string;
  cancel: string;
  create: string;
  created: string; // "✓ Lead creado en \"{col}\""
  entryColumn: string;
  invalidPhone: string;
}

export interface NuevoLeadActions {
  createLead: (input: {
    phone: string;
    name: string | null;
    source: string;
    serviceId: string | null;
    categoryId: string | null;
    note: string | null;
    confirmDuplicate?: boolean;
  }) => Promise<{
    ok: boolean;
    duplicate?: { name: string; leadId: string } | null;
    error?: { code: string };
  }>;
  createCategory: (input: { label: string; color: string }) => Promise<{ ok: boolean; id?: string }>;
}

export interface NuevoLeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetPhone?: string;
  sources: SourceOption[];
  services: ServiceOption[];
  categories: CategoryOption[];
  strings: NuevoLeadStrings;
  actions: NuevoLeadActions;
}

export function NuevoLeadModal({
  open,
  onOpenChange,
  presetPhone = "",
  sources,
  services,
  categories,
  strings,
  actions,
}: NuevoLeadModalProps) {
  const toast = useToast();
  const [phone, setPhone] = React.useState(presetPhone);
  const [name, setName] = React.useState("");
  const [source, setSource] = React.useState(sources[0]?.value ?? "");
  const [serviceId, setServiceId] = React.useState(services[0]?.id ?? "");
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [dup, setDup] = React.useState<{ name: string; leadId: string } | null>(null);
  const [phoneError, setPhoneError] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  // Categories can be created inline; keep a local copy so a freshly created one
  // appears as a chip without a full page refresh.
  const [cats, setCats] = React.useState<CategoryOption[]>(categories);
  const [creatingCat, setCreatingCat] = React.useState(false);
  const [newCatLabel, setNewCatLabel] = React.useState("");
  const [newCatColor, setNewCatColor] = React.useState<string>(CATEGORY_COLOR_TOKENS[0]);
  const [savingCat, setSavingCat] = React.useState(false);

  React.useEffect(() => {
    setCats(categories);
  }, [categories]);

  React.useEffect(() => {
    if (open) setPhone(presetPhone);
  }, [open, presetPhone]);

  const submitNewCategory = async () => {
    const label = newCatLabel.trim();
    if (!label || savingCat) return;
    setSavingCat(true);
    const res = await actions.createCategory({ label, color: newCatColor });
    setSavingCat(false);
    if (res.ok && res.id) {
      const created = { id: res.id, label, color: newCatColor };
      setCats((cur) => [...cur, created]);
      setCategoryId(res.id);
      setCreatingCat(false);
      setNewCatLabel("");
      setNewCatColor(CATEGORY_COLOR_TOKENS[0]);
    } else {
      toast.error(strings.catSave);
    }
  };

  const submit = async () => {
    if (!phone.trim() || submitting) return;
    setSubmitting(true);
    setPhoneError(false);
    const res = await actions.createLead({
      phone,
      name: name.trim() || null,
      source,
      serviceId: serviceId || null,
      categoryId,
      note: note.trim() || null,
      confirmDuplicate: dup !== null,
    });
    setSubmitting(false);
    if (res.ok) {
      onOpenChange(false);
      toast.success(strings.created.replace("{col}", strings.entryColumn));
    } else if (res.duplicate) {
      setDup(res.duplicate);
    } else if (res.error?.code === "LEAD_PHONE_INVALID") {
      setPhoneError(true);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={strings.title}
      description={strings.sub}
      width={520}
      footer={
        <>
          <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => onOpenChange(false)}>{strings.cancel}</button>
          <button type="button" className="vbtn vbtn-primary vbtn-sm" disabled={!phone.trim() || submitting} onClick={submit}>
            <MSym name="check" size={18} />
            {strings.create}
          </button>
        </>
      }
    >
      <div className="vfield">
        <label htmlFor="lead-phone">{strings.phone}</label>
        <input
          id="lead-phone"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setDup(null);
            setPhoneError(false);
          }}
          placeholder={strings.phonePh}
          autoFocus
          style={phoneError ? { borderColor: "var(--brand-red)" } : undefined}
        />
        {phoneError && (
          <div style={{ fontSize: 12, color: "var(--brand-red)", fontWeight: 700, marginTop: 6 }}>{strings.invalidPhone}</div>
        )}
        {dup && (
          <div className="dup-warn">
            <MSym name="warning" size={16} />
            {strings.dupWarn.replace("{name}", dup.name)} · {strings.view}
          </div>
        )}
      </div>

      <div className="vfield">
        <label htmlFor="lead-name">{strings.name}</label>
        <input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={strings.namePh} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="vfield">
          <label htmlFor="lead-source">{strings.source}</label>
          <select id="lead-source" value={source} onChange={(e) => setSource(e.target.value)}>
            {sources.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="vfield">
          <label htmlFor="lead-service">{strings.service}</label>
          <select id="lead-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="vfield">
        <label>{strings.category}</label>
        <div className="cat-chips">
          {cats.map((c) => {
            const hex = categoryColorHex(c.color);
            const sel = categoryId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                className={`cat-chip${sel ? " sel" : ""}`}
                style={sel ? { background: hex, borderColor: hex } : undefined}
                onClick={() => setCategoryId((cur) => (cur === c.id ? null : c.id))}
              >
                <span className="cat-dot" style={{ background: sel ? "#fff" : hex }} />
                {c.label}
              </button>
            );
          })}
          {!creatingCat && (
            <button type="button" className="cat-chip" onClick={() => setCreatingCat(true)}>
              <MSym name="add" size={15} />
              {strings.createCat}
            </button>
          )}
        </div>

        {creatingCat && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
              padding: 10,
              borderRadius: 11,
              background: "var(--panel-2)",
              border: "1px solid var(--line)",
              flexWrap: "wrap",
            }}
          >
            <input
              value={newCatLabel}
              onChange={(e) => setNewCatLabel(e.target.value)}
              placeholder={strings.catNamePh}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitNewCategory();
                }
              }}
              style={{ flex: "1 1 140px", minWidth: 120 }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              {CATEGORY_COLOR_TOKENS.map((tok) => {
                const hex = categoryColorHex(tok);
                return (
                  <button
                    key={tok}
                    type="button"
                    aria-label={tok}
                    onClick={() => setNewCatColor(tok)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: hex,
                      border: newCatColor === tok ? "2px solid var(--ink)" : "2px solid transparent",
                      boxShadow: newCatColor === tok ? "0 0 0 2px #fff inset" : undefined,
                      cursor: "pointer",
                    }}
                  />
                );
              })}
            </div>
            <button
              type="button"
              className="vbtn vbtn-primary vbtn-sm"
              disabled={!newCatLabel.trim() || savingCat}
              onClick={() => void submitNewCategory()}
            >
              <MSym name="check" size={16} />
              {strings.catSave}
            </button>
            <button
              type="button"
              className="vbtn vbtn-ghost vbtn-sm"
              onClick={() => {
                setCreatingCat(false);
                setNewCatLabel("");
              }}
            >
              {strings.cancel}
            </button>
          </div>
        )}
      </div>

      <div className="vfield" style={{ marginBottom: 0 }}>
        <label htmlFor="lead-note">{strings.note}</label>
        <textarea id="lead-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={strings.notePh} rows={2} />
      </div>
    </Modal>
  );
}
