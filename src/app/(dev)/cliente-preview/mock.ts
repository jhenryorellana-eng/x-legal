/**
 * Mock props for the cliente preview harness (Playwright evidence only).
 * Uses the prototype's demo data (María / Mateo / Visa Juvenil) — the visual SoT.
 * Dev-only; never imported by production pages.
 */

import type { DashboardScreenProps } from "@/frontend/features/cliente/home/dashboard-screen";
import type { CaminoScreenProps } from "@/frontend/features/cliente/camino/camino-screen";
import type { DocItem } from "@/frontend/features/cliente/documentos/documentos-screen";
import type { ProcesoMilestone } from "@/frontend/features/cliente/proceso/proceso-screen";

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
