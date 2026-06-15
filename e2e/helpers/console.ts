/**
 * E2E console-error collector. The F4 DoD requires "0 console errors" on the
 * verified screens. Next.js dev emits a few benign messages; this filters those
 * and exposes only genuine page errors so a spec can assert none remain.
 */

import type { Page } from "@playwright/test";

const BENIGN = [
  /Download the React DevTools/i,
  /favicon\.ico/i,
  /\[Fast Refresh\]/i,
  /webpack-hmr|hot-update/i,
  /Next\.js Dev Tools/i,
];

/** Attaches a console-error collector to the page. Returns a getter for real errors. */
export function collectConsoleErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (BENIGN.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on("pageerror", (err) => {
    const text = err.message ?? String(err);
    if (BENIGN.some((re) => re.test(text))) return;
    errors.push(`pageerror: ${text}`);
  });
  return () => errors;
}
