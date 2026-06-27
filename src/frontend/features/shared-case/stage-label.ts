/**
 * Localised label for a case responsibility stage (eje propio). Shared by the
 * header chip (shared-case-view) and the Traspaso tab.
 */
import type { CasosStrings } from "./strings";
import type { CaseStageId } from "./types";

export function stageLabel(t: CasosStrings["detail"], stage: CaseStageId): string {
  switch (stage) {
    case "sales":
      return t.stageSales;
    case "legal":
      return t.stageLegal;
    case "operations":
      return t.stageOperations;
    case "done":
      return t.stageDone;
  }
}
