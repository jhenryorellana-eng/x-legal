/**
 * Mock data for the Vanessa panel dev preview (DOC-52, shapes from
 * V2/UI Vanessa/data.js — normative of the shape, not the content).
 *
 * Used ONLY by the (dev) preview route so Playwright can capture all 8 views
 * without a real staff session (mirrors the F1 admin-preview / F2 cliente-
 * preview harness). NEVER imported by production pages.
 */

import type {
  MiDiaKpi,
  AttendLead,
  AgendaItem,
  MiDiaTask,
  LeadColumnVM,
  LeadCardVM,
  CalDay,
  CitaEvent,
  CitaDetail,
  MetricKpi,
  FunnelStage,
  WeekBar,
  DonutVM,
  SourceRow,
  SecondaryCard,
  DayRule,
  ExceptionVM,
} from "@/frontend/features/vanessa";

// --- Mi día ---------------------------------------------------------------

export const MOCK_KPIS: MiDiaKpi[] = [
  { hot: true, icon: "bolt", value: 6, label: "Leads nuevos por contactar", flag: "Responde rápido" },
  { icon: "event", value: 4, label: "Citas de hoy", tone: "#8B5CF6" },
  { icon: "fact_check", value: 3, label: "Clientes esperando revisión", tone: "#F59E0B" },
  { icon: "verified", value: 5, label: "Cierres esta semana", tone: "#1BB673", trend: { dir: "up", label: "+2 vs sem. previa" } },
];

export const MOCK_ATTEND: AttendLead[] = [
  { id: "l1", title: "Lucía Hernández", source: "tiktok", sourceLabel: "TikTok", serviceLabel: "Visa Juvenil", minutes: 6, ageLabel: "hace 6 min", phone: "+13054128890" },
  { id: "l2", title: "+1 (786) 220‑1145", source: "voz", sourceLabel: "Agente de voz", serviceLabel: "Visa Juvenil", minutes: 14, ageLabel: "hace 14 min", phone: "+17862201145" },
  { id: "l3", title: "Carlos Mendoza", source: "whatsapp", sourceLabel: "WhatsApp", serviceLabel: "Visa Juvenil", minutes: 38, ageLabel: "hace 38 min", phone: "+14078893321" },
  { id: "l4", title: "Daniela Rojas", source: "web", sourceLabel: "Web", serviceLabel: "Visa Juvenil", minutes: 62, ageLabel: "hace 1 h", phone: "+13057705512" },
];

export const MOCK_AGENDA: AgendaItem[] = [
  { id: "a1", time: "9:30", tzAbbr: "ET", name: "Sofía Cabrera", kind: "c2", seqLabel: "Cita 2", objective: "Verificación y cartas", isCall: false, isVideo: true },
  { id: "a2", time: "11:00", tzAbbr: "ET", name: "Roberto Aguilar", kind: "c2", seqLabel: "Cita 2", objective: "Verificación y cartas", isCall: false, isVideo: true },
  { id: "a3", time: "2:00", tzAbbr: "ET", name: "Miguel Á. Soto", kind: "c1", seqLabel: "Cita 1", objective: "Inducción", isCall: false, isVideo: true },
  { id: "a4", time: "4:30", tzAbbr: "ET", name: "Llamada · Patricia Núñez", kind: "call", seqLabel: "Llamada", objective: "Llamada informativa", isCall: true, isVideo: false },
];

export const MOCK_TASKS: MiDiaTask[] = [
  { id: "t1", text: "Generar cartas de testigo · Sofía Cabrera", tag: "Cartas", done: false },
  { id: "t2", text: "Revisar 3 documentos de Roberto Aguilar", tag: "Documentos", done: false },
  { id: "t3", text: "Traspasar expediente de Laura Jiménez a Diana", tag: "Traspaso", done: false },
  { id: "t4", text: "Enviar guía de inicio · Miguel Á. Soto", tag: "Onboarding", done: true },
];

// --- Leads ----------------------------------------------------------------

export const MOCK_COLUMNS: LeadColumnVM[] = [
  { id: "nuevo", boardId: "mock-board", position: 1, title: "Nuevo", color: "#2F6BFF", isTerminalWon: false, isTerminalLost: false },
  { id: "contactado", boardId: "mock-board", position: 2, title: "Contactado", color: "#8B5CF6", isTerminalWon: false, isTerminalLost: false },
  { id: "llamada", boardId: "mock-board", position: 3, title: "Llamada agendada", color: "#F59E0B", isTerminalWon: false, isTerminalLost: false },
  { id: "seguimiento", boardId: "mock-board", position: 4, title: "En seguimiento", color: "#06B6D4", isTerminalWon: false, isTerminalLost: false },
  { id: "cerrar", boardId: "mock-board", position: 5, title: "Listo para cerrar", color: "#FFC629", isTerminalWon: false, isTerminalLost: false },
  { id: "ganado", boardId: "mock-board", position: 6, title: "Listo para contrato", color: "#1BB673", isTerminalWon: true, isTerminalLost: false },
  { id: "perdido", boardId: "mock-board", position: 7, title: "Rechazado", color: "#E4002B", isTerminalWon: false, isTerminalLost: true },
];

const CAT = {
  caliente: { id: "caliente", label: "Caliente", color: "#E4002B" },
  tibio: { id: "tibio", label: "Tibio", color: "#F59E0B" },
  frio: { id: "frio", label: "Frío", color: "#5B8CFF" },
  vip: { id: "vip", label: "VIP", color: "#FFC629" },
};

function card(o: Partial<LeadCardVM> & { id: string; phone: string; columnId: string }): LeadCardVM {
  const cat = o.categoryId ? CAT[o.categoryId as keyof typeof CAT] : null;
  return {
    id: o.id,
    leadId: o.leadId ?? o.id,
    columnId: o.columnId,
    name: o.name ?? null,
    phone: o.phone,
    source: o.source ?? "web",
    sourceLabel: o.sourceLabel ?? "Web",
    serviceId: o.serviceId ?? null,
    serviceLabel: o.serviceLabel ?? "Visa Juvenil",
    categoryId: cat?.id ?? null,
    categoryLabel: cat?.label ?? null,
    categoryColor: cat?.color ?? null,
    note: o.note ?? null,
    uncontacted: o.uncontacted ?? false,
    ageLabel: o.ageLabel ?? "hace 1 h",
    lostReason: o.lostReason ?? null,
  };
}

export const MOCK_CARDS: LeadCardVM[] = [
  card({ id: "l1", name: "Lucía Hernández", phone: "+13054128890", source: "tiktok", sourceLabel: "TikTok", categoryId: "caliente", columnId: "nuevo", uncontacted: true, ageLabel: "hace 6 min" }),
  card({ id: "l2", phone: "+17862201145", source: "voz", sourceLabel: "Agente de voz", categoryId: "caliente", columnId: "nuevo", uncontacted: true, ageLabel: "hace 14 min" }),
  card({ id: "l3", name: "Carlos Mendoza", phone: "+14078893321", source: "whatsapp", sourceLabel: "WhatsApp", categoryId: "tibio", columnId: "nuevo", uncontacted: true, ageLabel: "hace 38 min" }),
  card({ id: "l4", name: "Daniela Rojas", phone: "+13057705512", source: "web", sourceLabel: "Web", categoryId: "tibio", columnId: "nuevo", uncontacted: true, ageLabel: "hace 1 h" }),
  card({ id: "l5", name: "Andrés Gutiérrez", phone: "+18133340098", source: "tiktok", sourceLabel: "TikTok", categoryId: "frio", columnId: "contactado", ageLabel: "hace 3 h" }),
  card({ id: "l6", name: "María José Paredes", phone: "+17869912210", source: "ref", sourceLabel: "Referido", categoryId: "vip", columnId: "contactado", ageLabel: "hace 5 h" }),
  card({ id: "l7", name: "Jorge Salazar", phone: "+19541127745", source: "web", sourceLabel: "Web", categoryId: "tibio", columnId: "llamada", ageLabel: "ayer" }),
  card({ id: "l10", name: "Gabriela Ortiz", phone: "+17865532078", source: "ref", sourceLabel: "Referido", categoryId: "vip", columnId: "cerrar", ageLabel: "hace 2 d" }),
  card({ id: "l12", name: "Sofía Cabrera", phone: "+13058894410", source: "whatsapp", sourceLabel: "WhatsApp", categoryId: "caliente", columnId: "ganado", ageLabel: "hace 4 d" }),
  card({ id: "l14", name: "Renata Lozano", phone: "+19543301290", source: "web", sourceLabel: "Web", categoryId: "frio", columnId: "perdido", ageLabel: "hace 6 d", lostReason: "No elegible (edad)" }),
];

// --- Citas ----------------------------------------------------------------

export const MOCK_CAL_DAYS: CalDay[] = [
  { weekdayLabel: "LUN", dayNumber: 1, isToday: false },
  { weekdayLabel: "MAR", dayNumber: 2, isToday: false },
  { weekdayLabel: "MIÉ", dayNumber: 3, isToday: true },
  { weekdayLabel: "JUE", dayNumber: 4, isToday: false },
  { weekdayLabel: "VIE", dayNumber: 5, isToday: false },
];

export const MOCK_HOURS = ["9:00", "10:00", "11:00", "13:00", "14:00", "15:00"];

export const MOCK_EVENTS: CitaEvent[] = [
  { id: "e1", name: "Andrés G.", kind: "c1", seqLabel: "Cita 1", dayIndex: 0, slotIndex: 1, done: false, dayLabel: "Lun 1", time: "10:00", tzAbbr: "ET" },
  { id: "e2", name: "Llamada · Jorge S.", kind: "call", seqLabel: "Llamada", dayIndex: 0, slotIndex: 4, done: false, dayLabel: "Lun 1", time: "2:00", tzAbbr: "ET" },
  { id: "e3", name: "Daniela R.", kind: "c1", seqLabel: "Cita 1", dayIndex: 1, slotIndex: 0, done: true, dayLabel: "Mar 2", time: "9:00", tzAbbr: "ET" },
  { id: "e4", name: "Roberto A.", kind: "c2", seqLabel: "Cita 2", dayIndex: 1, slotIndex: 3, done: false, dayLabel: "Mar 2", time: "1:00", tzAbbr: "ET" },
  { id: "e5", name: "Sofía Cabrera", kind: "c2", seqLabel: "Cita 2", dayIndex: 2, slotIndex: 1, done: false, dayLabel: "Mié 3", time: "10:00", tzAbbr: "ET" },
  { id: "e6", name: "Miguel Á. Soto", kind: "c1", seqLabel: "Cita 1", dayIndex: 2, slotIndex: 5, done: false, dayLabel: "Mié 3", time: "3:00", tzAbbr: "ET" },
  { id: "e7", name: "Laura Jiménez", kind: "c3", seqLabel: "Cita 3", dayIndex: 3, slotIndex: 0, done: false, dayLabel: "Jue 4", time: "9:00", tzAbbr: "ET" },
  { id: "e8", name: "Gabriela O.", kind: "c1", seqLabel: "Cita 1", dayIndex: 4, slotIndex: 2, done: false, dayLabel: "Vie 5", time: "11:00", tzAbbr: "ET" },
];

export const MOCK_DETAILS: Record<string, CitaDetail> = {
  e5: {
    id: "e5",
    name: "Sofía Cabrera",
    dayTime: "Mié 3 · 10:00 AM EDT",
    clientHour: "8:00 AM MDT (cliente)",
    typeLabel: "Cita 2 · Verificación y cartas",
    isVideo: true,
    videoLink: "https://us06web.zoom.us/j/0000000000",
    status: "scheduled",
    lexHtml: "<b>Lex:</b> Recuerda generar las cartas antes de terminar.",
    clientNote:
      "Quiero confirmar si necesito traer los originales de mis documentos o basta con las copias.",
    notes: null,
    objectives: [
      { id: "o1", text: "Auditar que la info esté completa" },
      { id: "o2", text: "Corregir en vivo lo que falte" },
      { id: "o3", text: "Generar cartas (testigos / abandono)" },
      { id: "o4", text: "Explicar firma ante notario" },
      { id: "o5", text: "Pedir subir cartas y agendar Cita 3" },
    ],
    objectivesOutcome: null,
  },
};

// --- Métricas -------------------------------------------------------------

export const MOCK_MET_KPIS: MetricKpi[] = [
  { label: "Cierres (contratos firmados)", value: "5", trend: 2, hint: "esta semana" },
  { label: "Leads nuevos", value: "34", trend: 8, hint: "esta semana" },
  { label: "Listos para Diana", value: "3", trend: 1, hint: "docs + formularios completos" },
  { label: "Conversión Lead → Contrato", value: "24%", trend: 3, hint: "vs 21% sem. previa" },
];

export const MOCK_FUNNEL: FunnelStage[] = [
  { label: "Leads", count: 34, pct: 100, drop: null },
  { label: "Contactados", count: 29, pct: 85, drop: null },
  { label: "Cita agendada", count: 19, pct: 56, drop: "-29%" },
  { label: "Cita asistida", count: 15, pct: 44, drop: null },
  { label: "Contrato", count: 8, pct: 24, drop: "-20%" },
  { label: "Traspasado a Diana", count: 3, pct: 9, drop: null },
];

export const MOCK_WEEK_BARS: WeekBar[] = [
  { label: "Lun", value: 62, isToday: false },
  { label: "Mar", value: 78, isToday: false },
  { label: "Mié", value: 45, isToday: true },
  { label: "Jue", value: 90, isToday: false },
  { label: "Vie", value: 70, isToday: false },
  { label: "Sáb", value: 30, isToday: false },
  { label: "Dom", value: 12, isToday: false },
];

export const MOCK_DONUTS: DonutVM[] = [
  { pct: 88, color: "var(--brand-green)", label: "Asistencia a citas", sub: "citas" },
  { pct: 62, color: "var(--accent)", label: "Formularios completos", sub: "prom." },
  { pct: 75, color: "var(--brand-gold)", label: "Documentos aprobados", sub: "docs" },
];

export const MOCK_SOURCES: SourceRow[] = [
  { label: "TikTok", count: 14, pct: 41, conv: "26%", gradient: "linear-gradient(90deg,#25F4EE,#FE2C55)" },
  { label: "WhatsApp", count: 9, pct: 26, conv: "31%", gradient: "linear-gradient(90deg,#25D366,#128C7E)" },
  { label: "Web", count: 7, pct: 21, conv: "18%", gradient: "linear-gradient(90deg,#2F6BFF,#5B8CFF)" },
  { label: "Agente de voz", count: 4, pct: 12, conv: "22%", gradient: "linear-gradient(90deg,#8B5CF6,#6D28D9)" },
];

export const MOCK_SECONDARY: SecondaryCard[] = [
  { icon: "bolt", label: "Velocidad 1er contacto", value: "7 min", sub: "meta < 5 min", tone: "amber" },
  { icon: "event_available", label: "Asistencia a citas", value: "88%", sub: "No-shows: 2", tone: "green" },
  { icon: "schedule", label: "Tiempo de ciclo", value: "17 días", sub: "meta 2–3 semanas", tone: "blue" },
  { icon: "replay", label: "Reprogramaciones", value: "4", sub: "esta semana", tone: "blue" },
];

// --- Disponibilidad -------------------------------------------------------

export const MOCK_DAYS: DayRule[] = [
  { weekday: 1, dayName: "Lunes", active: true, ranges: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "17:00" }] },
  { weekday: 2, dayName: "Martes", active: true, ranges: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "17:00" }] },
  { weekday: 3, dayName: "Miércoles", active: true, ranges: [{ start: "10:00", end: "13:00" }] },
  { weekday: 4, dayName: "Jueves", active: true, ranges: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "17:00" }] },
  { weekday: 5, dayName: "Viernes", active: true, ranges: [{ start: "09:00", end: "13:00" }] },
  { weekday: 6, dayName: "Sábado", active: false, ranges: [] },
  { weekday: 0, dayName: "Domingo", active: false, ranges: [] },
];

export const MOCK_EXCEPTIONS: ExceptionVM[] = [
  { id: "x1", label: "Vacaciones", rangeLabel: "14–18 julio", affectedCount: 0 },
];

// --- Clientes -------------------------------------------------------------

export interface MockCase {
  id: string;
  name: string;
  service: string;
  members: string[];
  jur: string;
  updated: string;
  contractState: "borrador" | "enviado" | "firmado";
  cita: number;
  docs: [number, number];
  forms: number;
  ready?: boolean;
  multi?: boolean;
}

export const MOCK_CASES: MockCase[] = [
  { id: "k1", name: "Sofía Cabrera", service: "Visa Juvenil", members: ["Mateo", "Valentina"], jur: "Florida", updated: "hoy 09:12", contractState: "firmado", cita: 2, docs: [5, 8], forms: 80, multi: true },
  { id: "k2", name: "Sofía Cabrera", service: "Asilo Político", members: ["Sofía Cabrera"], jur: "Florida", updated: "hoy 10:30", contractState: "borrador", cita: 0, docs: [0, 5], forms: 0, multi: true },
  { id: "k3", name: "Miguel Ángel Soto", service: "Visa Juvenil", members: ["Camila"], jur: "Florida", updated: "ayer 16:40", contractState: "firmado", cita: 1, docs: [2, 6], forms: 35 },
  { id: "k4", name: "Laura Jiménez", service: "Visa Juvenil", members: ["Diego", "Emma"], jur: "Texas", updated: "hoy 08:05", contractState: "firmado", cita: 3, docs: [8, 8], forms: 100, ready: true },
  { id: "k5", name: "Roberto Aguilar", service: "Visa Juvenil", members: ["Tomás"], jur: "Georgia", updated: "hace 2 d", contractState: "enviado", cita: 2, docs: [4, 7], forms: 62 },
];
