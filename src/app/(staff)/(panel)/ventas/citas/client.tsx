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
  prospectDuration?: number;
  actions: {
    book: NuevaCitaActions["bookAppointment"];
    prospect: NuevaCitaActions["createProspectAppointment"];
    complete: (input: {
      appointmentId: string;
      objectivesOutcome: { id: string; text: string; achieved: boolean }[];
      notes: string;
    }) => Promise<{ ok: boolean }>;
    reschedule: (input: { appointmentId: string; startsAtIso: string }) => Promise<{ ok: boolean }>;
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
  prospectDuration,
  actions,
}: CitasClientProps) {
  return (
    <LexPrefsProvider>
      <CitasView
        calDays={calDays}
        hours={hours}
        events={events}
        listItems={events}
        staffTz={staffTz}
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
          prospectDuration,
          strings: nuevaCitaStrings,
          actions: { bookAppointment: actions.book, createProspectAppointment: actions.prospect },
        }}
        onComplete={({ id, outcome, notes }) =>
          actions.complete({ appointmentId: id, objectivesOutcome: outcome, notes })
        }
        onReschedule={({ id, startsAtIso }) =>
          actions.reschedule({ appointmentId: id, startsAtIso })
        }
        onCancel={({ id, reason }) => actions.cancel({ appointmentId: id, reason })}
        onNoShow={(id) => actions.noShow({ appointmentId: id })}
      />
    </LexPrefsProvider>
  );
}
