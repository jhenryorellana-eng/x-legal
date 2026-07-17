/**
 * Boundary regression — SYSTEM resolvers must never be reachable from the app layer.
 *
 * resolveFormResponseFieldValuesSystem / getCaseExtractionsSystem / getFormResponseMeta
 * skip authz by design (trusted QStash jobs only; the authz+IDOR happens at enqueue
 * time in ai-engine's startPreMortemValidation). They sit on module-pub because jobs
 * can only import module-pub — which also makes them importable from src/app/** where
 * a careless call-site would leak decrypted PII with no requireCaseAccess gate. This
 * codebase has hit that exact class of gap five times before (deactivateEmployee,
 * approveFormResponse, sendToFinance, translateMessage, service_party_roles), so this
 * test freezes the invariant: NO file under src/app references these symbols.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const FORBIDDEN = [
  "resolveFormResponseFieldValuesSystem",
  "getCaseExtractionsSystem",
  "getFormResponseMeta",
];

const APP_ROOT = path.resolve(__dirname, "../../../../app");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("cases SYSTEM resolvers stay out of the app layer", () => {
  it("no file under src/app references the actor-free resolvers", () => {
    const offenders: string[] = [];
    for (const file of walk(APP_ROOT)) {
      const content = fs.readFileSync(file, "utf8");
      for (const symbol of FORBIDDEN) {
        if (content.includes(symbol)) {
          offenders.push(`${path.relative(APP_ROOT, file)} → ${symbol}`);
        }
      }
    }
    expect(offenders, "SYSTEM resolvers skip authz — app code must go through the actor-based variants").toEqual([]);
  });
});
