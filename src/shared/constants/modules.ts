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
  // Capability permission (not a sidebar module): edit form/generation answers even
  // once submitted/approved, from the staff review (admin + paralegal by default —
  // Henry 2026-07-08). Only the `edit` toggle grants the capability; `view` is a no-op.
  "formEdit",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];
