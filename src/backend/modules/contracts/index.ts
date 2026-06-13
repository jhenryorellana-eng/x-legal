/**
 * Contracts module — public API (module-pub boundary).
 *
 * Other modules MUST import from here, never from service.ts directly.
 */

// Use cases
export {
  createContract,
  sendContractForSigning,
  cancelContractSending,
  resendSigningLink,
  getContractBySigningToken,
  signContract,
  acceptTermsInApp,
  getContractForCase,
} from "./service";

// Error class
export { ContractError } from "./service";

// Types
export type { CreateContractInput, SignContractInput, ContractSigningView, AcceptTermsInput } from "./service";

// Repository types (needed by cases module)
export type { ContractRow, ContractTermsAcceptanceRow } from "./repository";

// Event types
export type { ContractEvent, ContractSentEvent, ContractSignedEvent } from "./events";
