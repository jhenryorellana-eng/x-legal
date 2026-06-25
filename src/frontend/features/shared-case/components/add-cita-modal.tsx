"use client";

/**
 * "Añadir cita" modal (DOC-52 §5.5) — staff adds an INTERMEDIATE cita to a single
 * case's current phase. The objectives list pre-fills with the UNMET objectives of
 * the previous cita (editable); staff can add/remove rows and a bilingual title.
 * On confirm it calls actions.addCaseAppointment and the route + the client's
 * "Mi proceso" cronograma pick up the new cita.
 */

import * as React from "react";
import { Modal } from "@/frontend/components/desktop/modal";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { Icon } from "@/frontend/components/brand/icon";
import type { CasosStrings } from "../strings";

interface ObjectiveDraft {
  es: string;
  en: string;
}

export function AddCitaModal({
  open,
  onClose,
  onSubmit,
  strings,
  prefill,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: {
    label: { es: string; en: string } | null;
    objectives: Array<{ text: { es: string; en: string } }>;
  }) => void;
  strings: CasosStrings;
  /** Unmet objectives from the previous cita ({es,en}), used as the initial rows. */
  prefill: ObjectiveDraft[];
  busy: boolean;
}) {
  const t = strings.detail;
  const [labelEs, setLabelEs] = React.useState("");
  const [labelEn, setLabelEn] = React.useState("");
  const [objectives, setObjectives] = React.useState<ObjectiveDraft[]>([]);

  // Reset the form each time the modal opens, seeding the unmet objectives.
  React.useEffect(() => {
    if (open) {
      setLabelEs("");
      setLabelEn("");
      setObjectives(prefill.length > 0 ? prefill.map((o) => ({ ...o })) : [{ es: "", en: "" }]);
    }
  }, [open, prefill]);

  function updateObjective(i: number, patch: Partial<ObjectiveDraft>) {
    setObjectives((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }
  function addObjective() {
    setObjectives((prev) => [...prev, { es: "", en: "" }]);
  }
  function removeObjective(i: number) {
    setObjectives((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleSubmit() {
    const cleaned = objectives
      .map((o) => ({ es: o.es.trim(), en: o.en.trim() }))
      .filter((o) => o.es.length > 0 || o.en.length > 0)
      // Mirror a single-language entry into the other so i18n parity holds.
      .map((o) => ({ text: { es: o.es || o.en, en: o.en || o.es } }));
    const label =
      labelEs.trim() || labelEn.trim()
        ? { es: labelEs.trim() || labelEn.trim(), en: labelEn.trim() || labelEs.trim() }
        : null;
    onSubmit({ label, objectives: cleaned });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t.routeAddCitaTitle}
      description={t.routeAddCitaSub}
      width={620}
      footer={
        <>
          <GhostBtn size="md" full={false} onClick={onClose}>
            {t.routeAddCitaCancel}
          </GhostBtn>
          <GradientBtn size="md" full={false} icon="plus" disabled={busy} onClick={handleSubmit}>
            {busy ? t.routeAddCitaSaving : t.routeAddCitaSave}
          </GradientBtn>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <TextField
          label={t.routeAddCitaLabelEs}
          value={labelEs}
          onChange={setLabelEs}
          placeholder={t.routeAddCitaLabelPlaceholder}
        />
        <TextField
          label={t.routeAddCitaLabelEn}
          value={labelEn}
          onChange={setLabelEn}
          placeholder={t.routeAddCitaLabelPlaceholder}
        />
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>
            {t.routeAddCitaObjectives}
          </span>
        </div>
        {prefill.length > 0 && (
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
            {t.routeAddCitaPrefillNote}
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {objectives.map((o, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr auto",
                gap: 8,
                alignItems: "center",
              }}
            >
              <TextField
                label={i === 0 ? t.routeAddCitaObjectiveEs : undefined}
                value={o.es}
                onChange={(v) => updateObjective(i, { es: v })}
              />
              <TextField
                label={i === 0 ? t.routeAddCitaObjectiveEn : undefined}
                value={o.en}
                onChange={(v) => updateObjective(i, { en: v })}
              />
              <button
                type="button"
                aria-label={t.routeRemoveObjective}
                onClick={() => removeObjective(i)}
                style={{
                  display: "inline-grid",
                  placeItems: "center",
                  width: 36,
                  height: 36,
                  marginTop: i === 0 ? 22 : 0,
                  borderRadius: 999,
                  border: "1px solid var(--line)",
                  background: "var(--chip)",
                  color: "var(--ink-2)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <Icon name="x" size={16} color="currentColor" />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addObjective}
          style={{
            marginTop: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: "1px dashed var(--line)",
            background: "transparent",
            color: "var(--accent)",
            borderRadius: 10,
            padding: "8px 14px",
            fontWeight: 800,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <Icon name="plus" size={16} color="var(--accent)" />
          {t.routeAddObjective}
        </button>
      </div>
    </Modal>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      {label && (
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink-2)" }}>{label}</span>
      )}
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          borderRadius: 12,
          border: "1px solid var(--line)",
          background: "var(--card)",
          color: "var(--ink)",
          padding: "10px 12px",
          fontSize: 14,
          fontFamily: "var(--font-body)",
          width: "100%",
          boxSizing: "border-box",
        }}
      />
    </label>
  );
}
