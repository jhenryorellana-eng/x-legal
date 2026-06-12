import { Plus_Jakarta_Sans } from "next/font/google";

/**
 * Brand display font — DOC-01 §2.
 * Used for titles, buttons, labels and KPIs (`--font-title`).
 * Weights: 600 semibold · 700 bold · 800 extrabold.
 * Body text falls back to `system-ui` (see `--font-body` in tokens.css).
 *
 * NOTE (TODO SoT): DOC-01 §2 also lists weight 900 ("black", titles/KPIs only)
 * but the Plus Jakarta Sans family on Google Fonts maxes out at 800 — there is
 * no 900 cut. We use 800 as the heaviest weight; `font-weight: 900` declarations
 * simply clamp to 800. This matches the prototype's runtime behaviour.
 *
 * `display: swap` avoids invisible text while the font loads (RNF perf).
 * The variable is consumed by Tailwind's `--font-title` token.
 */
export const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
  variable: "--font-plus-jakarta",
});
