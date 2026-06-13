"use client";

import * as React from "react";
import { MODULE_KEYS } from "@/shared/constants/modules";
import { ROLE_PRESETS } from "@/shared/constants/role-presets";
import { EmployeesView } from "@/frontend/features/admin/employees/employees-view";
import { CatalogListView } from "@/frontend/features/admin/catalog/catalog-list-view";
import { CatalogWizard } from "@/frontend/features/admin/catalog/catalog-wizard";
import { AuditClient } from "@/frontend/features/admin/audit/audit-client";
import { ConfigView } from "@/frontend/features/admin/config/config-view";
import { BrandToaster } from "@/frontend/components/desktop";
import {
  employeesMock,
  employeesMessages,
  catalogMessages,
  servicesMock,
  auditMessages,
  auditRowsMock,
  auditActorsMock,
  configMessages,
  orgMock,
  coversMock,
  termsMock,
  acceptancesMock,
  timezonesMock,
} from "../mock";

const noopRes = async () => ({ success: true as const });
const noopOkRes = async () => ({ ok: true as const });

/**
 * Dev-only preview switcher (Playwright evidence). Renders each admin view with
 * mock data + no-op actions. Never reachable in production (the page 404s).
 */
export function PreviewClient({ view }: { view: string }) {
  return (
    <div className="surface-staff" data-theme-scope style={{ minHeight: "100dvh", background: "var(--bg)" }}>
      <BrandToaster />
      {view === "empleados" && (
        <EmployeesView
          employees={employeesMock}
          moduleKeys={MODULE_KEYS}
          rolePresets={Object.fromEntries(
            Object.entries(ROLE_PRESETS).map(([role, m]) => [role, m]),
          )}
          messages={employeesMessages}
          actions={{ invite: noopOkRes, updatePermissions: noopOkRes, setActive: noopOkRes }}
        />
      )}

      {view === "catalogo" && (
        <CatalogListView
          services={servicesMock}
          messages={catalogMessages}
          newServiceHref="#"
          serviceBasePath="#"
          actions={{ archive: noopRes, restore: noopRes, setActive: noopRes, setPublic: noopRes }}
        />
      )}

      {view === "auditoria" && (
        <AuditClient
          initialRows={auditRowsMock}
          initialNextCursor={null}
          actors={auditActorsMock}
          entityTypes={["services", "form_automation_versions", "payments", "cases", "staff"]}
          messages={auditMessages}
          actions={{
            loadPage: async () => ({ ok: true, items: auditRowsMock, nextCursor: null }),
            exportCsv: async () => ({ ok: true, csv: "id,action\n" }),
          }}
        />
      )}

      {view === "nuevo-servicio" && (
        <CatalogWizard
          service={null}
          plans={[]}
          phases={[]}
          slugLocked={false}
          messages={catalogMessages}
          listHref="#"
          actions={{
            createService: async () => ({ success: true, data: { id: "new" } }),
            updateService: noopRes,
            upsertPlan: noopRes,
            createPhase: async () => ({ success: true, data: { id: "p1" } }),
            updatePhase: noopRes,
            deletePhase: noopRes,
            upsertPolicy: noopRes,
            createRequiredDoc: async () => ({ success: true, data: { id: "mock-doc" } }),
            activate: async () => ({ success: true, data: { ok: true, issues: [] } }),
          }}
        />
      )}

      {view === "configuracion" && (
        <ConfigView
          org={orgMock}
          covers={coversMock}
          terms={termsMock}
          acceptances={acceptancesMock}
          timezones={timezonesMock}
          messages={configMessages}
          actions={{ saveOrg: noopRes, setCoverActive: noopRes, createTerms: noopRes, publishTerms: noopRes }}
        />
      )}
    </div>
  );
}

