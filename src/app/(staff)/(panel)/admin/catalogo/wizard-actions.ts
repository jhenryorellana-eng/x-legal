/**
 * Wizard action bundle — a plain object of the catalog server actions the
 * CatalogWizard consumes. Each function is a "use server" action (re-exported
 * from ./actions); grouping them here keeps the two wizard pages (nuevo +
 * [serviceId]) DRY without re-declaring the action signatures.
 */

import {
  createServiceUi,
  updateServiceUi,
  upsertPlanUi,
  createPhaseUi,
  updatePhaseUi,
  deletePhaseUi,
  upsertPolicyUi,
  activateServiceUi,
} from "./actions";

export const catalogWizardActions = {
  createService: createServiceUi,
  updateService: updateServiceUi,
  upsertPlan: upsertPlanUi,
  createPhase: createPhaseUi,
  updatePhase: updatePhaseUi,
  deletePhase: deletePhaseUi,
  upsertPolicy: upsertPolicyUi,
  activate: activateServiceUi,
};
