/**
 * Lex assistant — shared public surface.
 *
 * The deterministic engine + types (pure, framework-free), the i18n composer, the
 * render components (LexBubble/LexDock), and the preferences provider. Used by all
 * four staff boards; the RSC page builds a `LexContext`, calls `buildLexInsight`,
 * composes the bubble with `composeLexBubble`, and the client view renders it.
 */

export * from "./types";
export { buildLexInsight } from "./engine";
export { biggestFunnelLeak, type FunnelStageCount, type FunnelLeak } from "./funnel";
export { composeLexBubble, lexTranslators, type LexTranslators } from "./compose";
export { LexBubble, LexDock } from "./components/lex";
export { LexBoardBubble } from "./components/lex-board-bubble";
export type {
  LexAction,
  LexBubbleProps,
  LexDockProps,
  LexQuickQuestion,
} from "./components/lex";
export { LexPrefsProvider, useLexPrefs } from "./lex-prefs";
