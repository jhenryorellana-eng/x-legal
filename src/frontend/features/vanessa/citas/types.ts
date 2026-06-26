/**
 * Citas view models (DOC-52 §3). Defined in the feature so the client view does
 * not import from app/ (boundary R: frontend allow = [frontend, shared]).
 */

export type ApptKind = "c1" | "c2" | "c3" | "call";

export interface CitaEvent {
  id: string;
  name: string;
  kind: ApptKind;
  seqLabel: string; // "Cita 2" | "Llamada"
  dayIndex: number;
  slotIndex: number;
  done: boolean;
  dayLabel: string;
  time: string;
  tzAbbr: string;
}

export interface CitaObjective {
  id: string;
  text: string;
}

export interface CitaObjectiveOutcome {
  id: string;
  text: string;
  achieved: boolean;
}

export interface CitaDetail {
  id: string;
  name: string;
  dayTime: string; // "Mié 3 · 9:30 AM EDT"
  clientHour: string | null; // dual-hour secondary, e.g. "7:30 AM MDT (cliente)"
  typeLabel: string; // "Cita 2 · Verificación y cartas"
  isVideo: boolean;
  /** Effective video-call link the staff opens; null when none configured. */
  videoLink: string | null;
  status: "scheduled" | "completed" | "cancelled" | "no_show" | "rescheduled";
  lexHtml: string;
  /** Note the client wrote when self-booking ("Nota para tu asesora"); null if none. */
  clientNote: string | null;
  /** Staff internal log (bitácora). Shown as a secondary section when present. */
  notes: string | null;
  /** Objectives for this cita (from the service cronograma). */
  objectives: CitaObjective[];
  /** Recorded outcome when the cita was completed (shown read-only). */
  objectivesOutcome: CitaObjectiveOutcome[] | null;
}

export type ApptModality = "video" | "phone" | "presencial";

export interface ClientSearchResult {
  caseId: string;
  name: string;
  serviceLabel: string;
  phone: string | null;
  clientTz: string | null;
}

export interface ProspectSearchResult {
  leadId: string;
  name: string | null;
  phone: string;
  source: string;
}

/** One cita of the case's route, for the read-only "Ruta de citas" summary. */
export interface RutaItem {
  number: number;
  label: string | null;
  kind: string;
  status: string;
}

/** Derived booking context for a CLIENT case (everything is read-only). */
export interface CaseBookingContext {
  slots: string[]; // ISO instants
  staffTimezone: string;
  durationMinutes: number;
  kind: ApptModality;
  sequenceNumber: number;
  seqLabel: string; // "{n}/{total}"
  ruta: RutaItem[];
}

/** Derived booking context for a PROSPECT (no case). */
export interface ProspectSlotsContext {
  slots: string[];
  staffTimezone: string;
  durationMinutes: number;
  kind: ApptModality;
}

export interface NuevaCitaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffTz: string;
  locale: "es" | "en";
  strings: NuevaCitaStrings;
  actions: NuevaCitaActions;
  /** When set, the modal opens in Prospecto mode with this lead pre-selected and
   *  its slots loaded (used by the "Agendar cita" button on a lead card). */
  presetProspect?: ProspectSearchResult | null;
}

export interface NuevaCitaStrings {
  title: string;
  sub: string;
  tzChip: string;
  modeClient: string;
  modeProspect: string;
  clientHint: string;
  prospectHint: string;
  searchClient: string;
  searchClientPh: string;
  emptyClients: string;
  searchProspect: string;
  searchProspectPh: string;
  emptyProspects: string;
  createProspect: string;
  prospectNamePh: string;
  prospectPhonePh: string;
  createProspectConfirm: string;
  rutaTitle: string;
  citaLabel: string; // "Cita {n} de {m}"
  prospectCita: string; // "Llamada informativa"
  date: string;
  hour: string;
  pickCaseFirst: string;
  loadingSlots: string;
  noSlots: string;
  clientEquiv: string; // "Para el cliente: {hour}"
  overlapWarn: string;
  outsideWarn: string;
  min: string; // "min"
  modalityVideo: string;
  modalityPhone: string;
  modalityPresencial: string;
  remindersInfo: string;
  note: string;
  notePh: string;
  cancel: string;
  create: string;
  createAnyway: string;
  createdClient: string; // "✓ Cita creada · {name}"
  createdProspect: string;
  change: string;
}

export interface NuevaCitaActions {
  searchCases: (
    query: string,
  ) => Promise<{ ok: boolean; results?: ClientSearchResult[]; error?: { code: string } }>;
  getCaseContext: (
    caseId: string,
  ) => Promise<{ ok: boolean; context?: CaseBookingContext; error?: { code: string } }>;
  searchProspects: (
    query: string,
  ) => Promise<{ ok: boolean; results?: ProspectSearchResult[]; error?: { code: string } }>;
  getProspectSlots: () => Promise<{
    ok: boolean;
    context?: ProspectSlotsContext;
    error?: { code: string };
  }>;
  createProspectInline: (input: {
    phone: string;
    name: string | null;
  }) => Promise<{ ok: boolean; leadId?: string; error?: { code: string } }>;
  bookAppointment: (input: {
    caseId: string;
    startsAtIso: string;
    note: string;
    force: boolean;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  createProspectAppointment: (input: {
    leadId: string;
    startsAtIso: string;
    durationMinutes: number;
    note: string;
    force: boolean;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
}
