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
  getCaseOnboardingContract,
  getSigningTokenForContract,
} from "./service";

export type { TermsStatusView, CaseOnboardingContract } from "./service";

// Error class
export { ContractError } from "./service";

// Types
export type { CreateContractInput, SignContractInput, ContractSigningView, AcceptTermsInput } from "./service";

// Repository helpers needed by cases module (terms version for contract creation)
export { getActiveTermsVersion } from "./repository";
export type { ContractRow, ContractTermsAcceptanceRow, TermsVersionRow } from "./repository";

// Event types
export type { ContractEvent, ContractSentEvent, ContractSignedEvent } from "./events";
