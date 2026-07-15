/**
 * Compatibility facade — Lex preferences moved to the shared `features/lex`
 * feature so the toggle governs the bubbles in all four staff panels. Vanessa
 * views keep importing from `../shared/lex-prefs`.
 */

export { LexPrefsProvider, useLexPrefs } from "@/frontend/features/lex/lex-prefs";
