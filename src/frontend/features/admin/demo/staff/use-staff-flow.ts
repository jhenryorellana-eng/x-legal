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
 *
 * Multi-phase: translations, automation and generation are keyed by phase so the
 * presenter can jump between phases without losing per-phase progress. The
 * compiled expediente is a single final artifact (one status). The active loader
 * / splash carry their phase so the overlay layer resolves the right fixture
 * regardless of which phase is currently selected.
 */

export type GenStatus = "idle" | "running" | "done";

export type StaffLoader =
  | null
  | { kind: "translate"; phase: string; docId: string }
  | { kind: "automation"; phase: string }
  | { kind: "generation"; phase: string }
  | { kind: "expediente" };

export type StaffSplash =
  | null
  | { kind: "translate" }
  | { kind: "automation"; phase: string }
  | { kind: "generation"; phase: string }
  | { kind: "expediente" };

export interface StaffFlowState {
  /** Keyed by `${phaseSlug}:${docId}`. */
  translations: Record<string, GenStatus>;
  /** Keyed by phase slug. */
  automation: Record<string, GenStatus>;
  /** Keyed by phase slug. */
  generation: Record<string, GenStatus>;
  /** The compiled expediente is a single final artifact (scenario-level). */
  expediente: GenStatus;
  loader: StaffLoader;
  splash: StaffSplash;
}

type Action =
  | { type: "reset" }
  | { type: "startTranslate"; phase: string; docId: string }
  | { type: "loadedTranslate" }
  | { type: "startAutomation"; phase: string }
  | { type: "loadedAutomation" }
  | { type: "startGeneration"; phase: string }
  | { type: "loadedGeneration" }
  | { type: "startExpediente" }
  | { type: "loadedExpediente" }
  | { type: "dismissSplash" };

function initialState(): StaffFlowState {
  return {
    translations: {},
    automation: {},
    generation: {},
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
        loader: { kind: "translate", phase: action.phase, docId: action.docId },
        translations: {
          ...state.translations,
          [`${action.phase}:${action.docId}`]: "running",
        },
      };
    case "loadedTranslate": {
      if (state.loader?.kind !== "translate") return { ...state, loader: null };
      const key = `${state.loader.phase}:${state.loader.docId}`;
      return {
        ...state,
        loader: null,
        splash: { kind: "translate" },
        translations: { ...state.translations, [key]: "done" },
      };
    }
    case "startAutomation":
      return {
        ...state,
        loader: { kind: "automation", phase: action.phase },
        automation: { ...state.automation, [action.phase]: "running" },
      };
    case "loadedAutomation": {
      if (state.loader?.kind !== "automation") return { ...state, loader: null };
      const p = state.loader.phase;
      return {
        ...state,
        loader: null,
        splash: { kind: "automation", phase: p },
        automation: { ...state.automation, [p]: "done" },
      };
    }
    case "startGeneration":
      return {
        ...state,
        loader: { kind: "generation", phase: action.phase },
        generation: { ...state.generation, [action.phase]: "running" },
      };
    case "loadedGeneration": {
      if (state.loader?.kind !== "generation") return { ...state, loader: null };
      const p = state.loader.phase;
      return {
        ...state,
        loader: null,
        splash: { kind: "generation", phase: p },
        generation: { ...state.generation, [p]: "done" },
      };
    }
    case "startExpediente":
      return { ...state, loader: { kind: "expediente" }, expediente: "running" };
    case "loadedExpediente":
      return { ...state, loader: null, splash: { kind: "expediente" }, expediente: "done" };
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
  startTranslate: (docId: string, phase: string) => void;
  loadedTranslate: () => void;
  startAutomation: (phase: string) => void;
  loadedAutomation: () => void;
  startGeneration: (phase: string) => void;
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
      startTranslate: (docId, phase) => dispatch({ type: "startTranslate", phase, docId }),
      loadedTranslate: () => dispatch({ type: "loadedTranslate" }),
      startAutomation: (phase) => dispatch({ type: "startAutomation", phase }),
      loadedAutomation: () => dispatch({ type: "loadedAutomation" }),
      startGeneration: (phase) => dispatch({ type: "startGeneration", phase }),
      loadedGeneration: () => dispatch({ type: "loadedGeneration" }),
      startExpediente: () => dispatch({ type: "startExpediente" }),
      loadedExpediente: () => dispatch({ type: "loadedExpediente" }),
      dismissSplash: () => dispatch({ type: "dismissSplash" }),
    }),
    [],
  );

  return { state, actions };
}
