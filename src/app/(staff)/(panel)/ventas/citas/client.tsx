"use client";

/**
 * Citas client wrapper — provides Lex prefs and adapts the page-level scheduling
 * actions to the CitasView shape (complete/cancel/no-show return { ok }; book /
 * prospect feed the Nueva cita modal). Reschedule is a placeholder navigation in
 * F3 (opens the modal pre-filled is the next iteration).
 */

import * as React from "react";
import {
  CitasView,
  LexPrefsProvider,
  type CalDay,
  type CitaEvent,
  type CitaDetail,
  type CitasStrings,
  type NuevaCitaStrings,
  type NuevaCitaActions,
} from "@/frontend/features/vanessa";

export interface CitasClientProps {
  calDays: CalDay[];
  hours: string[];
  events: CitaEvent[];
  details: Record<string, CitaDetail>;
  staffTz: string;
  locale: "es" | "en";
  strings: CitasStrings;
  nuevaCitaStrings: NuevaCitaStrings;
  actions: {
    book: NuevaCitaActions["bookAppointment"];
    prospect: NuevaCitaActions["createProspectAppointment"];
    complete: (input: { appointmentId: string }) => Promise<{ ok: boolean }>;
    cancel: (input: { appointmentId: string; reason: string }) => Promise<{ ok: boolean }>;
    noShow: (input: { appointmentId: string }) => Promise<{ ok: boolean }>;
  };
}

export function CitasClient({
  calDays,
  hours,
  events,
  details,
  staffTz,
  locale,
  strings,
  nuevaCitaStrings,
  actions,
}: CitasClientProps) {
  return (
    <LexPrefsProvider>
      <CitasView
        calDays={calDays}
        hours={hours}
        events={events}
        listItems={events}
        strings={strings}
        detailFor={(id) => details[id] ?? null}
        newApptModal={{
          staffTz,
          locale,
          slots: [],
          daysOptions: [],
          clientResults: [],
          prospectResults: [],
          apptTypeOptions: [
            { value: "c1", label: strings.legend.c1 + " · Inducción" },
            { value: "c2", label: strings.legend.c2 + " · Verificación" },
            { value: "c3", label: strings.legend.c3 + " · Validación" },
          ],
          strings: nuevaCitaStrings,
          actions: { bookAppointment: actions.book, createProspectAppointment: actions.prospect },
        }}
        onComplete={(id) => actions.complete({ appointmentId: id })}
        onReschedule={() => {}}
        onCancel={(id) => actions.cancel({ appointmentId: id, reason: "rescheduled-by-staff" })}
        onNoShow={(id) => actions.noShow({ appointmentId: id })}
      />
    </LexPrefsProvider>
  );
}
