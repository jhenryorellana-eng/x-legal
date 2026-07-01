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
  | { kind: "i589" }
  | { kind: "memo" }
  | { kind: "expediente" };

export type StaffSplash = null | "translate" | "i589" | "memo" | "expediente";

export interface StaffFlowState {
  translations: Record<string, GenStatus>;
  i589: GenStatus;
  memo: GenStatus;
  expediente: GenStatus;
  loader: StaffLoader;
  splash: StaffSplash;
}

type Action =
  | { type: "reset" }
  | { type: "startTranslate"; docId: string }
  | { type: "loadedTranslate" }
  | { type: "startI589" }
  | { type: "loadedI589" }
  | { type: "startMemo" }
  | { type: "loadedMemo" }
  | { type: "startExpediente" }
  | { type: "loadedExpediente" }
  | { type: "dismissSplash" };

function initialState(): StaffFlowState {
  return {
    translations: {},
    i589: "idle",
    memo: "idle",
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
    case "startI589":
      return { ...state, loader: { kind: "i589" }, i589: "running" };
    case "loadedI589":
      return { ...state, loader: null, splash: "i589", i589: "done" };
    case "startMemo":
      return { ...state, loader: { kind: "memo" }, memo: "running" };
    case "loadedMemo":
      return { ...state, loader: null, splash: "memo", memo: "done" };
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
  startI589: () => void;
  loadedI589: () => void;
  startMemo: () => void;
  loadedMemo: () => void;
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
      startI589: () => dispatch({ type: "startI589" }),
      loadedI589: () => dispatch({ type: "loadedI589" }),
      startMemo: () => dispatch({ type: "startMemo" }),
      loadedMemo: () => dispatch({ type: "loadedMemo" }),
      startExpediente: () => dispatch({ type: "startExpediente" }),
      loadedExpediente: () => dispatch({ type: "loadedExpediente" }),
      dismissSplash: () => dispatch({ type: "dismissSplash" }),
    }),
    [],
  );

  return { state, actions };
}
