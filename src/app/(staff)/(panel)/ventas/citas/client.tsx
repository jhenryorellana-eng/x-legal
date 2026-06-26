"use client";

/**
 * Citas client wrapper — provides Lex prefs and adapts the page-level scheduling
 * actions to the CitasView shape. The Nueva cita modal is now search-driven and
 * on-demand: it receives the search/context/booking actions and loads everything
 * (clients, prospects, slots, route) lazily — no precomputed arrays.
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
    searchCases: NuevaCitaActions["searchCases"];
    getCaseContext: NuevaCitaActions["getCaseContext"];
    searchProspects: NuevaCitaActions["searchProspects"];
    getProspectSlots: NuevaCitaActions["getProspectSlots"];
    createProspectInline: NuevaCitaActions["createProspectInline"];
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
          strings: nuevaCitaStrings,
          actions: {
            searchCases: actions.searchCases,
            getCaseContext: actions.getCaseContext,
            searchProspects: actions.searchProspects,
            getProspectSlots: actions.getProspectSlots,
            createProspectInline: actions.createProspectInline,
            bookAppointment: actions.book,
            createProspectAppointment: actions.prospect,
          },
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
