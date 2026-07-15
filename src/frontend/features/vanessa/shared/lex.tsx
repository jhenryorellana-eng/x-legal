/**
 * Compatibility facade — Lex bubble/dock moved to the shared `features/lex`
 * feature (now used by all four staff panels). Vanessa views keep importing from
 * `../shared/lex`; the single source of truth lives in `@/frontend/features/lex`.
 */

export {
  LexBubble,
  LexDock,
  type LexAction,
  type LexBubbleProps,
  type LexDockProps,
  type LexQuickQuestion,
} from "@/frontend/features/lex/components/lex";
