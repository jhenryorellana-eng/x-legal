"use client";

import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/frontend/components/brand/icon";
import { StatusPill } from "@/frontend/components/brand/status-pill";
import { ProgressBar } from "@/frontend/components/brand/progress-bar";
import { BottomSheet } from "@/frontend/components/mobile";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";

/**
 * ProcesoScreen — `/caso/[caseId]/proceso` (DOC-51 §22, prototype `screens4.jsx →
 * ProcessScreen`). Single vertical timeline that interleaves legal milestones and
 * scheduled citas, in the prototype's visual language (48px discs + cards + states
 * + glossary bottom sheet). Milestone/appointment states are resolved server-side.
 */

export type ProcesoTimelineItem =
  | {
      kind: "milestone";
      id: string;
      title: string;
      description: string;
      icon: IconName;
      state: "completed" | "current" | "next" | "locked";
      progress: number | null;
      weekLabel: string | null;
      glossary: { term: string; body: string } | null;
    }
  | {
      kind: "appointment";
      id: string;
      title: string;
      status: "completed" | "booked" | "unbooked";
      weekLabel: string;
      dateLabel: string | null;
      href: string;
    };

export interface ProcesoLabels {
  back: string;
  title: string; // "Tu proceso avanza, {name}"
  subtitle: string; // "Estás en la Fase {x} de {y}. Vas muy bien."
  inProgress: string;
  next: string;
  progress: string;
  completed: string;
  whatDoesThisMean: string;
  gotIt: string;
  whatsNext: string;
  whatsNextBody: string;
  appointmentPill: string; // "Cita"
  appointmentDone: string; // "Cita completada"
  book: string; // "Agendar"
  deliveryEstimate: string; // "Entrega estimada del expediente"
  totalWeeksLabel: string; // "~N semanas"
  notStarted: string | null; // "Comienza al activar tu caso" or null when started
}

const ACCENT = "var(--accent)";
const GREEN = "var(--green)";

export function ProcesoScreen({
  caseId,
  items,
  labels,
}: {
  caseId: string;
  items: ProcesoTimelineItem[];
  labels: ProcesoLabels;
}) {
  void caseId;
  const [glossary, setGlossary] = React.useState<{ term: string; body: string } | null>(null);

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 20px var(--screen-pb)",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      <Link
        href={`/caso/${caseId}/mas`}
        className="mp-tap"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--accent)",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 15,
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        <Icon name="chevL" size={18} color="var(--accent)" /> {labels.back}
      </Link>
      <h1
        className="t-black"
        style={{ margin: "0 0 4px", fontSize: 27, color: "var(--navy)", textWrap: "balance" }}
      >
        {labels.title}
      </h1>
      <p style={{ margin: "0 0 18px", fontSize: 15.5, color: "var(--ink-2)", fontWeight: 600 }}>
        {labels.subtitle}
      </p>

      <div style={{ position: "relative" }}>
        <div
          style={{
            position: "absolute",
            left: 23,
            top: 24,
            bottom: 70,
            width: 2.5,
            background: "var(--line)",
            borderRadius: 999,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {items.map((it) =>
            it.kind === "milestone" ? (
              <MilestoneRow key={it.id} item={it} labels={labels} onGlossary={setGlossary} />
            ) : (
              <AppointmentRow key={it.id} item={it} labels={labels} />
            ),
          )}

          {/* Trophy / delivery estimate */}
          <div style={{ display: "flex", gap: 15, alignItems: "center" }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                flexShrink: 0,
                zIndex: 1,
                background: "var(--gold-soft)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 0 4px color-mix(in srgb, var(--gold) 20%, transparent)",
              }}
            >
              <Icon name="trophy" size={24} color="var(--gold-deep)" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                className="t-title"
                style={{ fontSize: 18, color: "var(--gold-deep)", fontWeight: 800 }}
              >
                {labels.completed}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 600, marginTop: 2 }}>
                {labels.deliveryEstimate}:{" "}
                {labels.notStarted
                  ? `${labels.notStarted} · ${labels.totalWeeksLabel}`
                  : labels.totalWeeksLabel}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 20,
          background: "var(--blue-soft)",
          borderRadius: 20,
          padding: 18,
          display: "flex",
          gap: 13,
          alignItems: "flex-start",
        }}
      >
        <Icon name="info" size={22} color="var(--accent)" />
        <div>
          <div className="t-title" style={{ fontSize: 16, color: "var(--navy)", fontWeight: 700 }}>
            {labels.whatsNext}
          </div>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 14.5,
              color: "var(--ink-2)",
              fontWeight: 500,
              lineHeight: 1.45,
            }}
          >
            {labels.whatsNextBody}
          </p>
        </div>
      </div>

      <BottomSheet
        open={glossary != null}
        onClose={() => setGlossary(null)}
        title={glossary?.term ?? ""}
        hideHeader
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 13,
              background: "var(--blue-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="help" size={24} color="var(--accent)" />
          </div>
          <h3 className="t-title" style={{ margin: 0, fontSize: 20, color: "var(--navy)", fontWeight: 800 }}>
            {glossary?.term}
          </h3>
        </div>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 16,
            color: "var(--ink-2)",
            fontWeight: 500,
            lineHeight: 1.55,
            textWrap: "pretty",
          }}
        >
          {glossary?.body}
        </p>
        <GradientBtn c1="#2F6BFF" c2="#002855" onClick={() => setGlossary(null)}>
          {labels.gotIt}
        </GradientBtn>
      </BottomSheet>
    </div>
  );
}

/** Shared 48px timeline disc. */
function Disc({
  filled,
  ring,
  pulse,
  children,
}: {
  filled: string | null; // fill color, or null for card bg
  ring: string | null; // border color, or null
  pulse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: 999,
        flexShrink: 0,
        zIndex: 1,
        background: filled ?? "var(--card)",
        border: ring ? `2.5px solid ${ring}` : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: filled ? `0 8px 18px color-mix(in srgb, ${filled} 33%, transparent)` : "none",
        animation: pulse ? "ringPulse 2.4s ease-out infinite" : "none",
      }}
    >
      {children}
    </div>
  );
}

function MilestoneRow({
  item,
  labels,
  onGlossary,
}: {
  item: Extract<ProcesoTimelineItem, { kind: "milestone" }>;
  labels: ProcesoLabels;
  onGlossary: (g: { term: string; body: string }) => void;
}) {
  const curso = item.state === "current";
  const sig = item.state === "next";
  const bloq = item.state === "locked";
  const done = item.state === "completed";

  const disc = done ? (
    <Disc filled={GREEN} ring={null}>
      <Icon name="check" size={23} color="#fff" stroke={2.6} />
    </Disc>
  ) : curso ? (
    <Disc filled={ACCENT} ring={null} pulse>
      <Icon name={item.icon} size={23} color="#fff" stroke={2.4} />
    </Disc>
  ) : bloq ? (
    <Disc filled={null} ring="var(--line)">
      <Icon name="lock" size={19} color="var(--ink-3)" />
    </Disc>
  ) : (
    <Disc filled={null} ring="color-mix(in srgb, var(--accent) 33%, transparent)">
      <Icon name={item.icon} size={23} color="var(--accent)" stroke={2.4} />
    </Disc>
  );

  return (
    <div style={{ display: "flex", gap: 15, position: "relative" }}>
      {disc}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: "var(--card)",
          borderRadius: 18,
          padding: "14px 16px",
          boxShadow: curso
            ? "0 14px 32px color-mix(in srgb, var(--accent) 15%, transparent)"
            : "var(--shadow-soft)",
          border: curso ? "2px solid var(--accent)" : "2px solid transparent",
          opacity: bloq ? 0.66 : 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
          {curso && <StatusPill kind="revision">{labels.inProgress}</StatusPill>}
          {sig && (
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 800,
                color: "var(--accent)",
                background: "var(--blue-soft)",
                borderRadius: 999,
                padding: "3px 9px",
              }}
            >
              {labels.next}
            </span>
          )}
          {done && <StatusPill kind="aprobado">{labels.completed}</StatusPill>}
          {item.weekLabel && (
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)" }}>
              {item.weekLabel}
            </span>
          )}
        </div>
        <div
          className="t-title"
          style={{
            fontSize: 16.5,
            color: bloq ? "var(--ink-2)" : "var(--navy)",
            fontWeight: 700,
            lineHeight: 1.2,
            textWrap: "balance",
          }}
        >
          {item.title}
        </div>
        {item.description && (
          <p style={{ margin: "5px 0 0", fontSize: 14, color: "var(--ink-2)", fontWeight: 500, lineHeight: 1.4 }}>
            {item.description}
          </p>
        )}
        {curso && item.progress != null && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--navy)" }}>{labels.progress}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--gold-deep)" }}>{item.progress}%</span>
            </div>
            <ProgressBar pct={item.progress} />
          </div>
        )}
        {item.glossary && (
          <button
            type="button"
            onClick={() => item.glossary && onGlossary(item.glossary)}
            className="mp-tap"
            style={{
              marginTop: 9,
              background: "none",
              border: "none",
              display: "flex",
              alignItems: "center",
              gap: 5,
              color: "var(--accent)",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
              padding: 0,
              fontFamily: "var(--font-title)",
            }}
          >
            <Icon name="help" size={15} color="var(--accent)" />
            {labels.whatDoesThisMean}
          </button>
        )}
      </div>
    </div>
  );
}

function AppointmentRow({
  item,
  labels,
}: {
  item: Extract<ProcesoTimelineItem, { kind: "appointment" }>;
  labels: ProcesoLabels;
}) {
  const done = item.status === "completed";
  const booked = item.status === "booked";

  const disc = done ? (
    <Disc filled={GREEN} ring={null}>
      <Icon name="calendar" size={22} color="#fff" stroke={2.4} />
    </Disc>
  ) : booked ? (
    <Disc filled={ACCENT} ring={null}>
      <Icon name="calendar" size={22} color="#fff" stroke={2.4} />
    </Disc>
  ) : (
    <Disc filled={null} ring="color-mix(in srgb, var(--accent) 33%, transparent)">
      <Icon name="calendar" size={22} color="var(--accent)" stroke={2.4} />
    </Disc>
  );

  return (
    <div style={{ display: "flex", gap: 15, position: "relative" }}>
      {disc}
      <Link
        href={item.href}
        className="mp-lift"
        style={{
          flex: 1,
          minWidth: 0,
          background: "var(--card)",
          borderRadius: 18,
          padding: "14px 16px",
          boxShadow: "var(--shadow-soft)",
          textDecoration: "none",
          border: "2px solid transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 800,
              color: "var(--gold-deep)",
              background: "var(--gold-soft)",
              borderRadius: 999,
              padding: "3px 9px",
            }}
          >
            {labels.appointmentPill}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)" }}>{item.weekLabel}</span>
        </div>
        <div
          className="t-title"
          style={{ fontSize: 16.5, color: "var(--navy)", fontWeight: 700, lineHeight: 1.2, textWrap: "balance" }}
        >
          {item.title}
        </div>
        <div
          style={{
            marginTop: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {done ? (
            <span style={{ color: "var(--green)" }}>
              {labels.appointmentDone}
              {item.dateLabel ? ` · ${item.dateLabel}` : ""}
            </span>
          ) : booked && item.dateLabel ? (
            <span style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="clock" size={14} color="var(--accent)" />
              {item.dateLabel}
            </span>
          ) : (
            <span style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="calendar" size={14} color="var(--accent)" />
              {labels.book}
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}
