"use client";

import * as React from "react";

/**
 * Confetti — celebración (documento aprobado / caso completado) — DOC-01 §5.2.
 * Ported verbatim from the prototype `V2/UI Cliente/app/ui.jsx → Confetti`.
 *
 * Canvas with 150 particles (squares/circles in blue/gold/green/red/navy),
 * gravity + rotation + fade over 3200ms, driven by a single requestAnimationFrame
 * loop (never setInterval). Respects `prefers-reduced-motion` (reduces particle
 * count to ~0). Pairs with `playChime()` (WebAudio, 3 tones 659/784/1047 Hz).
 *
 * Reads brand colors from CSS custom properties at run time so it stays correct
 * in light/dark and on either surface.
 */

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

interface ConfettiProps {
  /** Fire the burst when this flips to true. */
  run: boolean;
  /** Total animation lifetime in ms (default 3200). */
  duration?: number;
}

export function Confetti({ run, duration = 3200 }: ConfettiProps) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    if (!run) return;
    const cv = ref.current;
    if (!cv) return;
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const W = (cv.width = cv.offsetWidth);
    const H = (cv.height = cv.offsetHeight);
    const cols = [
      readVar("--accent", "#2F6BFF"),
      readVar("--gold", "#FFC629"),
      readVar("--green", "#1BB673"),
      "#FF5A7A",
      readVar("--brand-navy", "#002855"),
    ];
    const N = reduce ? 0 : 150;
    const parts = Array.from({ length: N }, () => ({
      x: W / 2 + (Math.random() - 0.5) * 80,
      y: H * 0.42,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 13 - 5,
      g: 0.28 + Math.random() * 0.12,
      s: 5 + Math.random() * 7,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.4,
      c: cols[(Math.random() * cols.length) | 0],
      shape: Math.random() > 0.5 ? 0 : 1,
    }));

    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const el = t - start;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - el / duration);
        ctx.fillStyle = p.c;
        if (p.shape === 0) ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        else {
          ctx.beginPath();
          ctx.arc(0, 0, p.s / 2, 0, 6.28);
          ctx.fill();
        }
        ctx.restore();
      }
      if (el < duration) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, duration]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 40,
      }}
    />
  );
}

/**
 * playChime — soft 3-tone success chime (WebAudio).
 * Ported from the prototype; respects `prefers-reduced-motion` (stays silent).
 */
export function playChime(): void {
  try {
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    [0, 0.12, 0.24].forEach((d, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.value = [659, 784, 1047][i];
      o.connect(g);
      g.connect(ac.destination);
      const tt = ac.currentTime + d;
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.12, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.5);
      o.start(tt);
      o.stop(tt + 0.55);
    });
  } catch {
    /* AudioContext unavailable — silently skip */
  }
}
