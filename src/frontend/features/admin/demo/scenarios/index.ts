import type { DemoScenario } from "./types";
import { asiloPolitico } from "./asilo-politico";

/**
 * Registry of demo scenarios, keyed by service slug. Adding a new service to the
 * demo is a one-file change: author the fixture and register it here.
 */
export const DEMO_SCENARIOS: Record<string, DemoScenario> = {
  [asiloPolitico.slug]: asiloPolitico,
};

export function getScenario(slug: string): DemoScenario | undefined {
  return DEMO_SCENARIOS[slug];
}

export function listScenarios(): DemoScenario[] {
  return Object.values(DEMO_SCENARIOS);
}

/**
 * Maps a catalog `color` key (e.g. "green") to its CSS token. Mirrors the admin
 * catalog editor's SERVICE_COLOR map so demo cards tint exactly like real ones.
 */
const SERVICE_COLOR: Record<string, string> = {
  accent: "var(--accent)",
  gold: "var(--gold-deep)",
  green: "var(--green)",
  red: "var(--red)",
  navy: "var(--brand-navy)",
  purple: "var(--purple)",
};

export function serviceColorToken(key: string | null | undefined): string {
  return (key && SERVICE_COLOR[key]) || "var(--accent)";
}

export type { DemoScenario } from "./types";
