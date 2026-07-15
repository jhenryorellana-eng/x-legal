/**
 * Shared editability resolution for a staff actor opening a client/staff form
 * (the "Ver" fill screen and the "Revisión" split-screen both consume this so the
 * rule lives in ONE place).
 *
 * `_case-forms` is a Next.js private folder (underscore) — colocation only, never a
 * route. Boundary R1/R2: app → module-pub (identity) + frontend types + app actions.
 */

import { allows, type Actor } from "@/backend/modules/identity";
import type { SaveDraftFn, WizardForm } from "@/frontend/features/form-wizard";
import { saveFormDraftAction } from "@/app/(staff)/(panel)/admin/casos/actions";
import { staffUpdateFormAnswersAction } from "@/app/(staff)/(panel)/admin/casos/form-actions";

export interface StaffFormEditability {
  /** Whether the staff may edit the answers at all (read-only "Ver" when false). */
  editable: boolean;
  /**
   * The autosave action to inject into the wizard:
   *  - a staff-fillable DRAFT (filled_by staff/both, still draft) → the normal fill
   *    flow, editable with case access → `saveFormDraftAction`.
   *  - anything else (submitted/approved, or a client-filled form) → a staff
   *    CORRECTION/fill-on-behalf, gated by the `formEdit` permission →
   *    `staffUpdateFormAnswersAction`.
   */
  saveDraft: SaveDraftFn;
}

/**
 * Decides whether a staff actor may edit a given form and which save action to use.
 * Admin bypasses; Diana (paralegal) has `formEdit` by preset; e.g. sales requires the
 * granted permission. Mirrors DOC-54 §2.4 as diverged by Henry (2026-07-08).
 */
export function resolveStaffFormEditability(
  actor: Actor,
  form: Pick<WizardForm, "status" | "filledBy">,
): StaffFormEditability {
  const isEditableStaffDraft =
    (form.status === "draft" || form.status === null) && form.filledBy !== "client";
  const canFormEdit = allows(actor, "formEdit", "edit");
  return {
    editable: isEditableStaffDraft || canFormEdit,
    saveDraft: isEditableStaffDraft ? saveFormDraftAction : staffUpdateFormAnswersAction,
  };
}
