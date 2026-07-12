/**
 * Wizard action bundle — a plain object of the catalog server actions the
 * CatalogWizard consumes. Each function is a "use server" action (re-exported
 * from ./actions); grouping them here keeps the two wizard pages (nuevo +
 * [serviceId]) DRY without re-declaring the action signatures.
 */

import {
  createServiceUi,
  updateServiceUi,
  uploadTranslationSignatureUrlUi,
  signaturePreviewUrlUi,
  upsertPlanUi,
  createPhaseUi,
  updatePhaseUi,
  deletePhaseUi,
  upsertPolicyUi,
  upsertScheduleUi,
  upsertStageSlasUi,
  upsertMilestonesUi,
  createRequiredDocUi,
  updateRequiredDocUi,
  createServicePartyRoleUi,
  updateServicePartyRoleUi,
  deleteServicePartyRoleUi,
  createFormUi,
  updateFormUi,
  activateServiceUi,
  proposeExtractionSchemaUi,
  validateExtractionSchemaUi,
} from "./actions";

export const catalogWizardActions = {
  createService: createServiceUi,
  updateService: updateServiceUi,
  uploadSignatureUrl: uploadTranslationSignatureUrlUi,
  getSignaturePreviewUrl: signaturePreviewUrlUi,
  upsertPlan: upsertPlanUi,
  createPhase: createPhaseUi,
  updatePhase: updatePhaseUi,
  deletePhase: deletePhaseUi,
  upsertPolicy: upsertPolicyUi,
  upsertSchedule: upsertScheduleUi,
  saveStageSlas: upsertStageSlasUi,
  upsertMilestones: upsertMilestonesUi,
  createRequiredDoc: createRequiredDocUi,
  updateRequiredDoc: updateRequiredDocUi,
  createPartyRole: createServicePartyRoleUi,
  updatePartyRole: updateServicePartyRoleUi,
  deletePartyRole: deleteServicePartyRoleUi,
  createForm: createFormUi,
  updateForm: updateFormUi,
  activate: activateServiceUi,
  proposeExtractionSchema: proposeExtractionSchemaUi,
  validateExtractionSchema: validateExtractionSchemaUi,
};
