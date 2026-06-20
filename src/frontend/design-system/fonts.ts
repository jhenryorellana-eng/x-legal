import { Plus_Jakarta_Sans } from "next/font/google";

/**
 * Brand font — Plus Jakarta Sans (DOC-01 §2). Used for BOTH titles
 * (`--font-title`, weights 600/700/800) AND body text (`--font-body`, weights
 * 400/500) — the prototype (`MigrationPrime.html`) uses Plus Jakarta everywhere,
 * not system-ui. The 400/500 cuts are required so body copy renders in the real
 * font instead of the metric-matched fallback.
 *
 * The variable MUST be attached to `<html>` in the root layout so the `:root`
 * tokens that reference `var(--font-plus-jakarta)` can resolve it.
 *
 * NOTE (TODO SoT): DOC-01 §2 also lists weight 900 ("black", titles/KPIs only)
 * but the Plus Jakarta Sans family on Google Fonts maxes out at 800 — there is
 * no 900 cut. We use 800 as the heaviest weight; `font-weight: 900` declarations
 * simply clamp to 800. This matches the prototype's runtime behaviour.
 *
 * `display: swap` avoids invisible text while the font loads (RNF perf).
 */
export const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-plus-jakarta",
});
