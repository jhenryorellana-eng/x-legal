import * as React from "react";

/**
 * Lex — the assistant mascot (DOC-01 §1, §5.1).
 * Animated asset with a golden radial halo. Accompanies, celebrates and guides;
 * never scolds. Decorative by default (`aria-hidden`); when Lex communicates a
 * state, the adjacent text carries the meaning (DOC-01 §8.7).
 *
 * Uses the optimized animated WebP (`/assets/lex.webp`, < 1 MB per RNF-035)
 * with a `<picture>` fallback to the source GIF.
 */

export type LexMood = "calma" | "feliz" | "atento" | "señala" | "celebra";

/** Canonical sizes (DOC-01 §5.1). */
export type LexSize = 56 | 62 | 78 | 92 | 120 | 130 | 166 | 186;

const MOOD_ANIM: Record<LexMood, string> = {
  calma: "anim-float-calm",
  feliz: "anim-float-happy",
  atento: "anim-float-attentive",
  señala: "anim-float-point",
  celebra: "anim-celebrate",
};

export interface LexProps {
  size?: number;
  mood?: LexMood;
  /** Halo color; defaults to the brand gold halo token. */
  halo?: string;
  flip?: boolean;
  className?: string;
  /** When set, Lex is announced to assistive tech instead of being decorative. */
  label?: string;
}

export function Lex({
  size = 120,
  mood = "calma",
  halo,
  flip = false,
  className,
  label,
}: LexProps) {
  const haloScale = mood === "celebra" ? 1.7 : 1.35;
  const haloColor = halo ?? "var(--lex-halo)";

  return (
    <div
      className={className}
      style={{ position: "relative", width: size, height: size }}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <span
        className="anim-halo"
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          top: "52%",
          width: size * haloScale,
          height: size * haloScale,
          transform: "translate(-50%,-50%)",
          borderRadius: "50%",
          background: `radial-gradient(circle, color-mix(in srgb, ${haloColor} 40%, transparent) 0%, color-mix(in srgb, ${haloColor} 13%, transparent) 45%, transparent 70%)`,
          pointerEvents: "none",
        }}
      />
      <picture>
        <source srcSet="/assets/lex.webp" type="image/webp" />
        <img
          src="/assets/lex.gif"
          alt={label ?? ""}
          draggable={false}
          className={MOOD_ANIM[mood]}
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            objectFit: "contain",
            transform: flip ? "scaleX(-1)" : "none",
            filter: "drop-shadow(0 14px 18px rgba(11,27,51,0.22))",
            zIndex: 1,
          }}
        />
      </picture>
    </div>
  );
}
