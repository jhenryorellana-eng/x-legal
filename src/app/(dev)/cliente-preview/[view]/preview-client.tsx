"use client";

import * as React from "react";
import { DashboardScreen } from "@/frontend/features/cliente/home/dashboard-screen";
import { CaminoScreen } from "@/frontend/features/cliente/camino/camino-screen";
import { DocumentosScreen } from "@/frontend/features/cliente/documentos/documentos-screen";
import { DisclaimerScreen } from "@/frontend/features/cliente/disclaimer/disclaimer-screen";
import { ProcesoScreen } from "@/frontend/features/cliente/proceso/proceso-screen";
import { AgendarScreen } from "@/frontend/features/cliente/agendar/agendar-screen";
import { AgendarBlocked } from "@/frontend/features/cliente/agendar/agendar-blocked";
import { CitaScreen } from "@/frontend/features/cliente/cita/cita-screen";
import { EmptyCase } from "@/frontend/features/cliente/shared/empty-case";
import { FormWizard } from "@/frontend/features/form-wizard";
import {
  homeMock,
  caminoMock,
  documentosMock,
  disclaimerMock,
  agendarMock,
  citaMock,
  citaCompletadaMock,
} from "../mock";
import {
  wizardFormMock,
  historiaFormMock,
  wizardSubmittedMock,
  wizardLabelsMock,
} from "../wizard-mock";

/**
 * Dev-only cliente preview switcher (Playwright evidence). Renders each client
 * screen with mock props + no-op actions inside the 430px mobile frame. Never
 * reachable in production (the page 404s).
 */
export function ClientePreview({ view }: { view: string }) {
  let content: React.ReactNode = null;

  if (view === "home") {
    content = <DashboardScreen {...homeMock} />;
  } else if (view === "camino") {
    content = (
      <CaminoScreen
        {...caminoMock}
        deliveryLabel="18 jul 2026"
        labels={{ ...caminoMock.labels, deliveryEstimate: "Entrega estimada" }}
      />
    );
  } else if (view === "documentos") {
    content = <DocumentosScreen {...documentosMock} onDelete={async () => ({ ok: true as const })} />;
  } else if (view === "disclaimer") {
    content = (
      <DisclaimerScreen
        {...disclaimerMock}
        acceptTerms={async () => ({ ok: true as const })}
      />
    );
  } else if (view === "proceso") {
    content = (
      <ProcesoScreen
        caseId="demo"
        items={[
          {
            kind: "milestone",
            id: "m1",
            title: "Recopilar sustentos",
            description: "Reúne los documentos que respaldan tu caso.",
            icon: "doc",
            state: "current",
            progress: 40,
            weekLabel: "Semana 1",
            glossary: { term: "Sustentos", body: "Los documentos que respaldan tu solicitud." },
          },
          {
            kind: "appointment",
            id: "a1",
            title: "Cita inicial",
            status: "booked",
            weekLabel: "Semana 1",
            dateLabel: "9 jul, 2:00 PM",
            href: "#",
          },
          {
            kind: "milestone",
            id: "m2",
            title: "Declaración preparada",
            description: "Tu historia queda lista para enviar.",
            icon: "edit",
            state: "next",
            progress: null,
            weekLabel: "Semana 3",
            glossary: null,
          },
          {
            kind: "appointment",
            id: "a2",
            title: "Cita de refuerzo",
            status: "unbooked",
            weekLabel: "Semana 5",
            dateLabel: null,
            href: "#",
          },
          {
            kind: "milestone",
            id: "m3",
            title: "I-589 enviada",
            description: "",
            icon: "route",
            state: "locked",
            progress: null,
            weekLabel: "Semana 6",
            glossary: null,
          },
        ]}
        labels={{
          back: "Más",
          title: "Tu proceso avanza, María",
          subtitle: "Estás en la Fase 1 de 2. Vas muy bien.",
          inProgress: "En curso",
          next: "Siguiente",
          progress: "Progreso",
          completed: "¡Completado!",
          whatDoesThisMean: "¿Qué significa esto?",
          gotIt: "Entendido",
          whatsNext: "¿Qué sigue?",
          whatsNextBody:
            "Tu equipo está trabajando en tu caso. Te avisaremos en cuanto haya novedades.",
          appointmentPill: "Cita",
          appointmentDone: "Cita completada",
          book: "Agendar",
          deliveryEstimate: "Entrega estimada del expediente",
          totalWeeksLabel: "~12 semanas",
          notStarted: null,
        }}
      />
    );
  } else if (view === "agendar") {
    content = <AgendarScreen {...agendarMock} />;
  } else if (view === "cita") {
    content = <CitaScreen {...citaMock} />;
  } else if (view === "cita-completada") {
    content = <CitaScreen {...citaCompletadaMock} />;
  } else if (view === "agendar-bloqueado") {
    content = (
      <AgendarBlocked
        title="Por ahora no puedes reagendar"
        body="Tras una cancelación, hacemos una pausa breve antes de volver a agendar. Podrás reservar de nuevo a partir del {date}."
        hint="Si es urgente, escríbele a tu asesora y vemos cómo ayudarte."
        unblockDate="jueves, 19 de junio de 2026"
      />
    );
  } else if (view === "agendar-vacio") {
    content = (
      <EmptyCase
        title="Agenda llena por ahora"
        body="No quedan horarios disponibles. Escríbele a tu asesora y te buscamos un espacio."
        lexMood="atento"
      />
    );
  } else if (view === "formulario") {
    content = (
      <FormWizard
        caseId="demo"
        partyId="party-mateo"
        partyName="Datos del menor — Mateo"
        form={wizardFormMock}
        locale="es"
        labels={wizardLabelsMock}
        saveDraft={async () => ({ ok: true, responseId: "resp-1" })}
        submitForm={async () => ({ ok: true, responseId: "resp-1" })}
      />
    );
  } else if (view === "formulario-prefill") {
    // Same form, but highlight the prefilled first step (Lex-free, chip visible).
    content = (
      <FormWizard
        caseId="demo"
        partyId="party-mateo"
        partyName="Datos del menor — Mateo"
        form={wizardFormMock}
        locale="es"
        labels={wizardLabelsMock}
        saveDraft={async () => ({ ok: true, responseId: "resp-1" })}
        submitForm={async () => ({ ok: true, responseId: "resp-1" })}
      />
    );
  } else if (view === "historia") {
    content = (
      <FormWizard
        caseId="demo"
        partyId={null}
        form={historiaFormMock}
        locale="es"
        labels={wizardLabelsMock}
        withLex
        lexChip="Te escucho con atención"
        saveDraft={async () => ({ ok: true, responseId: "resp-h" })}
        submitForm={async () => ({ ok: true, responseId: "resp-h" })}
      />
    );
  } else if (view === "formulario-enviado") {
    content = (
      <FormWizard
        caseId="demo"
        partyId="party-mateo"
        partyName="Datos del menor — Mateo"
        form={wizardSubmittedMock}
        locale="es"
        labels={wizardLabelsMock}
        saveDraft={async () => ({ ok: true })}
        submitForm={async () => ({ ok: true })}
      />
    );
  }

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        minHeight: "100dvh",
        position: "relative",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      {content}
    </div>
  );
}
