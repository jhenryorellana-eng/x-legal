"use client";

import * as React from "react";
import { DashboardScreen } from "@/frontend/features/cliente/home/dashboard-screen";
import { CaminoScreen } from "@/frontend/features/cliente/camino/camino-screen";
import { DocumentosScreen } from "@/frontend/features/cliente/documentos/documentos-screen";
import { DisclaimerScreen } from "@/frontend/features/cliente/disclaimer/disclaimer-screen";
import { ProcesoScreen } from "@/frontend/features/cliente/proceso/proceso-screen";
import {
  homeMock,
  caminoMock,
  documentosMock,
  disclaimerMock,
  procesoMock,
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
