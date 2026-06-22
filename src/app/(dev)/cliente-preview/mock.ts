/**
 * Mock props for the cliente preview harness (Playwright evidence only).
 * Uses the prototype's demo data (María / Mateo / Visa Juvenil) — the visual SoT.
 * Dev-only; never imported by production pages.
 */

import type { DashboardScreenProps } from "@/frontend/features/cliente/home/dashboard-screen";
import type { CaminoScreenProps } from "@/frontend/features/cliente/camino/camino-screen";
import type { DocItem } from "@/frontend/features/cliente/documentos/documentos-screen";
import type { ProcesoMilestone } from "@/frontend/features/cliente/proceso/proceso-screen";
import type {
  AgendarScreenProps,
  SlotWire,
} from "@/frontend/features/cliente/agendar/agendar-screen";
import type { CitaScreenProps } from "@/frontend/features/cliente/cita/cita-screen";
import { fromZonedTime } from "date-fns-tz";

export const homeMock: DashboardScreenProps = {
  displayName: "María",
  avatarInitial: "M",
  unreadCount: 2,
  cases: [
    {
      caseId: "demo",
      title: "Visa Juvenil — Mateo",
      phaseLabel: "Fase 1 de 3 · Custodia",
      serviceIcon: "shield",
      serviceColor: "#2F6BFF",
      progress: 46,
      pendingDocuments: 3,
      highlighted: true,
    },
    {
      caseId: "demo2",
      title: "Taxes 2025",
      phaseLabel: null,
      serviceIcon: "doc",
      serviceColor: "#F0A500",
      progress: 0,
      pendingDocuments: 0,
      highlighted: false,
      statusText: "En revisión",
      statusKind: "revision",
    },
  ],
  labels: {
    greetingEyebrow: "¡Buen día!",
    greeting: "Hola, {name}",
    yourCases: "Tus casos",
    documentsLeft: "Te faltan {n} documentos",
    openCase: "Abrir caso",
    quickAccess: "Accesos rápidos",
    qServices: "Servicios",
    qServicesSub: "Ver catálogo",
    qPayments: "Pagos",
    qPaymentsSub: "Próximos pagos",
    qCommunity: "Comunidad",
    qCommunitySub: "Familias como tú",
    qSettings: "Configuración",
    qSettingsSub: "Idioma, tema",
    bellAria: "Ver notificaciones",
    avatarAria: "Ir a configuración",
  },
};

export const caminoMock: CaminoScreenProps = {
  caseId: "demo",
  serviceName: "Visa Juvenil",
  caseTitle: "Caso de Mateo",
  partyInitial: "M",
  fullServiceName: "Visa Juvenil (SIJS)",
  phaseIndex: 1,
  phaseCount: 3,
  phaseName: "Custodia",
  phaseDescription: "Construyendo la base de tu caso",
  progress: 46,
  docsDone: 3,
  docsTotal: 7,
  docsPending: 3,
  docsComplete: false,
  firstVisit: false,
  currentMilestoneLabel: "Orden de custodia",
  labels: {
    backCases: "Mis casos",
    deliveryEstimate: "Entrega estimada",
    encourageSuffix: "Tu proceso de {service} va por buen camino.",
    phaseChip: "Fase {x} de {y}",
    nextStep: "Tu siguiente paso",
    nextDocsTitle: "Sube {n} documentos de {phase}",
    nextDocsBody: "Es rápido: toma una foto y nosotros la convertimos en PDF.",
    nextFormTitle: "Cuéntanos tu historia",
    nextFormBody: "Responde unas preguntas con tus palabras.",
    continue: "Continuar",
    myProcess: "Mi proceso",
    view: "Ver",
    inProgressSuffix: "· en curso",
    nextMeeting: "Próxima cita",
    documents: "Documentos",
    documentsValue: "{x} de {y} completados",
    forms: "Formularios",
    formsValue: "{n} pendiente",
    noMeeting: "Aún sin agendar",
  },
  tutorialLabels: {
    step1Title: "Empecemos por aquí",
    step1Body:
      "Toca «Continuar» para subir tus documentos. Yo te guío en cada paso — no te preocupes.",
    step2Title: "Lo lograste = celebramos",
    step2Body:
      "Cada vez que completes algo, lo celebramos juntos. Verás cómo avanza tu caso.",
    step3Title: "Siempre estoy contigo",
    step3Body:
      "Si tienes dudas, toca «Tu equipo» abajo a la izquierda. Personas reales te responden cuando quieras.",
    skip: "Saltar",
    next: "Siguiente",
    done: "¡Entendido!",
  },
};

const docItems: DocItem[] = [
  {
    key: "1",
    label: "Acta de nacimiento del menor",
    category: "Identidad",
    status: "aprobado",
    rejectionReason: null,
    query: "req=1",
  },
  {
    key: "2",
    label: "Pasaporte o ID del menor",
    category: "Identidad",
    status: "revision",
    rejectionReason: null,
    query: "req=2",
  },
  {
    key: "3",
    label: "Foto reciente del menor",
    category: "Identidad",
    status: "aprobado",
    rejectionReason: null,
    query: "req=3",
  },
  {
    key: "4",
    label: "Comprobante de domicilio",
    category: "Legal",
    status: "corregir",
    rejectionReason: "Se ve borroso. Vuelve a escanearlo.",
    query: "req=4",
  },
  {
    key: "5",
    label: "Orden de custodia",
    category: "Legal",
    status: "pendiente",
    rejectionReason: null,
    query: "req=5",
  },
  {
    key: "6",
    label: "Declaración del tutor",
    category: "Legal",
    status: "pendiente",
    rejectionReason: null,
    query: "req=6",
  },
  {
    key: "7",
    label: "Identificación del tutor",
    category: "Legal",
    status: "pendiente",
    rejectionReason: null,
    query: "req=7",
  },
];

export const documentosMock = {
  items: docItems,
  done: 3,
  total: 7,
  progress: 43,
  phaseName: "Custodia",
  caseId: "demo",
  labels: {
    title: "Mis Documentos",
    subtitle: "Sube los de tu fase de {phase}. Solo PDF escaneado (no fotos).",
    ofWord: "de",
    completed: "documentos completados",
    tip: "Consejo: usa la cámara para escanear. Lex te muestra cómo.",
    approved: "Aprobado",
    inReview: "En revisión",
    upload: "Subir",
    fix: "Corregir",
  },
};

export const disclaimerMock = {
  caseId: "demo",
  closing:
    "Al firmar este aviso confirmas que lo leíste y estás de acuerdo con estas condiciones para abrir tu caso en el portal.",
  sections: [
    {
      title: "1. Naturaleza del servicio",
      body:
        "UsaLatinoPrime te acompaña en la preparación y presentación de tu trámite migratorio. No garantizamos un resultado específico, ya que la decisión final corresponde a las autoridades (USCIS, cortes y otras entidades).",
    },
    {
      title: "2. Información veraz",
      body:
        "Te comprometes a entregar información y documentos verdaderos y completos. Proporcionar datos falsos puede afectar gravemente tu caso y es tu responsabilidad.",
    },
    {
      title: "3. Protección de tus datos",
      body:
        "Tu información se almacena de forma segura y solo la usamos para gestionar tu caso. No la compartimos con terceros salvo cuando el trámite lo exige ante la autoridad correspondiente.",
    },
    {
      title: "4. Comunicación",
      body:
        "Las recomendaciones de tu equipo no constituyen una garantía legal absoluta. Los tiempos de respuesta de las autoridades están fuera de nuestro control.",
    },
    {
      title: "5. Pagos",
      body:
        "Los honorarios y el plan de pagos se rigen por tu contrato. Las tarifas oficiales del gobierno no son reembolsables una vez presentadas.",
    },
  ],
  labels: {
    brandPrime: "PRIME",
    title: "Antes de empezar",
    subtitle: "Lee este aviso hasta el final y firma para abrir tu caso.",
    scrollHint: "Desliza hasta el final para continuar",
    yourSignature: "Tu firma",
    checkbox: "Leí y acepto el aviso. Mi firma es válida para abrir mi caso.",
    accept: "Aceptar y continuar",
    closing:
      "Al firmar este aviso confirmas que lo leíste y estás de acuerdo con estas condiciones para abrir tu caso en el portal.",
    errGeneric: "No pudimos guardar tu firma. Inténtalo de nuevo, sin prisa.",
  },
  signatureLabels: {
    draw: "Dibujar",
    upload: "Subir imagen",
    placeholder: "Firma aquí con tu dedo",
    legend: "Firma del titular",
    uploadPrompt: "Toca para subir tu firma",
    required: "Tu firma es obligatoria",
    ready: "Firma lista",
    clear: "Borrar",
    undo: "Deshacer",
  },
};

const procesoMilestones: ProcesoMilestone[] = [
  {
    id: "1",
    title: "Orden de custodia (corte estatal)",
    description: "El juez decide sobre la custodia y los hallazgos.",
    icon: "scale",
    state: "current",
    progress: 46,
    glossary: {
      term: "Orden de custodia",
      body: "Una corte estatal decide quién cuida legalmente al menor y reconoce que no puede reunirse con uno o ambos padres. Es la base de tu caso.",
    },
  },
  {
    id: "2",
    title: "Petición I-360 enviada a USCIS",
    description: "Enviamos tu petición especial a inmigración.",
    icon: "send",
    state: "next",
    progress: null,
    glossary: {
      term: "I-360",
      body: "Es la petición que se envía a inmigración (USCIS) para pedir el estatus especial de joven inmigrante.",
    },
  },
  {
    id: "3",
    title: "Recibo de USCIS",
    description: "USCIS confirma que recibió tu petición.",
    icon: "doc",
    state: "locked",
    progress: null,
    glossary: null,
  },
  {
    id: "4",
    title: "I-360 aprobada",
    description: "Inmigración aprueba tu estatus especial.",
    icon: "check",
    state: "locked",
    progress: null,
    glossary: null,
  },
];

export const procesoMock = {
  caseId: "demo",
  milestones: procesoMilestones,
  labels: {
    back: "Más",
    title: "Tu proceso avanza, María",
    subtitle: "Estás en la Fase 1 de 3. Vas muy bien.",
    inProgress: "En curso",
    next: "Siguiente",
    progress: "Progreso",
    completed: "¡Completado!",
    whatDoesThisMean: "¿Qué significa esto?",
    gotIt: "Entendido",
    whatsNext: "¿Qué sigue?",
    whatsNextBody:
      "Tu abogada está preparando tu orden de custodia. Te avisaremos en cuanto haya novedades.",
  },
};

// --- Scheduling (F3) -------------------------------------------------------
// Florida client, Utah office. Slots are real UTC instants built from local
// Florida wall-times so the dual hour renders "2:00 PM" / "12:00 PM en Utah".

const CLIENT_TZ = "America/New_York";
const OFFICE_TZ = "America/Denver";

/** Builds slots at Florida wall-times for the next two available weekdays. */
function buildMockSlots(): SlotWire[] {
  const out: SlotWire[] = [];
  const base = new Date();
  base.setDate(base.getDate() + 2); // start two days out (min notice)
  const hours = ["09:00", "10:00", "11:30", "14:00", "15:30", "16:30"];
  let added = 0;
  let cursor = new Date(base);
  while (added < 2) {
    const wd = cursor.getDay();
    if (wd !== 0 && wd !== 6) {
      const ymd = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      for (const h of hours) {
        const startUtc = fromZonedTime(`${ymd}T${h}:00`, CLIENT_TZ);
        const endUtc = new Date(startUtc.getTime() + 45 * 60_000);
        out.push({ startUtc: startUtc.toISOString(), endUtc: endUtc.toISOString() });
      }
      added++;
    }
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return out;
}

const agendarLabels = {
  title: "Agendar tu cita",
  subtitle: "Reserva un momento con tu asesora legal. La cita es por videollamada.",
  bannerTz: "Verás los horarios en tu hora local (Florida (ET)).",
  region: "Florida (ET)",
  monthAria: "Mes anterior y siguiente",
  prevMonth: "Mes anterior",
  nextMonth: "Mes siguiente",
  weekdays: "D L M M J V S",
  slotsTitle: "Horarios disponibles para el {date}",
  slotsLoading: "Buscando horarios…",
  pickDayFirst: "Elige un día con disponibilidad para ver los horarios.",
  noSlotsDay: "Agenda llena para ese día. Prueba con otro.",
  remindersTitle: "Recordatorios",
  reminder1d: "Recordarme 1 día antes",
  reminder1h: "Recordarme 1 hora antes",
  noteLabel: "Nota para tu asesora (opcional)",
  notePlaceholder: "¿Algo que quieras adelantarle? Escríbelo aquí…",
  penaltyNotice: "Si cancelas, no podrás reagendar por 7 días.",
  ctaIdle: "Elige un horario",
  ctaReady: "Confirmar cita",
  ctaReschedule: "Cambiar a este horario",
  ctaBooking: "Guardando…",
  inOffice: "{hora} en Utah",
  seqLabel: "Cita {n} de {total}",
  errSlotTaken: "Ese horario lo tomaron justo ahora. Elige otro de la lista actualizada.",
  errNoLeft: "Ya usaste las citas de esta etapa.",
  errGeneric: "No pudimos agendar tu cita. Inténtalo de nuevo en un momento.",
  errWindow: "Ya estás dentro de las 24 horas previas, así que no se puede cambiar.",
  back: "Inicio",
};

export const agendarMock: AgendarScreenProps = {
  caseId: "demo",
  clientTimezone: CLIENT_TZ,
  staffTimezone: OFFICE_TZ,
  initialSlots: buildMockSlots(),
  durationMinutes: 45,
  sequenceNumber: 1,
  appointmentCount: 1,
  locale: "es",
  labels: agendarLabels,
  getSlots: async () => ({ ok: true, slots: buildMockSlots() }),
  book: async () => ({ ok: true, appointmentId: "appt-demo" }),
  reschedule: async () => ({ ok: true, appointmentId: "appt-demo" }),
};

const citaLabels = {
  title: "¡Tu cita está agendada!",
  dateLabel: "Fecha",
  timeLabel: "Hora",
  withLabel: "Con",
  objectiveLabel: "Objetivo de la cita",
  joinCall: "Entrar a la videollamada",
  callSoon: "Pronto",
  callSoonNote: "Estamos terminando la videollamada dentro de la app. Te avisaremos cuando esté lista.",
  typePhone: "Tu cita será por teléfono. Te llamaremos a tu número.",
  typePresencial: "Tu cita será presencial en la oficina.",
  reminderNote: "Te enviaremos un recordatorio. Si necesitas cambiarla, puedes hacerlo hasta 24 horas antes.",
  backHome: "Volver al inicio",
  reschedule: "Cambiar cita",
  cancel: "Cancelar cita",
  completedChip: "Completada",
  completedTitle: "Tu cita ya pasó",
  completedBody: "Gracias por asistir. Si tu equipo dejó una nota, la verás aquí.",
  staffNoteLabel: "Nota de tu equipo",
  cancelTitle: "¿Cancelar tu cita?",
  cancelBody: "Si cancelas ahora, no podrás reagendar por 7 días. ¿Seguro que quieres cancelar?",
  cancelReasonPlaceholder: "Motivo (opcional)",
  cancelKeep: "Mantener mi cita",
  cancelConfirm: "Sí, cancelar",
  cancelling: "Cancelando…",
  errCancel: "No pudimos cancelar tu cita. Inténtalo de nuevo en un momento.",
  errReschedule: "No pudimos cambiar tu cita.",
  errWindow: "Ya estás dentro de las 24 horas previas, así que no se puede cambiar.",
};

export const citaMock: CitaScreenProps = {
  caseId: "demo",
  appointmentId: "appt-demo",
  dateText: "Jueves, 12 de junio",
  timeText: "2:00 PM (Florida (ET)) · 12:00 PM en Utah",
  advisorText: "Diana Restrepo, tu asesora",
  advisorInitial: "D",
  objectiveText: "Revisar tu orden de custodia antes de enviar la petición.",
  kind: "video",
  status: "scheduled",
  staffNote: null,
  celebrate: true,
  labels: citaLabels,
  cancelAppointment: async () => ({ ok: true }),
};

export const citaCompletadaMock: CitaScreenProps = {
  ...citaMock,
  status: "completed",
  celebrate: false,
  staffNote: "Conversamos sobre los próximos pasos. Sube la orden de custodia cuando la tengas.",
  cancelAppointment: async () => ({ ok: true }),
};
