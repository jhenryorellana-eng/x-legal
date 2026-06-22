/**
 * Flat i18n string builder for the catalog list + wizard (DOC-53 §4).
 * Server pages call this with the resolved next-intl translator so the client
 * components stay presentational (they receive a plain string map).
 */
type Translator = ((k: string) => string) & { raw: (k: string) => string };

export function buildCatalogStrings(tt: Translator): Record<string, string> {
  const keys = [
    "title", "sub", "newService", "filterSearch", "filterCategory", "filterStatus",
    "showArchived", "catMigratorio", "catEmpresarial", "catFamiliar", "statusDraft",
    "statusActive", "statusHidden", "statusArchived", "phases", "planSelf", "planLawyer",
    "entryBadge", "menuEdit", "menuClone", "menuActivate", "menuDeactivate", "menuHide",
    "menuShow", "menuArchive", "menuRestore", "menuHistory", "emptyTitle", "emptySub",
    "bannerProd", "archiveConfirmTitle", "archiveConfirmBody", "backToList",
    "step1", "step2", "step3", "step4", "step5", "step6", "step7",
    "partiesTitle", "partiesSub", "partiesApplicantNote", "partiesAdd", "partiesEmpty",
    "partyType", "partyLabel", "partyCardinality", "partySingle", "partyMultiple",
    "partyRequired", "partyRemove", "partyNeedLabel", "partyDup",
    "docPartyApplicant", "docPartyRolesLabel", "docNeedRoles",
    "slug", "slugLocked", "category",
    "labelField", "descShort", "descLong", "benefits", "addBenefit", "appearance", "icon",
    "color", "visibility", "isPublic", "entryToggle", "entryNote", "previewMobile",
    "offerPlan", "price", "currency", "installments", "downpayment", "planActive",
    "lawyerIncluded", "lawyerNote", "priceNote", "addPhase", "phaseSlug", "phaseLabel",
    "phaseDesc", "clientExplainer", "milestones", "apptPolicy", "apptCount", "apptDuration",
    "apptKind", "apptVideo", "apptPhone", "apptPresencial", "apptNote",
    "apptScheduleTitle", "citaN", "citaWeek", "addCita", "processingWeeks",
    "cronogramaEmpty", "cronogramaTotal", "selectPhase",
    "docDocument", "docTip", "docCategory", "docRequired", "docPerParty", "docAiExtract",
    "docAdd", "docNeedName",
    "docActiveCol", "docSchema", "formPdf", "formAi", "filledBy", "filledClient",
    "filledStaff", "filledBoth", "formStub", "formStubSub", "publishTitle", "publishReady",
    "activateService", "celebrate", "issueBlocking", "issueWarning", "ackWarning",
    "formsNeedPhaseTitle", "formsNeedPhaseSub", "formsNeedName", "formsCreated", "formsKind",
    "formsKindLetter", "formsKindPdf", "formsKindLetterHint", "formsKindPdfHint", "formsLabel",
    "formsSlug", "formsFilledBy", "formsFilledClient", "formsFilledStaff", "formsFilledBoth",
    "formsCreate", "formsEmpty", "formsDraft", "formsActive", "formsConfigure",
  ];
  const out: Record<string, string> = {};
  // raw(): several messages carry placeholders ({n}, {email}); calling t()
  // without values THROWS in next-intl and 500s the page. Client components
  // interpolate via .replace() — same pattern as the OTP screen (F0).
  for (const k of keys) out[k] = tt.raw(`catalog.${k}`);
  out.cancel = tt.raw("common.cancel");
  out.save = tt.raw("common.save");
  out.delete = tt.raw("common.delete");
  out.next = tt.raw("common.next");
  out.back = tt.raw("common.back");
  out.saved = tt.raw("common.saved");
  out.missingEn = tt.raw("common.missingEn");
  out.loadMore = tt.raw("common.loadMore");
  return out;
}
