/**
 * Identity module — public API surface (module-pub boundary).
 *
 * Only re-exports that the app layer and other modules are allowed to consume.
 * Server actions are in actions.ts (also module-pub per eslint.config.mjs).
 *
 * Boundary rule: app → module-pub only. The internal files
 * (service, repository, domain, events) are module-int.
 *
 * This module also surfaces the auth/authz platform helpers so that app-layer
 * files (Next.js pages, layouts) can call getActor/requireActor/can without
 * violating the app→platform boundary. The identity module IS the auth domain.
 */

// Domain types useful for other modules (read-only — no side effects)
export type { PhoneNormalizationError } from "./domain";
export { normalizePhoneE164 } from "./domain";

// Action result types (needed by UI layer)
export type { ActionResult, TypedActionResult } from "./actions";

// Service result types (for other modules that delegate to identity)
export type {
  OtpRequestResult,
  OtpVerifyResult,
  PasswordResetResult,
  PasswordUpdateResult,
  IdentityError,
  StaffProfileResult,
  InviteEmployeeResult,
  UpdatePermissionsResult,
  DeactivateEmployeeResult,
  ReactivateEmployeeResult,
  ListEmployeesResult,
  EmployeeRow,
} from "./service";

// Read-only staff profile for the shell header / sidebar user-chip (DOC-50 §1.3)
export { getCurrentStaffProfile } from "./service";

// Read-only employee count for the admin dashboard KPI (DOC-53 §1.1)
export { countActiveEmployees } from "./service";

// Auth / authorization helpers — re-exported here so app-layer files can
// import them via module-pub boundary (app → module-pub is allowed per DOC-21).
export { getActor, requireActor, can, systemActor, AuthzError } from "@/backend/platform/authz";
export type { Actor, Action } from "@/backend/platform/authz";
