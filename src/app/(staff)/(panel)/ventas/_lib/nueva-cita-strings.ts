import "server-only";
import { getTranslations } from "next-intl/server";
import { tzLabel, type Locale } from "@/frontend/lib/datetime";
import type { NuevaCitaStrings } from "@/frontend/features/vanessa";

/**
 * Builds the i18n strings for the "Nueva cita" modal. Shared by the Citas page
 * and the Leads page (the lead-card "Agendar cita" launches the same modal),
 * so the two never drift.
 */
export async function buildNuevaCitaStrings(
  staffTimezone: string,
  locale: Locale,
): Promise<NuevaCitaStrings> {
  const tnc = await getTranslations("staff.ventas.nuevaCita");
  return {
    title: tnc("title"),
    sub: tnc("sub"),
    tzChip: tnc("tzChip", { region: tzLabel(staffTimezone, locale) }),
    modeClient: tnc("modeClient"),
    modeProspect: tnc("modeProspect"),
    clientHint: tnc("clientHint"),
    prospectHint: tnc("prospectHint"),
    searchClient: tnc("searchClient"),
    searchClientPh: tnc("searchClientPh"),
    emptyClients: tnc("emptyClients"),
    searchProspect: tnc("searchProspect"),
    searchProspectPh: tnc("searchProspectPh"),
    emptyProspects: tnc("emptyProspects"),
    createProspect: tnc("createProspect"),
    prospectNamePh: tnc("prospectNamePh"),
    prospectPhonePh: tnc("prospectPhonePh"),
    createProspectConfirm: tnc("createProspectConfirm"),
    rutaTitle: tnc("rutaTitle"),
    citaLabel: tnc("citaLabel", { n: "{n}", m: "{m}" }),
    prospectCita: tnc("prospectCita"),
    date: tnc("date"),
    hour: tnc("hour"),
    pickCaseFirst: tnc("pickCaseFirst"),
    loadingSlots: tnc("loadingSlots"),
    noSlots: tnc("noSlots"),
    clientEquiv: tnc("clientEquiv", { hour: "{hour}" }),
    overlapWarn: tnc("overlapWarn"),
    outsideWarn: tnc("outsideWarn"),
    min: tnc("min"),
    modalityVideo: tnc("modalityVideo"),
    modalityPhone: tnc("modalityPhone"),
    modalityPresencial: tnc("modalityPresencial"),
    remindersInfo: tnc("remindersInfo"),
    note: tnc("note"),
    notePh: tnc("notePh"),
    cancel: tnc("cancel"),
    create: tnc("create"),
    createAnyway: tnc("createAnyway"),
    createdClient: tnc("createdClient", { name: "{name}" }),
    createdProspect: tnc("createdProspect", { name: "{name}" }),
    change: tnc("change"),
  };
}
