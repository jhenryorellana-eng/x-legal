"use client";

/**
 * Ruta de citas (DOC-52 §5.5) — the appointment route of the case's CURRENT
 * phase, mirroring the `UI Vanessa` prototype (WSRuta): a cita stepper + a grid
 * of cards (numbered dot / ✓, "Cita N", subtitle, "En curso"/"Completada" chip,
 * objectives checklist). Staff can add an intermediate cita (with objectives
 * pre-filled from the previous cita's unmet ones); it appears here and in the
 * client's "Mi proceso" cronograma.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { Icon } from "@/frontend/components/brand/icon";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import { toast } from "@/frontend/components/desktop/toast";
import type { CaseWorkspaceVM, CaseDetailActions, RutaCitaVM } from "../types";
import type { CasosStrings } from "../strings";
import { SectionLabel } from "../ui";
import { interp } from "../strings";
import { AddCitaModal } from "./add-cita-modal";

export function RutaCitas({
  vm,
  actions,
  strings,
}: {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
}) {
  const t = strings.detail;
  const router = useRouter();
  const ruta = vm.ruta ?? null;
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const canAdd = typeof actions.addCaseAppointment === "function";

  // Pre-fill = the UNMET objectives of the most recent completed cita.
  const prefill = React.useMemo(() => {
    if (!ruta) return [];
    const completed = [...ruta.citas].reverse().find((c) => c.status === "completed");
    if (!completed) return [];
    return completed.objectives
      .filter((o) => o.achieved === false)
      .map((o) => ({ es: o.textI18n.es, en: o.textI18n.en }));
  }, [ruta]);

  async function handleAdd(input: {
    label: { es: string; en: string } | null;
    objectives: Array<{ text: { es: string; en: string } }>;
  }) {
    if (!actions.addCaseAppointment) return;
    setBusy(true);
    const res = await actions.addCaseAppointment({
      caseId: vm.header.caseId,
      label: input.label,
      objectives: input.objectives,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(t.routeAddCitaDone);
      setOpen(false);
      router.refresh();
    } else {
      toast.error(t.routeAddCitaError);
    }
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <SectionLabel icon="route">{t.routeTitle}</SectionLabel>
        {canAdd && ruta && ruta.total > 0 && (
          <GradientBtn size="sm" full={false} icon="plus" onClick={() => setOpen(true)}>
            {t.routeAddCita}
          </GradientBtn>
        )}
      </div>

      {!ruta || ruta.total === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title={t.routeNoCitas} mood="calma" lexSize={96} />
          {canAdd && ruta && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
              <GradientBtn size="md" full={false} icon="plus" onClick={() => setOpen(true)}>
                {t.routeAddCita}
              </GradientBtn>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Cita stepper */}
          <div style={{ marginTop: 18, overflowX: "auto", paddingBottom: 4 }}>
            <CitaStepper citas={ruta.citas} strings={strings} />
          </div>

          {/* Cita cards */}
          <div
            style={{
              marginTop: 20,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 16,
              alignItems: "start",
            }}
          >
            {ruta.citas.map((c) => (
              <CitaCard key={c.sequenceNumber} cita={c} strings={strings} />
            ))}
          </div>
        </>
      )}

      <AddCitaModal
        open={open}
        onClose={() => setOpen(false)}
        onSubmit={handleAdd}
        strings={strings}
        prefill={prefill}
        busy={busy}
      />
    </Card>
  );
}

function CitaStepper({ citas, strings }: { citas: RutaCitaVM[]; strings: CasosStrings }) {
  const t = strings.detail;
  return (
    <div className="stepper">
      {citas.map((c, i) => {
        const state = c.status === "completed" ? "done" : c.status === "current" ? "cur" : "";
        return (
          <React.Fragment key={c.sequenceNumber}>
            <div className={`step ${state}`}>
              <div className="step-dot">
                {c.status === "completed" ? (
                  <Icon name="check" size={18} color="#fff" />
                ) : (
                  c.sequenceNumber
                )}
              </div>
              <div className="step-lbl">{interp(t.routeCita, { n: String(c.sequenceNumber) })}</div>
              {c.label && <div className="step-sub">{c.label}</div>}
            </div>
            {i < citas.length - 1 && (
              <div className={`step-line ${c.status === "completed" ? "done" : ""}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function CitaCard({ cita, strings }: { cita: RutaCitaVM; strings: CasosStrings }) {
  const t = strings.detail;
  const isDone = cita.status === "completed";
  const isCur = cita.status === "current";
  const dotBg = isDone ? "var(--brand-green)" : isCur ? "var(--accent)" : "var(--chip)";
  const dotColor = isDone || isCur ? "#fff" : "var(--ink-3)";

  return (
    <Card
      style={
        isCur
          ? { border: "1px solid var(--accent)", boxShadow: "0 0 0 1px var(--accent)" }
          : { border: "1px solid var(--line)" }
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            fontWeight: 900,
            fontSize: 13,
            background: dotBg,
            color: dotColor,
            border: isDone || isCur ? "none" : "2px solid var(--line)",
            flexShrink: 0,
          }}
        >
          {isDone ? <Icon name="check" size={17} color="#fff" /> : cita.sequenceNumber}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 900, fontSize: 14, color: "var(--ink)" }}>
            {interp(t.routeCita, { n: String(cita.sequenceNumber) })}
          </div>
          {cita.label && (
            <div
              style={{
                fontSize: 11.5,
                color: "var(--ink-3)",
                fontWeight: 800,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {cita.label}
            </div>
          )}
        </div>
        {isCur && <Chip tone="blue">{t.routeEnCurso}</Chip>}
        {isDone && <Chip tone="green">{t.routeCompletada}</Chip>}
        {cita.status === "upcoming" && <Chip tone="gold">{t.routeProxima}</Chip>}
      </div>

      {cita.objectives.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>
          {t.routeObjectivesEmpty}
        </p>
      ) : (
        cita.objectives.map((o) => {
          const achieved = o.achieved === true || (isDone && o.achieved !== false);
          return (
            <div
              key={o.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "7px 0",
                fontSize: 13,
                fontWeight: 700,
                color: isDone ? "var(--ink-3)" : "var(--ink-2)",
              }}
            >
              <ObjectiveDot achieved={achieved} />
              <span style={{ flex: 1 }}>{o.text}</span>
            </div>
          );
        })
      )}
    </Card>
  );
}

/** Green check when achieved, hollow circle otherwise (mirrors the prototype). */
function ObjectiveDot({ achieved }: { achieved: boolean }) {
  if (achieved) {
    return (
      <span
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "var(--brand-green)",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <Icon name="check" size={12} color="#fff" stroke={2.6} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        border: "2px solid var(--line)",
        flexShrink: 0,
      }}
    />
  );
}
