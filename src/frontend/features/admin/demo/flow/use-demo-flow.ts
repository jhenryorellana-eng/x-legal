"use client";

import * as React from "react";
import type { DemoScenario } from "../scenarios/types";

/**
 * Client-side state machine for the demo "Vista cliente" walkthrough.
 *
 * Everything is local and ephemeral — there is NO persistence and NO backend.
 * Success screens are modeled as `overlay`s (not stages) so the underlying
 * screen stays mounted behind them. Timed transitions (upload spinner, payment
 * processing) are scheduled here and cleared on reset/unmount so a re-run during
 * the live never fires a stale dispatch.
 */

export type DemoStage =
  | "cases"
  | "signing"
  | "pagos"
  | "disclaimer"
  | "caseDocs"
  | "caseForms"
  | "caseCitas";

export type DemoOverlay =
  | null
  | "signSuccess"
  | "payProcessing"
  | "paySuccess"
  | "disclaimerOk"
  | "docSuccess"
  | "formSent"
  | "citaSuccess";

/** The appointment the client "booked" in the Citas tab (pure UI, no backend). */
export interface BookedCita {
  dateLabel: string;
  hourLabel: string;
}

export type DocStatus = "pendiente" | "subiendo" | "subido";

export interface DemoFlowState {
  stage: DemoStage;
  overlay: DemoOverlay;
  signed: boolean;
  paid: boolean;
  docStatus: Record<string, DocStatus>;
  /** Doc currently uploading / target of the docSuccess overlay. */
  activeDocId: string | null;
  sentForms: string[];
  /** Form being reviewed (full-screen panel over the forms stage). */
  reviewFormId: string | null;
  /** Confirmed appointment; drives the "cita agendada" state of the Citas tab. */
  bookedCita: BookedCita | null;
}

type Action =
  | { type: "reset"; scenario: DemoScenario }
  | { type: "go"; stage: DemoStage }
  | { type: "signSuccess" }
  | { type: "confirmSign" }
  | { type: "payProcessing" }
  | { type: "paySuccess" }
  | { type: "confirmPay" }
  | { type: "disclaimerOk" }
  | { type: "enterCase" }
  | { type: "tab"; stage: "caseDocs" | "caseForms" | "caseCitas" }
  | { type: "bookCita"; cita: BookedCita }
  | { type: "confirmCita" }
  | { type: "docUploading"; id: string }
  | { type: "docSuccess" }
  | { type: "confirmDoc" }
  | { type: "review"; id: string }
  | { type: "closeReview" }
  | { type: "formSent" }
  | { type: "confirmForm" };

function initialState(scenario: DemoScenario): DemoFlowState {
  const docStatus: Record<string, DocStatus> = {};
  for (const d of scenario.documents) docStatus[d.id] = "pendiente";
  return {
    stage: "cases",
    overlay: null,
    signed: false,
    paid: false,
    docStatus,
    activeDocId: null,
    sentForms: [],
    reviewFormId: null,
    bookedCita: null,
  };
}

function reducer(state: DemoFlowState, action: Action): DemoFlowState {
  switch (action.type) {
    case "go":
      return { ...state, stage: action.stage, overlay: null };
    case "signSuccess":
      return { ...state, overlay: "signSuccess" };
    case "confirmSign":
      return { ...state, stage: "cases", overlay: null, signed: true };
    case "payProcessing":
      return { ...state, overlay: "payProcessing" };
    case "paySuccess":
      return { ...state, overlay: "paySuccess" };
    case "confirmPay":
      return { ...state, stage: "cases", overlay: null, paid: true };
    case "disclaimerOk":
      return { ...state, overlay: "disclaimerOk" };
    case "enterCase":
      return { ...state, stage: "caseDocs", overlay: null };
    case "tab":
      return { ...state, stage: action.stage, overlay: null, reviewFormId: null };
    case "bookCita":
      return { ...state, overlay: "citaSuccess", bookedCita: action.cita };
    case "confirmCita":
      return { ...state, overlay: null };
    case "docUploading":
      return {
        ...state,
        activeDocId: action.id,
        docStatus: { ...state.docStatus, [action.id]: "subiendo" },
      };
    case "docSuccess":
      return { ...state, overlay: "docSuccess" };
    case "confirmDoc": {
      const id = state.activeDocId;
      if (!id) return { ...state, overlay: null };
      return {
        ...state,
        overlay: null,
        activeDocId: null,
        docStatus: { ...state.docStatus, [id]: "subido" },
      };
    }
    case "review":
      return { ...state, reviewFormId: action.id };
    case "closeReview":
      return { ...state, reviewFormId: null };
    case "formSent":
      return { ...state, overlay: "formSent" };
    case "confirmForm": {
      const id = state.reviewFormId;
      return {
        ...state,
        overlay: null,
        reviewFormId: null,
        sentForms: id && !state.sentForms.includes(id) ? [...state.sentForms, id] : state.sentForms,
      };
    }
    case "reset":
      return initialState(action.scenario);
    default:
      return state;
  }
}

export interface DemoFlowActions {
  reset: () => void;
  goCases: () => void;
  goSign: () => void;
  signContract: () => void;
  confirmSign: () => void;
  goPay: () => void;
  pay: () => void;
  confirmPay: () => void;
  openCase: () => void;
  acceptDisclaimer: () => void;
  enterCase: () => void;
  tab: (stage: "caseDocs" | "caseForms" | "caseCitas") => void;
  bookCita: (cita: BookedCita) => void;
  confirmCita: () => void;
  uploadDoc: (id: string) => void;
  confirmDoc: () => void;
  review: (id: string) => void;
  closeReview: () => void;
  sendForm: () => void;
  confirmForm: () => void;
}

export interface DemoFlow {
  state: DemoFlowState;
  actions: DemoFlowActions;
  scenario: DemoScenario;
}

const UPLOAD_MS = 1200;
const PAY_MS = 1700;

export function useDemoFlow(scenario: DemoScenario): DemoFlow {
  const [state, dispatch] = React.useReducer(reducer, scenario, initialState);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = React.useCallback(() => {
    for (const id of timers.current) clearTimeout(id);
    timers.current = [];
  }, []);

  const schedule = React.useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
  }, []);

  React.useEffect(() => clearTimers, [clearTimers]);

  const actions = React.useMemo<DemoFlowActions>(
    () => ({
      reset: () => {
        clearTimers();
        dispatch({ type: "reset", scenario });
      },
      goCases: () => dispatch({ type: "go", stage: "cases" }),
      goSign: () => dispatch({ type: "go", stage: "signing" }),
      signContract: () => dispatch({ type: "signSuccess" }),
      confirmSign: () => dispatch({ type: "confirmSign" }),
      goPay: () => dispatch({ type: "go", stage: "pagos" }),
      pay: () => {
        dispatch({ type: "payProcessing" });
        schedule(() => dispatch({ type: "paySuccess" }), PAY_MS);
      },
      confirmPay: () => dispatch({ type: "confirmPay" }),
      openCase: () => dispatch({ type: "go", stage: "disclaimer" }),
      acceptDisclaimer: () => dispatch({ type: "disclaimerOk" }),
      enterCase: () => dispatch({ type: "enterCase" }),
      tab: (stage) => dispatch({ type: "tab", stage }),
      bookCita: (cita) => dispatch({ type: "bookCita", cita }),
      confirmCita: () => dispatch({ type: "confirmCita" }),
      uploadDoc: (id) => {
        dispatch({ type: "docUploading", id });
        schedule(() => dispatch({ type: "docSuccess" }), UPLOAD_MS);
      },
      confirmDoc: () => dispatch({ type: "confirmDoc" }),
      review: (id) => dispatch({ type: "review", id }),
      closeReview: () => dispatch({ type: "closeReview" }),
      sendForm: () => dispatch({ type: "formSent" }),
      confirmForm: () => dispatch({ type: "confirmForm" }),
    }),
    [clearTimers, schedule, scenario],
  );

  return { state, actions, scenario };
}
