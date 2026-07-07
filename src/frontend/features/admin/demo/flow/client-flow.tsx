"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import type { IconName } from "@/frontend/components/brand";
import { PhoneFrame } from "../phone-frame";
import { DemoBottomNav } from "../components/demo-bottom-nav";
import { SuccessOverlay } from "../components/success-overlay";
import { ProcessingOverlay } from "../components/processing-overlay";
import type { DemoFlow } from "./use-demo-flow";
import { CasesStage } from "./stages/cases-stage";
import { SigningStage } from "./stages/signing-stage";
import { PagosStage } from "./stages/pagos-stage";
import { DisclaimerStage } from "./stages/disclaimer-stage";
import { DocumentosStage } from "./stages/documentos-stage";
import { FormulariosStage } from "./stages/formularios-stage";
import { CitasStage } from "./stages/citas-stage";
import { FormReview } from "./stages/form-review";

export interface DemoService {
  label: string;
  icon: IconName;
  colorKey: string;
}

/**
 * ClientFlow — assembles the phone: the scrolling stage content, the pinned
 * bottom nav (per stage), and the success / processing / review overlays. The
 * stage wrapper re-keys on `stage` to replay the slide-in entrance.
 */
export function ClientFlow({ flow, service }: { flow: DemoFlow; service: DemoService }) {
  const t = useTranslations("staff.demo");
  const { state, actions, scenario } = flow;

  const content = (() => {
    switch (state.stage) {
      case "cases":
        return <CasesStage flow={flow} service={service} />;
      case "signing":
        return <SigningStage flow={flow} />;
      case "pagos":
        return <PagosStage flow={flow} />;
      case "disclaimer":
        return <DisclaimerStage flow={flow} />;
      case "caseDocs":
        return <DocumentosStage flow={flow} />;
      case "caseForms":
        return <FormulariosStage flow={flow} />;
      case "caseCitas":
        return <CitasStage flow={flow} advisorName={scenario.staff.owner.name} />;
      default:
        return null;
    }
  })();

  const footer = (() => {
    if (state.stage === "cases") {
      return (
        <DemoBottomNav
          variant="cuenta"
          active="casos"
          enabled={state.signed ? ["casos", "pagos"] : ["casos"]}
          onNavigate={(id) => {
            if (id === "pagos") actions.goPay();
          }}
        />
      );
    }
    if (state.stage === "pagos") {
      return (
        <DemoBottomNav
          variant="cuenta"
          active="pagos"
          enabled={["casos", "pagos"]}
          onNavigate={(id) => {
            if (id === "casos") actions.goCases();
          }}
        />
      );
    }
    if (state.stage === "caseDocs" || state.stage === "caseForms" || state.stage === "caseCitas") {
      const active =
        state.stage === "caseForms" ? "formularios" : state.stage === "caseCitas" ? "citas" : "documentos";
      return (
        <DemoBottomNav
          variant="caso"
          active={active}
          enabled={["citas", "documentos", "formularios"]}
          onNavigate={(id) => {
            if (id === "citas") actions.tab("caseCitas");
            else if (id === "documentos") actions.tab("caseDocs");
            else if (id === "formularios") actions.tab("caseForms");
          }}
        />
      );
    }
    return null;
  })();

  // The reviewed form always belongs to the active phase (opening the review is
  // a per-phase action, and switching phase clears `reviewFormId`).
  const activePhase = scenario.phases[state.activePhaseIndex];
  const reviewForm = state.reviewFormId
    ? activePhase.forms.find((f) => `${activePhase.slug}:${f.id}` === state.reviewFormId) ?? null
    : null;

  const overlay = (
    <>
      {reviewForm && (
        <FormReview
          form={reviewForm}
          onClose={actions.closeReview}
          onSend={actions.sendForm}
          sendLabel={t("sendForm")}
          completeLabel={t("completeLabel")}
        />
      )}
      {state.overlay === "signSuccess" && (
        <SuccessOverlay
          title={t("successSignTitle")}
          body={t("successSignBody")}
          continueLabel={t("continue")}
          onContinue={actions.confirmSign}
        />
      )}
      {state.overlay === "payProcessing" && <ProcessingOverlay label={t("processing")} />}
      {state.overlay === "paySuccess" && (
        <SuccessOverlay
          title={t("successPayTitle")}
          body={t("successPayBody")}
          continueLabel={t("continue")}
          onContinue={actions.confirmPay}
        />
      )}
      {state.overlay === "disclaimerOk" && (
        <SuccessOverlay
          title={t("successDisclaimerTitle")}
          body={t("successDisclaimerBody")}
          continueLabel={t("continue")}
          onContinue={actions.enterCase}
          confetti={false}
        />
      )}
      {state.overlay === "docSuccess" && (
        <SuccessOverlay
          title={t("successDocTitle")}
          body={t("successDocBody")}
          continueLabel={t("continue")}
          onContinue={actions.confirmDoc}
        />
      )}
      {state.overlay === "formSent" && (
        <SuccessOverlay
          title={t("successFormTitle")}
          body={t("successFormBody")}
          continueLabel={t("continue")}
          onContinue={actions.confirmForm}
        />
      )}
      {state.overlay === "citaSuccess" && (
        <SuccessOverlay
          title={t("citas.successTitle")}
          body={t("citas.successBody", {
            date: state.bookedCita?.dateLabel ?? "",
            hour: state.bookedCita?.hourLabel ?? "",
          })}
          continueLabel={t("continue")}
          onContinue={actions.confirmCita}
        />
      )}
    </>
  );

  return (
    <PhoneFrame footer={footer} overlay={overlay}>
      {/* overflow-x: clip (with the default visible overflow-y) hard-clips
          decorative overflow like Lex's halo without creating a scroll axis. */}
      <div key={state.stage} className="demo-stage" style={{ minHeight: "100%", overflowX: "clip" }}>
        {content}
      </div>
    </PhoneFrame>
  );
}
