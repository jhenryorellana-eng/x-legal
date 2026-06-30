"use client";

/**
 * Vanessa panel dev preview (client) — renders all 8 views with mock data so
 * Playwright can capture light/dark without a staff session (mirrors the F1
 * admin-preview / F2 cliente-preview harness). Actions are inert stubs that
 * resolve { ok:true }. NOT shipped to production (the page notFound()s in prod).
 */

import * as React from "react";
import {
  MiDiaView,
  LeadsView,
  CitasView,
  DisponibilidadView,
  MetricasView,
  ConfiguracionView,
  ClientesListView,
  LexPrefsProvider,
  LexDock,
  type CaseRowVM,
} from "@/frontend/features/vanessa";
import {
  MOCK_KPIS,
  MOCK_ATTEND,
  MOCK_AGENDA,
  MOCK_TASKS,
  MOCK_COLUMNS,
  MOCK_CARDS,
  MOCK_CAL_DAYS,
  MOCK_HOURS,
  MOCK_EVENTS,
  MOCK_DETAILS,
  MOCK_MET_KPIS,
  MOCK_FUNNEL,
  MOCK_WEEK_BARS,
  MOCK_DONUTS,
  MOCK_SOURCES,
  MOCK_SECONDARY,
  MOCK_DAYS,
  MOCK_EXCEPTIONS,
  MOCK_CASES,
} from "./mock";

const ok = async () => ({ ok: true });

type View = "mi-dia" | "leads" | "citas" | "disponibilidad" | "clientes" | "metricas" | "configuracion";

const STAFF_TZ = "America/New_York";

export function VentasPreviewClient({ view }: { view: View }) {
  return (
    <LexPrefsProvider>
      <div className="surface-staff" data-theme-scope style={{ minHeight: "100vh", padding: "20px 26px 60px" }}>
        {view === "mi-dia" && <MiDiaPreview />}
        {view === "leads" && <LeadsPreview />}
        {view === "citas" && <CitasPreview />}
        {view === "disponibilidad" && <DisponibilidadPreview />}
        {view === "clientes" && <ClientesPreview />}
        {view === "metricas" && <MetricasPreview />}
        {view === "configuracion" && <ConfiguracionPreview />}
        <LexDock
          greetingHtml="Buenos días, Vanessa ✨ Tienes <b>6 leads nuevos</b> sin contactar."
          statusLabel="Asistente · en línea"
          quickQuestions={[
            { label: "¿Qué atiendo primero?", answer: "Empieza por Lucía Hernández (TikTok), lleva 6 min sin contactar." },
            { label: "Resumen de hoy", answer: "4 citas, 6 leads por contactar y 3 docs por revisar." },
          ]}
        />
      </div>
    </LexPrefsProvider>
  );
}

function MiDiaPreview() {
  return (
    <MiDiaView
      kpis={MOCK_KPIS}
      attend={MOCK_ATTEND}
      agenda={MOCK_AGENDA}
      tasks={MOCK_TASKS}
      totalUncontacted={6}
      strings={{
        greeting: "Buenos días, Vanessa ☀️",
        dateLine: "Miércoles, 3 de junio · Sé exactamente por dónde empezar.",
        tzChip: "Hora local: Florida (ET)",
        attendTitle: "Por atender ahora",
        attendChip: "Velocidad = conversión",
        emptyAttend: "No tienes leads sin contactar 🎉",
        seeLeads: "Ver los {n} leads",
        agendaTitle: "Tu agenda de hoy",
        emptyAgenda: "Hoy no tienes citas.",
        tasksTitle: "Tareas pendientes",
        enterCall: "Entrar a la videollamada",
        call: "Llamar",
        whatsapp: "WhatsApp",
        schedule: "Agendar",
        lexBriefHtml:
          "<b>Tu prioridad #1 hoy:</b> 2 leads llevan demasiado tiempo sin respuesta. Empieza por <b>Lucía Hernández</b> (TikTok) — cada minuto cuenta.",
        lexContactLabel: "Contactar a Lucía Hernández",
        lexMessagingLabel: "Abrir mensajería",
        lexEnabled: true,
      }}
      actions={{ contactLead: ok, toggleTask: ok }}
      onScheduleLead={() => {}}
    />
  );
}

function LeadsPreview() {
  return (
    <LeadsView
      columns={MOCK_COLUMNS}
      cards={MOCK_CARDS}
      strings={{
        title: "Leads",
        sub: "Tu embudo de conversión · arrastra una tarjeta para moverla.",
        board: "Tablero",
        list: "Lista",
        filters: "Filtros",
        column: "Columna",
        manageCategories: "Categorías",
        newLead: "Nuevo lead",
        addLead: "Agregar lead",
        emptyCol: "Arrastra leads aquí",
        lexTipHtml:
          'Veo <b>4 leads sin contactar</b> en "Nuevo". Cuando muevas uno a <b>Ganado</b> (o pulses "Crear caso"), genero el contrato al instante.',
        lexOk: "Entendido",
        wonOfferHtml:
          "<b>{name}</b> pasó a <b>Ganado</b> 🎉 ¿Creo su caso ahora? El contrato es lo primero dentro del caso, listo para firmar.",
        createCase: "Crear caso",
        notNow: "Ahora no",
        call: "Llamar",
        whatsapp: "WhatsApp",
        agendar: "Agendar cita",
        createCaseTooltip: "Crear caso (genera el contrato)",
        lostTitle: "Marcar como perdido",
        lostBody: "Indica el motivo. La tarjeta lo mostrará como chip rojo.",
        lostReasonLabel: "Motivo",
        lostReasonPlaceholder: "Escribe el motivo de la pérdida…",
        confirm: "Confirmar",
        cancel: "Cancelar",
        lexEnabled: true,
        badgeRedmove: "No se pudo mover la tarjeta. Inténtalo de nuevo.",
      }}
      actions={{ moveCard: ok }}
      onNewLead={() => {}}
      onNewCase={() => {}}
      onScheduleLead={() => {}}
      onOpenColumnMenu={() => {}}
      onOpenFilters={() => {}}
      onManageCategories={() => {}}
    />
  );
}

function CitasPreview() {
  return (
    <CitasView
      calDays={MOCK_CAL_DAYS}
      hours={MOCK_HOURS}
      events={MOCK_EVENTS}
      listItems={MOCK_EVENTS}
      staffTz={STAFF_TZ}
      strings={{
        title: "Citas",
        sub: "Semana del 1–5 de junio · domina tu agenda y el avance de cada cliente.",
        newAppt: "Nueva cita",
        tzChip: "Florida (ET)",
        day: "Día",
        week: "Semana",
        list: "Lista",
        legend: { c1: "Cita 1", c2: "Cita 2", c3: "Cita 3", call: "Llamada" },
        filterAll: "Todas",
        filterAppts: "Citas de cliente",
        filterCalls: "Llamadas",
        emptyGrid: "Sin citas en este rango.",
        enterCall: "Entrar a la videollamada",
        reschedule: "Reprogramar",
        complete: "Completada",
        cancel: "Cancelar",
        noShow: "No-show",
        objectiveTitle: "Objetivo de la cita",
        completedToast: "✓ Cita marcada como completada",
        scheduledChip: "Agendada",
        completedChip: "Completada",
        completeModalTitle: "Completar cita",
        completeModalSub: "Marca qué objetivos se lograron. Se guardará en el caso.",
        achieved: "Logrado",
        notAchieved: "Pendiente",
        completeNote: "Nota (opcional)",
        completeNotePh: "Resumen de lo conversado…",
        confirmComplete: "Guardar y completar",
        noObjectives: "Sin objetivos definidos para esta cita.",
        outcomeTitle: "Resultado de la cita",
        rescheduleModalTitle: "Reprogramar cita",
        rescheduleNewLabel: "Nueva fecha y hora",
        rescheduleConfirm: "Reprogramar",
        rescheduledToast: "✓ Cita reprogramada",
        noVideoLink: "Sin enlace de videollamada",
        clientNoteTitle: "Nota del cliente",
        staffNotesTitle: "Notas internas",
        noShowChip: "No-show",
        cancelModalTitle: "Cancelar cita",
        cancelModalSub: "Se notificará al cliente y se liberará el horario. Indica el motivo de la cancelación.",
        cancelReasonLabel: "Motivo (obligatorio)",
        cancelReasonPh: "Ej. El cliente solicitó otra fecha…",
        cancelConfirm: "Cancelar cita",
        cancelKeep: "Volver",
        cancelledToast: "Cita cancelada",
        noShowModalTitle: "Marcar como no-show",
        noShowModalSub: "El cliente no se presentó. Esto aplica un bloqueo de reprogramación de 7 días.",
        noShowConfirm: "Confirmar no-show",
        noShowToast: "Cita marcada como no-show",
      }}
      detailFor={(id) => MOCK_DETAILS[id] ?? null}
      newApptModal={{
        staffTz: STAFF_TZ,
        locale: "es",
        strings: NUEVA_CITA_STRINGS,
        actions: {
          searchCases: async () => ({
            ok: true,
            results: [
              { caseId: "k1", name: "Sofía Cabrera", serviceLabel: "Visa Juvenil", phone: "+1 (305) 889‑4410", clientTz: "America/Denver" },
            ],
          }),
          getCaseContext: async () => ({
            ok: true,
            context: {
              slots: ["2026-06-12T13:00:00Z", "2026-06-12T13:30:00Z", "2026-06-12T14:00:00Z"],
              staffTimezone: STAFF_TZ,
              viewerTimezone: STAFF_TZ,
              durationMinutes: 30,
              kind: "video" as const,
              sequenceNumber: 2,
              seqLabel: "2/3",
              ruta: [
                { number: 1, label: "Inducción", kind: "video", status: "completed" },
                { number: 2, label: "Verificación", kind: "video", status: "current" },
                { number: 3, label: "Validación", kind: "video", status: "upcoming" },
              ],
            },
          }),
          searchProspects: async () => ({
            ok: true,
            results: [{ leadId: "l1", name: "Lucía Hernández", phone: "+1 (305) 412‑8890", source: "tiktok" }],
          }),
          getProspectSlots: async () => ({
            ok: true,
            context: {
              slots: ["2026-06-12T15:00:00Z", "2026-06-12T15:30:00Z"],
              staffTimezone: STAFF_TZ,
              viewerTimezone: STAFF_TZ,
              durationMinutes: 60,
              kind: "video" as const,
            },
          }),
          createProspectInline: async () => ({ ok: true, leadId: "l-new" }),
          bookAppointment: ok,
          createProspectAppointment: ok,
        },
      }}
      onComplete={ok}
      onReschedule={ok}
      onCancel={ok}
      onNoShow={ok}
    />
  );
}

const NUEVA_CITA_STRINGS = {
  title: "Nueva cita",
  sub: "Agéndala en segundos, conectada al caso o al lead correcto",
  tzChip: "Florida (ET)",
  modeClient: "Cliente",
  modeProspect: "Prospecto",
  clientHint: "Persona con caso activo (contrato firmado).",
  prospectHint: "Aún sin contrato — llamada informativa.",
  searchClient: "Buscar cliente o caso (nombre / teléfono)",
  searchClientPh: "Ej. Sofía, +1 305… o Visa Juvenil",
  emptyClients: 'Sin clientes con caso activo. Prueba con otro nombre o usa "Prospecto".',
  searchProspect: "Buscar prospecto (teléfono / nombre)",
  searchProspectPh: "Ej. Carlos o +1 786…",
  emptyProspects: "Sin prospectos. Crea uno nuevo abajo.",
  createProspect: "Crear prospecto",
  prospectNamePh: "Nombre (opcional)",
  prospectPhonePh: "Teléfono",
  createProspectConfirm: "Crear y continuar",
  rutaTitle: "Ruta de citas",
  citaLabel: "Cita {n} de {m}",
  prospectCita: "Llamada informativa",
  date: "Fecha",
  hour: "Hora",
  pickCaseFirst: "Selecciona un caso para ver los horarios.",
  loadingSlots: "Buscando horarios disponibles…",
  noSlots: "No hay horarios disponibles en las próximas semanas.",
  clientEquiv: "Para el cliente: {hour}",
  officeEquiv: "Hora de oficina ({region}): {hour}",
  overlapWarn: "Este horario se cruza con otra cita ya agendada. ¿Crear igualmente?",
  outsideWarn: "Este horario está fuera de tu disponibilidad. ¿Crear igualmente?",
  min: "min",
  modalityVideo: "Video",
  modalityPhone: "Llamada",
  modalityPresencial: "Presencial",
  remindersInfo: "Recordatorios: 1 día y 1 hora antes",
  note: "Nota (opcional)",
  notePh: "Contexto de la cita…",
  cancel: "Cancelar",
  create: "Crear cita",
  createAnyway: "Crear igualmente",
  createdClient: "✓ Cita creada · {name}",
  createdProspect: "✓ Llamada agendada · {name} · enlazada a Leads",
  change: "Cambiar",
};

function DisponibilidadPreview() {
  return (
    <DisponibilidadView
      days={MOCK_DAYS}
      exceptions={MOCK_EXCEPTIONS}
      defaultDuration={45}
      minNotice={24}
      remindersEnabled
      noShowPenaltyDays={7}
      videoLink="https://meet.usalatinoprime.com/vanessa"
      staffTz={STAFF_TZ}
      blockedClient={{ id: "k1", name: "Roberto Aguilar tiene bloqueo de reagendamiento activo." }}
      strings={{
        title: "Mi disponibilidad",
        sub: "Lo que abras aquí es lo que tus clientes podrán reservar.",
        tzChip: "Tu hora local: Florida (ET)",
        lexTipHtml:
          "Tus clientes verán estos horarios <b>en su propia zona horaria</b> automáticamente. Tip: deja al menos 2 bloques diarios.",
        weeklyTitle: "Horario semanal",
        notAvailable: "No disponible",
        range: "Rango",
        rulesTitle: "Reglas de la cita",
        duration: "Duración de cita",
        minNotice: "Antelación mínima para reservar",
        videoLink: "Enlace de videollamada",
        videoLinkPh: "https://… (tu sala personal)",
        remindersTitle: "Recordatorios y reglas",
        autoReminders: "Recordatorios automáticos al cliente",
        autoRemindersSub: "1 día y 1 hora antes de la cita",
        noShowNotice: "Penalización por no-show: el cliente no podrá reagendar durante {days} días.",
        blocksTitle: "Bloqueos / días libres",
        addBlock: "Agregar bloqueo",
        save: "Guardar cambios",
        saved: "✓ Disponibilidad guardada",
        rangeModalTitle: "Agregar rango horario",
        startLabel: "Inicio",
        endLabel: "Fin",
        crossMidnight: "Termina al día siguiente.",
        cancel: "Cancelar",
        add: "Agregar",
        blockModalTitle: "Agregar bloqueo",
        blockLabelField: "Etiqueta",
        blockReason: "Ej. Vacaciones",
        blockFromLabel: "Desde",
        blockToLabel: "Hasta",
        blockInvalidRange: "La fecha de fin debe ser posterior a la de inicio.",
        blockAffectsConfirm: "Este bloqueo afecta {n} cita(s) agendada(s). ¿Crear igualmente?",
        affectsNotice: "Afecta {n} citas agendadas.",
        liftBlock: "Levantar bloqueo de reagendamiento",
        liftBlockDone: "✓ Bloqueo levantado",
        invalidRange: "El fin debe ser posterior al inicio.",
        lexEnabled: true,
      }}
      actions={{
        saveRules: ok,
        addException: ok,
        removeException: ok,
        updateSettings: ok,
        liftRebookingBlock: ok,
      }}
    />
  );
}

function MetricasPreview() {
  return (
    <MetricasView
      kpis={MOCK_MET_KPIS}
      funnel={MOCK_FUNNEL}
      weekBars={MOCK_WEEK_BARS}
      donuts={MOCK_DONUTS}
      sources={MOCK_SOURCES}
      secondary={MOCK_SECONDARY}
      period="week"
      strings={{
        title: "Métricas",
        sub: "Tu desempeño y el estado de tu embudo, en lenguaje claro.",
        thisWeek: "Esta semana",
        month: "Mes",
        custom: "Personalizado",
        lexTipHtml:
          "Buen progreso: tu conversión subió a <b>24%</b> (+3 pts). El mayor escape está en <b>Contactado → Cita agendada (-29%)</b>.",
        funnelTitle: "Embudo de conversión",
        activityTitle: "Actividad de la semana",
        clientsTitle: "Clientes en proceso",
        sourcesTitle: "Leads por fuente",
        lexEnabled: true,
      }}
      onPeriodChange={() => {}}
    />
  );
}

function ConfiguracionPreview() {
  return (
    <ConfiguracionView
      locale="es"
      actions={{ setLocale: ok }}
      push={{
        vapidPublicKey: undefined,
        registerAction: async () => ({ success: true }),
        removeAction: async () => ({ success: true }),
      }}
      strings={{
        title: "Configuración",
        sub: "Tu cuenta, tema y preferencias del panel.",
        name: "Vanessa Ríos",
        role: "Asesora de citas",
        email: "vanessa@usalatinoprime.com",
        tzChip: "Florida (ET)",
        edit: "Editar",
        appearance: "Apariencia",
        darkMode: "Modo oscuro",
        darkModeSub: "Ideal para sesiones largas",
        textSize: "Tamaño del texto",
        accent: "Color de acento",
        lexTitle: "Lex · asistente IA",
        lexBubbles: "Burbujas proactivas",
        lexBubblesSub: "Lex sugiere la siguiente acción en cada pantalla",
        language: "Idioma",
        spanish: "Español",
        english: "English",
        saved: "✓ Cambios guardados",
        pushTitle: "Notificaciones push",
        pushSub: "Recibe avisos en este dispositivo",
        pushEnabled: "Activadas en este dispositivo",
        pushUnsupported: "Este navegador no soporta notificaciones push",
        pushDenied: "Permiso bloqueado en el navegador",
      }}
    />
  );
}

function ClientesPreview() {
  const rows: CaseRowVM[] = MOCK_CASES.map((c, i) => ({
    id: c.id,
    caseNumber: `ULP-2026-${String(1000 + i)}`,
    clientName: c.name,
    phone: "+1 (305) 555-01" + String(10 + i),
    serviceLabel: c.service,
    members: c.members,
    jurisdiction: c.jur,
    updatedLabel: c.updated,
    contractState: c.contractState,
    seqIndex: c.cita,
    seqTotal: 3,
    docsApproved: c.docs[0],
    docsTotal: c.docs[1],
    formsPct: c.forms,
    ready: c.ready ?? false,
    sameClient: c.multi ?? false,
  }));
  return (
    <ClientesListView
      cases={rows}
      basePath="/ventas/clientes"
      onNewCase={() => {}}
      readyClientName="Laura Jiménez"
      readyCaseId="k4"
      strings={{
        title: "Mis clientes",
        sub: "Cada fila es un caso (1 contrato = 1 caso). Un cliente puede tener varios.",
        byCase: "Por caso",
        byClient: "Por cliente",
        newCase: "Nuevo caso",
        lexTipHtml:
          "<b>{name}</b> tiene todo completo y está lista para <b>traspasar a Diana</b>.",
        openTo: "Abrir a {name}",
        pendingSign: "Pendiente de firma",
        readyDiana: "Listo para Diana",
        sameClient: "mismo cliente",
        sendContract: "Enviar contrato",
        docs: "Docs {x}/{y}",
        forms: "{f}% forms",
        empty: "Aún no hay clientes en el sistema.",
        caseCount: "{n} casos",
        caseCountOne: "{n} caso",
        searchPlaceholder: "Buscar por nombre, número de caso o teléfono…",
        searchEmpty: "Ningún cliente coincide con tu búsqueda.",
        lexEnabled: true,
      }}
    />
  );
}
