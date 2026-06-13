/**
 * Contracts module — pure domain.
 *
 * Re-exports ContractStatus and canTransitionContract from cases/domain
 * for unified access.
 *
 * @module contracts/domain
 */

export type { ContractStatus } from "@/backend/modules/cases/domain";
export { canTransitionContract } from "@/backend/modules/cases/domain";
