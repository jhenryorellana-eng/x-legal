/**
 * Org module — public API (module-pub boundary).
 *
 * Organization configuration (DOC-53 §9): typed org settings, cover templates
 * and T&C versions — the "company data" consumed by the client app and emails.
 * Cohesively separate from identity (auth/staff): these are org-level config.
 *
 * Reads are exposed for page-initial RSC; mutations live in actions.ts.
 */

// Page-initial reads (consumed by admin config server pages)
export {
  getOrgConfig,
  getOrgContractInfo,
  listCoverTemplates,
  getTermsOverview,
} from "./service";

// Result types needed by the UI layer
export type {
  OrgConfig,
  OrgContractInfo,
  TermsOverview,
} from "./service";

export type {
  OrgSettings,
  CoverTemplate,
  TermsVersion,
} from "./domain";
