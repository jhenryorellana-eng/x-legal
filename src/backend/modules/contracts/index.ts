/**
 * Contracts module — public API (module-pub boundary).
 *
 * Other modules MUST import from here, never from service.ts directly.
 */

// Use cases
export {
  createContract,
  createContractAndSend,
  resyncPartiesSnapshot,
  resyncDocumentSnapshot,
  sendContractForSigning,
  cancelContractSending,
  resendSigningLink,
  getContractBySigningToken,
  signContract,
  signContractFromImage,
  acceptTermsInApp,
  acceptTermsFromImage,
  getTermsStatusForCase,
  getContractForCase,
  getSignedContractDownloadUrl,
  getTermsAcceptanceForCase,
  getCaseOnboardingContract,
  getSigningTokenForContract,
} from "./service";

export type { TermsStatusView, TermsAcceptanceView, CaseOnboardingContract } from "./service";

// Error class
export { ContractError } from "./service";

// Types
export type { CreateContractInput, SignContractInput, ContractSigningView, AcceptTermsInput } from "./service";

// Repository helpers needed by cases module (terms version for contract creation)
export { getActiveTermsVersion } from "./repository";
export type { ContractRow, ContractTermsAcceptanceRow, TermsVersionRow } from "./repository";

// Event types
export type { ContractEvent, ContractSentEvent, ContractSignedEvent } from "./events";

// Contract document assembler (pure) — consumed by cases (freeze) + signing page + PDF
export { buildContractDocument } from "./contract-document";
export type {
  ContractDocument,
  ContractDocumentInput,
  ContractSection,
  ContractBlock,
} from "./contract-document";
