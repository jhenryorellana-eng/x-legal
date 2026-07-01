"use client";

import * as React from "react";

/**
 * Demo-scoped keyframes + helper classes. Injected once by DemoExperience. All
 * names are `demo-` prefixed so they never collide with the app's global anim
 * vocabulary. Pure CSS — keeps the demo dependency-free and light.
 */
const CSS = `
@keyframes demo-spin { to { transform: rotate(360deg); } }

@keyframes demo-stage-in {
  from { opacity: 0; transform: translateX(18px); }
  to { opacity: 1; transform: translateX(0); }
}
.demo-stage { animation: demo-stage-in .42s cubic-bezier(.2,.9,.3,1) both; }

@keyframes demo-pop {
  0% { transform: scale(.4); opacity: 0; }
  60% { transform: scale(1.12); opacity: 1; }
  100% { transform: scale(1); }
}
.demo-pop { animation: demo-pop .5s cubic-bezier(.2,.9,.3,1) both; }

@keyframes demo-check { to { stroke-dashoffset: 0; } }

@keyframes demo-overlay-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes demo-sheet-in {
  from { opacity: 0; transform: translateY(16px) scale(.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.demo-overlay { animation: demo-overlay-in .22s ease both; }
.demo-sheet { animation: demo-sheet-in .34s cubic-bezier(.2,.9,.3,1) both; }

@keyframes demo-cascade {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.demo-cascade { animation: demo-cascade .42s cubic-bezier(.2,.9,.3,1) both; }

@keyframes demo-confetti-fall {
  0% { transform: translateY(-12px) rotate(0deg); opacity: 1; }
  100% { transform: translateY(360px) rotate(640deg); opacity: 0; }
}

@keyframes demo-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
.demo-shimmer {
  background: linear-gradient(100deg, transparent 20%, rgba(255,255,255,.55) 50%, transparent 80%);
  background-size: 200% 100%;
  animation: demo-shimmer 1.1s linear infinite;
}

@keyframes demo-row-done {
  0% { background: var(--blue-soft); }
  100% { background: color-mix(in srgb, var(--green) 9%, transparent); }
}
.demo-row-done { animation: demo-row-done .6s ease both; }

@media (prefers-reduced-motion: reduce) {
  .demo-stage, .demo-pop, .demo-sheet, .demo-overlay, .demo-cascade, .demo-row-done {
    animation-duration: .01ms !important;
  }
}
`;

export function DemoStyles() {
  return <style>{CSS}</style>;
}
