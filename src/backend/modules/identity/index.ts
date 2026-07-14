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
export {
  normalizeEmail,
  normalizeEmailStrict,
  isValidEmail,
  EmailValidationError,
} from "./domain";

// Action result types (needed by UI layer)
export type { ActionResult, TypedActionResult } from "./actions";

// Service result types (for other modules that delegate to identity)
export type {
  PhoneLoginResult,
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
  // Client provisioning (DOC-22 §1.2, H-2)
  ProvisionClientUserInput,
  ProvisionClientUserResult,
  UpsertPersonRecordInput,
  // Client picker + address update (RF-VAN-018 — "Nuevo caso" step 1)
  SearchClientsInput,
  ClientSearchResultDto,
  UpdateClientAddressInput,
  UpdateClientAddressResult,
} from "./service";

// Read-only staff profile for the shell header / sidebar user-chip (DOC-50 §1.3)
export { getCurrentStaffProfile } from "./service";

// Read-only employee count for the admin dashboard KPI (DOC-53 §1.1)
export { countActiveEmployees } from "./service";

// Per-user appearance (theme + text scale) — DOC-01 §4/§8.5
export { setUserUiPrefs, getCurrentUserUiPrefs } from "./service";

// First-visit Tutorial seen flag — read for the camino `firstVisit` gate (DOC-29 §34)
export { hasSeenTutorial } from "./service";

// Location (timezone + city/country) for the Configuración location card (DOC-23 §6.5)
export { getCurrentUserLocation } from "./service";

// Client provisioning — used by cases.createCaseFromContract (DOC-22 §1.2)
export { provisionClientUser, upsertPersonRecord } from "./service";

// Client picker search + address update — "Nuevo caso" existing-client path
// (RF-VAN-018; consumed by the admin/casos server actions). Identity fields
// (name/phone/email) are immutable there — only the address is written.
export { searchClients, updateClientAddress } from "./service";

// Party row helper — used by cases module only (DOC-41 §3.1 boundary)
export { insertCasePartyRow } from "./repository";

// Client address shape (captured at intake; prefills the I-589 — DOC-40 §2.7)
export type { ClientAddressInput } from "./repository";

// Auth / authorization helpers — re-exported here so app-layer files can
// import them via module-pub boundary (app → module-pub is allowed per DOC-21).
export { getActor, requireActor, can, allows, systemActor, AuthzError } from "@/backend/platform/authz";
export type { Actor, Action } from "@/backend/platform/authz";
