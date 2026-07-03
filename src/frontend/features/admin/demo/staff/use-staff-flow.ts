"use client";

import * as React from "react";

/**
 * Local state machine for the demo "Vista staff". Everything is ephemeral — no
 * persistence, no backend. The reducer is intentionally PURE (no timers): each
 * AI micro-experience is a coarse status plus which loader overlay is open and,
 * once it finishes, a celebratory `splash` (success screen) the presenter taps
 * to continue. The loaders own their own timers and call the matching `loaded*`
 * action when their narration completes; unmounting a loader (on `reset`, or when
 * the status leaves `running`) clears those timers via effect cleanup — so a
 * re-run during the live never fires a stale transition.
 */

export type GenStatus = "idle" | "running" | "done";

export type StaffLoader =
  | null
  | { kind: "translate"; docId: string }
  | { kind: "automation" }
  | { kind: "generation" }
  | { kind: "expediente" };

export type StaffSplash = null | "translate" | "automation" | "generation" | "expediente";

export interface StaffFlowState {
  translations: Record<string, GenStatus>;
  automation: GenStatus;
  generation: GenStatus;
  expediente: GenStatus;
  loader: StaffLoader;
  splash: StaffSplash;
}

type Action =
  | { type: "reset" }
  | { type: "startTranslate"; docId: string }
  | { type: "loadedTranslate" }
  | { type: "startAutomation" }
  | { type: "loadedAutomation" }
  | { type: "startGeneration" }
  | { type: "loadedGeneration" }
  | { type: "startExpediente" }
  | { type: "loadedExpediente" }
  | { type: "dismissSplash" };

function initialState(): StaffFlowState {
  return {
    translations: {},
    automation: "idle",
    generation: "idle",
    expediente: "idle",
    loader: null,
    splash: null,
  };
}

function reducer(state: StaffFlowState, action: Action): StaffFlowState {
  switch (action.type) {
    case "startTranslate":
      return {
        ...state,
        loader: { kind: "translate", docId: action.docId },
        translations: { ...state.translations, [action.docId]: "running" },
      };
    case "loadedTranslate": {
      if (state.loader?.kind !== "translate") return { ...state, loader: null };
      const id = state.loader.docId;
      return {
        ...state,
        loader: null,
        splash: "translate",
        translations: { ...state.translations, [id]: "done" },
      };
    }
    case "startAutomation":
      return { ...state, loader: { kind: "automation" }, automation: "running" };
    case "loadedAutomation":
      return { ...state, loader: null, splash: "automation", automation: "done" };
    case "startGeneration":
      return { ...state, loader: { kind: "generation" }, generation: "running" };
    case "loadedGeneration":
      return { ...state, loader: null, splash: "generation", generation: "done" };
    case "startExpediente":
      return { ...state, loader: { kind: "expediente" }, expediente: "running" };
    case "loadedExpediente":
      return { ...state, loader: null, splash: "expediente", expediente: "done" };
    case "dismissSplash":
      return { ...state, splash: null };
    case "reset":
      return initialState();
    default:
      return state;
  }
}

export interface StaffFlowActions {
  reset: () => void;
  startTranslate: (docId: string) => void;
  loadedTranslate: () => void;
  startAutomation: () => void;
  loadedAutomation: () => void;
  startGeneration: () => void;
  loadedGeneration: () => void;
  startExpediente: () => void;
  loadedExpediente: () => void;
  dismissSplash: () => void;
}

export interface StaffFlow {
  state: StaffFlowState;
  actions: StaffFlowActions;
}

export function useStaffFlow(): StaffFlow {
  const [state, dispatch] = React.useReducer(reducer, undefined, initialState);

  const actions = React.useMemo<StaffFlowActions>(
    () => ({
      reset: () => dispatch({ type: "reset" }),
      startTranslate: (docId) => dispatch({ type: "startTranslate", docId }),
      loadedTranslate: () => dispatch({ type: "loadedTranslate" }),
      startAutomation: () => dispatch({ type: "startAutomation" }),
      loadedAutomation: () => dispatch({ type: "loadedAutomation" }),
      startGeneration: () => dispatch({ type: "startGeneration" }),
      loadedGeneration: () => dispatch({ type: "loadedGeneration" }),
      startExpediente: () => dispatch({ type: "startExpediente" }),
      loadedExpediente: () => dispatch({ type: "loadedExpediente" }),
      dismissSplash: () => dispatch({ type: "dismissSplash" }),
    }),
    [],
  );

  return { state, actions };
}
