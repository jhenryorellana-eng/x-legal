/**
 * Canonical module keys for the UsaLatinoPrime V2 authorization layer.
 *
 * Source of truth: DOC-22 §5.3 / DOC-30 §1.
 * Any new module MUST be added in DOC-30 first, then here.
 * `can()` in platform/authz.ts is typed against this tuple — strings outside
 * this list will not compile.
 */

export const MODULE_KEYS = [
  "dashboard",
  "leads",
  "clients",
  "cases",
  "calendar",
  "availability",
  "metrics",
  "catalog",
  "datasets",
  "employees",
  "billing",
  "collections",
  "printing",
  "campaigns",
  "accounting",
  "expedientes",
  "validations",
  "messaging",
  "community",
  "audit",
  // Lifecycle "después" / fidelización (retención) — F6 extension.
  "promotions",
  "referrals",
  "reviews",
  "retention",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];
