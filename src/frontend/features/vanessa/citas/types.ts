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

export interface ClientSearchResult {
  caseId: string;
  name: string;
  serviceLabel: string;
  seqLabel: string; // "Cita 2 de 3"
  phone: string;
  clientTz: string | null;
}

export interface ProspectSearchResult {
  leadId: string;
  name: string | null;
  phone: string;
  source: string;
  sourceLabel: string;
}

export interface NuevaCitaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetLeadId?: string | null;
  staffTz: string;
  locale: "es" | "en";
  slots: string[]; // ISO instants available (30-min)
  daysOptions: { value: string; label: string }[];
  clientResults: ClientSearchResult[];
  prospectResults: ProspectSearchResult[];
  apptTypeOptions: { value: ApptKind; label: string }[];
  /** Default duration (min) for prospect/evaluation citas (Mi disponibilidad). */
  prospectDuration?: number;
  strings: NuevaCitaStrings;
  actions: NuevaCitaActions;
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
  apptType: string;
  apptTypeHint: string;
  callType: string;
  date: string;
  hour: string;
  clientEquiv: string; // "Para el cliente, en {state}: {hour}"
  overlapWarn: string;
  outsideWarn: string;
  duration: string;
  durationHint: string;
  modality: string;
  video: string;
  phone: string;
  videoHint: string;
  remind1d: string;
  remind1h: string;
  note: string;
  notePh: string;
  cancel: string;
  create: string;
  createAnyway: string;
  createdClient: string; // "✓ Cita creada · {name} · {type}"
  createdProspect: string;
  change: string;
}

export interface NuevaCitaActions {
  bookAppointment: (input: {
    caseId: string;
    apptType: ApptKind;
    startsAtIso: string;
    durationMinutes: number;
    modality: "video" | "phone";
    reminder1d: boolean;
    reminder1h: boolean;
    note: string;
    force: boolean;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
  createProspectAppointment: (input: {
    leadId: string;
    startsAtIso: string;
    durationMinutes: number;
    modality: "video" | "phone";
    note: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
}
