/**
 * Flat i18n string builder for the catalog list + wizard (DOC-53 §4).
 * Server pages call this with the resolved next-intl translator so the client
 * components stay presentational (they receive a plain string map).
 */
export function buildCatalogStrings(tt: (k: string) => string): Record<string, string> {
  const keys = [
    "title", "sub", "newService", "filterSearch", "filterCategory", "filterStatus",
    "showArchived", "catMigratorio", "catEmpresarial", "catFamiliar", "statusDraft",
    "statusActive", "statusHidden", "statusArchived", "phases", "planSelf", "planLawyer",
    "entryBadge", "menuEdit", "menuClone", "menuActivate", "menuDeactivate", "menuHide",
    "menuShow", "menuArchive", "menuRestore", "menuHistory", "emptyTitle", "emptySub",
    "bannerProd", "archiveConfirmTitle", "archiveConfirmBody", "backToList",
    "step1", "step2", "step3", "step4", "step5", "step6", "slug", "slugLocked", "category",
    "labelField", "descShort", "descLong", "benefits", "addBenefit", "appearance", "icon",
    "color", "visibility", "isPublic", "entryToggle", "entryNote", "previewMobile",
    "offerPlan", "price", "currency", "installments", "downpayment", "planActive",
    "lawyerIncluded", "lawyerNote", "priceNote", "addPhase", "phaseSlug", "phaseLabel",
    "phaseDesc", "clientExplainer", "milestones", "apptPolicy", "apptCount", "apptDuration",
    "apptKind", "apptVideo", "apptPhone", "apptPresencial", "apptNote", "selectPhase",
    "docDocument", "docTip", "docCategory", "docRequired", "docPerParty", "docAiExtract",
    "docActiveCol", "docSchema", "formPdf", "formAi", "filledBy", "filledClient",
    "filledStaff", "filledBoth", "formStub", "formStubSub", "publishTitle", "publishReady",
    "activateService", "celebrate", "issueBlocking", "issueWarning", "ackWarning",
  ];
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = tt(`catalog.${k}`);
  out.cancel = tt("common.cancel");
  out.save = tt("common.save");
  out.delete = tt("common.delete");
  out.next = tt("common.next");
  out.back = tt("common.back");
  out.saved = tt("common.saved");
  out.missingEn = tt("common.missingEn");
  out.loadMore = tt("common.loadMore");
  return out;
}
