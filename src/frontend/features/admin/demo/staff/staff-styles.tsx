"use client";

import * as React from "react";

/**
 * Staff-scoped keyframes for the "Vista staff" AI micro-experiences. All names
 * are `staff-` prefixed so they never collide with the app's global vocabulary
 * or the client demo's `demo-` set (which is still available — DemoExperience
 * injects it once). Pure CSS: the demo stays dependency-free and light.
 *
 * The institutional palette (blue / gold / red / white) is expressed only via
 * design tokens, so light/dark theming keeps working.
 */
const CSS = `
/* Translate: a scan line sweeping down the document + extracted fields popping. */
@keyframes staff-scan {
  0% { top: 4%; opacity: 0; }
  12% { opacity: 1; }
  88% { opacity: 1; }
  100% { top: 94%; opacity: 0; }
}
@keyframes staff-field-in {
  from { opacity: 0; transform: translateX(10px); }
  to { opacity: 1; transform: translateX(0); }
}
.staff-field-in { animation: staff-field-in .4s cubic-bezier(.2,.9,.3,1) both; }

/* I-589 assembly: a value-chip flies across the gutter into its official field. */
@keyframes staff-fly {
  0% { left: 3%; opacity: 0; transform: translateY(-50%) scale(.55); }
  22% { opacity: 1; transform: translateY(-50%) scale(1); }
  80% { opacity: 1; }
  100% { left: 97%; opacity: 0; transform: translateY(-50%) scale(.55); }
}
@keyframes staff-fill {
  0% { background: var(--card); border-color: var(--line); }
  100% { background: var(--blue-soft); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
}
.staff-fill { animation: staff-fill .5s ease both; }
@keyframes staff-value-in { from { opacity: 0; } to { opacity: 1; } }
.staff-value-in { animation: staff-value-in .35s ease both; }

/* AI core (memo): pulsing core, orbiting particles, sweeping beam. */
@keyframes staff-core-pulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 40%, transparent); }
  50% { transform: scale(1.06); box-shadow: 0 0 34px 8px color-mix(in srgb, var(--gold) 34%, transparent); }
}
.staff-core-pulse { animation: staff-core-pulse 1.9s ease-in-out infinite; }
@keyframes staff-orbit { to { transform: rotate(360deg); } }
@keyframes staff-orbit-rev { to { transform: rotate(-360deg); } }
@keyframes staff-beam {
  0% { transform: translateX(-140%) skewX(-18deg); opacity: 0; }
  40% { opacity: .8; }
  100% { transform: translateX(140%) skewX(-18deg); opacity: 0; }
}
.staff-beam { animation: staff-beam 2.4s ease-in-out infinite; }

/* Robot builder (expediente): the robot bobs, its arm swings, sheets drop in. */
@keyframes staff-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.staff-bob { animation: staff-bob 1.6s ease-in-out infinite; }
@keyframes staff-arm { 0%, 100% { transform: rotate(-10deg); } 45% { transform: rotate(26deg); } }
.staff-arm { transform-origin: 50% 8%; animation: staff-arm 1.1s ease-in-out infinite; }
@keyframes staff-sheet-drop {
  0% { transform: translateY(-46px) rotate(-7deg); opacity: 0; }
  55% { opacity: 1; }
  100% { transform: translateY(0) rotate(0); opacity: 1; }
}
.staff-sheet-drop { animation: staff-sheet-drop .7s cubic-bezier(.2,.9,.3,1) both; }
@keyframes staff-spark { 0%,100% { opacity: .25; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.15); } }
.staff-spark { animation: staff-spark 1.2s ease-in-out infinite; }

/* Generic reveals for panels / documents. */
@keyframes staff-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
.staff-rise { animation: staff-rise .5s cubic-bezier(.2,.9,.3,1) both; }
@keyframes staff-count-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.staff-count-in { animation: staff-count-in .3s ease both; }

@media (prefers-reduced-motion: reduce) {
  .staff-field-in, .staff-fill, .staff-value-in, .staff-core-pulse, .staff-beam,
  .staff-bob, .staff-arm, .staff-sheet-drop, .staff-spark, .staff-rise, .staff-count-in {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
  }
}

/* NOTE: the expediente @media print isolation lives in the GLOBAL stylesheet
   (src/app/globals.css), not here — a component <style> can sit inside the
   subtree hidden at print time or miss a hot-reload, so it must be global. */
`;

export function StaffStyles() {
  return <style>{CSS}</style>;
}
