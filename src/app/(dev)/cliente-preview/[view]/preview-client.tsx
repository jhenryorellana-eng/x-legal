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
import {
  homeMock,
  caminoMock,
  documentosMock,
  disclaimerMock,
  procesoMock,
  agendarMock,
  citaMock,
  citaCompletadaMock,
} from "../mock";

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
    content = <CaminoScreen {...caminoMock} />;
  } else if (view === "documentos") {
    content = <DocumentosScreen {...documentosMock} />;
  } else if (view === "disclaimer") {
    content = (
      <DisclaimerScreen
        {...disclaimerMock}
        acceptTerms={async () => ({ ok: true as const })}
      />
    );
  } else if (view === "proceso") {
    content = <ProcesoScreen {...procesoMock} />;
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
