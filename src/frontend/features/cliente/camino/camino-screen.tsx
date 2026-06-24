"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/frontend/components/brand/icon";
import { IconTile } from "@/frontend/components/brand/icon-tile";
import { Card } from "@/frontend/components/brand/card";
import { ProgressRing } from "@/frontend/components/brand/progress-ring";
import { Tutorial } from "@/frontend/components/mobile";

/**
 * CaminoScreen — `/caso/[caseId]/camino` (DOC-51 §13, prototype `screens1.jsx →
 * CaminoScreen`). The case "home" tab.
 *
 * Client component (the first-visit Tutorial overlay needs effects + refs). All
 * data is resolved server-side and passed as props. The single "Tu siguiente
 * paso" CTA routes to Documents (docs pending) or the form wizard (docs done).
 */

const BRAND_NAVY = "var(--brand-navy)";

export interface CaminoLabels {
  backCases: string;
  encourageSuffix: string;
  phaseChip: string; // "Fase {x} de {y}"
  nextStep: string;
  nextDocsTitle: string; // "Sube {n} documentos de {phase}"
  nextDocsBody: string;
  nextFormTitle: string;
  nextFormBody: string;
  continue: string;
  myProcess: string;
  view: string;
  inProgressSuffix: string; // "· en curso"
  nextMeeting: string;
  deliveryEstimate: string; // "Entrega estimada"
  documents: string;
  documentsValue: string; // "{x} de {y} completados"
  forms: string;
  formsValue: string; // "{n} pendiente"
  noMeeting: string;
}

export interface CaminoTutorialLabels {
  step1Title: string;
  step1Body: string;
  step2Title: string;
  step2Body: string;
  step3Title: string;
  step3Body: string;
  skip: string;
  next: string;
  done: string;
}

export interface CaminoScreenProps {
  caseId: string;
  serviceName: string;
  /** Localized h1, e.g. "Caso de Mateo" (already interpolated). */
  caseTitle: string;
  partyInitial: string;
  fullServiceName: string;
  phaseIndex: number;
  phaseCount: number;
  phaseName: string;
  phaseDescription: string;
  progress: number;
  docsDone: number;
  docsTotal: number;
  docsPending: number;
  /** When true, all docs are done → next step is the form wizard. */
  docsComplete: boolean;
  /** First-visit (just accepted disclaimer) → fire the tutorial. */
  firstVisit: boolean;
  currentMilestoneLabel: string | null;
  /** Next scheduled appointment, already formatted (e.g. "12 jun, 2:00 PM"), or
   *  null when there is no upcoming cita. */
  nextMeetingValue?: string | null;
  /** Where the "Próxima cita" tile links: the cita detail when one exists,
   *  otherwise the scheduler. */
  nextMeetingHref?: string;
  /** Estimated delivery in weeks (already formatted, e.g. "~12 semanas"), or null. */
  deliveryLabel?: string | null;
  labels: CaminoLabels;
  tutorialLabels: CaminoTutorialLabels;
}

export function CaminoScreen(props: CaminoScreenProps) {
  const {
    caseId,
    serviceName,
    caseTitle,
    partyInitial,
    fullServiceName,
    phaseIndex,
    phaseCount,
    phaseName,
    phaseDescription,
    progress,
    docsDone,
    docsTotal,
    docsPending,
    docsComplete,
    firstVisit,
    currentMilestoneLabel,
    nextMeetingValue,
    nextMeetingHref,
    deliveryLabel,
    labels,
    tutorialLabels,
  } = props;

  const router = useRouter();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const ctaRef = React.useRef<HTMLDivElement>(null);
  const [tutorialOpen, setTutorialOpen] = React.useState(false);

  // First arrival after the disclaimer → tutorial (~480ms after mount, §13).
  React.useEffect(() => {
    if (!firstVisit) return;
    const t = setTimeout(() => setTutorialOpen(true), 480);
    return () => clearTimeout(t);
  }, [firstVisit]);

  const nextHref = docsComplete
    ? `/caso/${caseId}/historia`
    : `/caso/${caseId}/documentos`;

  const tutorialSteps = [
    {
      title: tutorialLabels.step1Title,
      body: tutorialLabels.step1Body,
      targetRef: ctaRef as React.RefObject<HTMLElement | null>,
    },
    { title: tutorialLabels.step2Title, body: tutorialLabels.step2Body },
    { title: tutorialLabels.step3Title, body: tutorialLabels.step3Body },
  ];

  return (
    <div
      ref={containerRef}
      style={{
        minHeight: "100dvh",
        padding: "54px 20px var(--screen-pb)",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      <Link
        href="/home"
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
        <Icon name="chevL" size={18} color="var(--accent)" /> {labels.backCases}
      </Link>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink-2)", fontSize: 15, fontWeight: 600 }}>
            {serviceName}
          </div>
          <h1
            className="t-black"
            style={{ margin: "2px 0 0", fontSize: 29, color: "var(--navy)" }}
          >
            {caseTitle}
          </h1>
        </div>
        <div
          style={{
            width: 50,
            height: 50,
            borderRadius: 999,
            background: `linear-gradient(135deg, var(--accent), ${BRAND_NAVY})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            color: "#fff",
            fontSize: 19,
            flexShrink: 0,
          }}
        >
          {partyInitial}
        </div>
      </div>

      <p
        style={{
          margin: "0 0 18px",
          color: "var(--ink-2)",
          fontSize: 16,
          fontWeight: 500,
        }}
      >
        {labels.encourageSuffix.split("{service}")[0]}
        <strong style={{ color: "var(--navy)" }}>{fullServiceName}</strong>
        {labels.encourageSuffix.split("{service}")[1]}
      </p>

      {/* Phase card */}
      <Card
        glow="var(--accent)"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 22,
          padding: 18,
        }}
      >
        <ProgressRing pct={progress} size={84} stroke={10} />
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "var(--gold-soft)",
              color: "var(--gold-deep)",
              borderRadius: 999,
              padding: "5px 11px",
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            <Icon name="map" size={15} color="var(--gold-deep)" />{" "}
            {labels.phaseChip
              .replace("{x}", String(phaseIndex))
              .replace("{y}", String(phaseCount))}
          </div>
          <div
            className="t-title"
            style={{
              fontSize: 19,
              color: "var(--navy)",
              marginTop: 7,
              fontWeight: 700,
            }}
          >
            {phaseName}
          </div>
          <div style={{ fontSize: 14, color: "var(--ink-2)", fontWeight: 500 }}>
            {phaseDescription}
          </div>
        </div>
      </Card>

      {/* CTA "Tu siguiente paso" */}
      <div
        ref={ctaRef}
        style={{
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(135deg, var(--accent), var(--accent-deep))",
          borderRadius: 24,
          padding: 20,
          marginBottom: 18,
          boxShadow:
            "0 18px 40px color-mix(in srgb, var(--accent) 30%, transparent)",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -26,
            top: -26,
            width: 130,
            height: 130,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)",
          }}
        />
        <div style={{ position: "relative" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(255,255,255,0.18)",
              color: "#fff",
              borderRadius: 999,
              padding: "5px 12px",
              fontSize: 12.5,
              fontWeight: 800,
              marginBottom: 12,
            }}
          >
            <Icon name="sparkle" size={15} color="#fff" /> {labels.nextStep}
          </div>
          <h2
            className="t-title"
            style={{
              margin: "0 0 5px",
              fontSize: 22,
              color: "#fff",
              fontWeight: 800,
              lineHeight: 1.2,
              textWrap: "balance",
            }}
          >
            {docsComplete
              ? labels.nextFormTitle
              : labels.nextDocsTitle
                  .replace("{n}", String(docsPending))
                  .replace("{phase}", phaseName)}
          </h2>
          <p
            style={{
              margin: "0 0 16px",
              fontSize: 15,
              color: "rgba(255,255,255,0.82)",
              fontWeight: 500,
              lineHeight: 1.45,
            }}
          >
            {docsComplete ? labels.nextFormBody : labels.nextDocsBody}
          </p>
          <button
            type="button"
            onClick={() => router.push(nextHref)}
            className="mp-pop"
            style={{
              width: "100%",
              height: 54,
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              background: "#fff",
              color: "var(--accent)",
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 17,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {labels.continue}{" "}
            <Icon name="chevR" size={20} color="var(--accent)" stroke={2.6} />
          </button>
        </div>
      </div>

      {/* "Mi proceso" strip */}
      <Link
        href={`/caso/${caseId}/proceso`}
        className="mp-lift"
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          background: "var(--card)",
          borderRadius: 20,
          padding: "15px 16px",
          marginBottom: 18,
          boxShadow: "var(--shadow-soft)",
          textDecoration: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 13,
          }}
        >
          <span
            className="t-title"
            style={{
              fontSize: 16.5,
              color: "var(--navy)",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Icon name="route" size={19} color="var(--accent)" />
            {labels.myProcess}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              color: "var(--accent)",
              fontSize: 13.5,
              fontWeight: 800,
            }}
          >
            {labels.view}
            <Icon name="chevR" size={15} color="var(--accent)" />
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          {[0, 1, 2, 3].map((i) => (
            <React.Fragment key={i}>
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: i === 0 ? "var(--accent)" : "var(--line)",
                  boxShadow:
                    i === 0
                      ? "0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)"
                      : "none",
                }}
              />
              {i < 3 && (
                <span
                  style={{
                    flex: 1,
                    height: 3,
                    background: "var(--line)",
                    borderRadius: 999,
                  }}
                />
              )}
            </React.Fragment>
          ))}
        </div>
        {currentMilestoneLabel && (
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              fontWeight: 600,
              marginTop: 9,
            }}
          >
            {currentMilestoneLabel} {labels.inProgressSuffix}
          </div>
        )}
      </Link>

      {/* Secondary tiles */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {[
          {
            href: nextMeetingHref ?? `/caso/${caseId}/agendar`,
            icon: "calendar" as const,
            color: "var(--accent)",
            label: labels.nextMeeting,
            value: nextMeetingValue ?? labels.noMeeting,
          },
          {
            href: `/caso/${caseId}/documentos`,
            icon: "doc" as const,
            color: "var(--green)",
            label: labels.documents,
            value: labels.documentsValue
              .replace("{x}", String(docsDone))
              .replace("{y}", String(docsTotal)),
          },
          {
            href: `/caso/${caseId}/historia`,
            icon: "form" as const,
            color: "var(--gold)",
            label: labels.forms,
            value: labels.formsValue.replace("{n}", "1"),
          },
          ...(deliveryLabel
            ? [
                {
                  href: `/caso/${caseId}/proceso`,
                  icon: "trophy" as const,
                  color: "var(--gold-deep)",
                  label: labels.deliveryEstimate,
                  value: deliveryLabel,
                },
              ]
            : []),
        ].map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="mp-tap"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 13,
              background: "var(--card)",
              borderRadius: 18,
              padding: "13px 15px",
              cursor: "pointer",
              textAlign: "left",
              width: "100%",
              boxShadow: "var(--shadow-soft)",
              textDecoration: "none",
            }}
          >
            <IconTile name={r.icon} color={r.color} size={42} radius={12} iconSize={22} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 700 }}>
                {r.label}
              </div>
              <div
                className="t-title"
                style={{ fontSize: 15.5, color: "var(--navy)", fontWeight: 700 }}
              >
                {r.value}
              </div>
            </div>
            <Icon name="chevR" size={19} color="var(--ink-3)" />
          </Link>
        ))}
      </div>

      <Tutorial
        open={tutorialOpen}
        steps={tutorialSteps}
        labels={{
          skip: tutorialLabels.skip,
          next: tutorialLabels.next,
          done: tutorialLabels.done,
        }}
        containerRef={containerRef}
        onClose={() => setTutorialOpen(false)}
      />
    </div>
  );
}
