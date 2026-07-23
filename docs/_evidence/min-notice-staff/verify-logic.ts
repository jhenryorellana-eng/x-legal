/**
 * Evidence: min_notice is now a CLIENT-only constraint.
 *
 * Runs the REAL materializeSlots + settingsForActorKind (production code) against
 * the REAL production availability rules + org_scheduling_settings (read via
 * Supabase MCP on 2026-07-22). Shows the differential: with the same agenda,
 * staff get near-term (Thursday) slots the client's min_notice still hides.
 *
 * Run: npx tsx docs/_evidence/min-notice-staff/verify-logic.ts
 */
import {
  materializeSlots,
  settingsForActorKind,
  type AvailabilityRule,
  type SchedulingSettings,
} from "../../../src/backend/modules/scheduling/domain";

// --- Production settings (org_scheduling_settings) ---
const settings: SchedulingSettings = {
  minNoticeHours: 24,
  maxAdvanceDays: 30,
  bufferMinutes: 0,
  cancellationWindowHours: 24,
  rebookingPenaltyDays: 7,
  prospectDurationMinutes: 60,
  videoLink: null,
  remindersEnabled: true,
};

// --- Production availability_rules (is_active = true), TZ America/El_Salvador ---
const TZ = "America/El_Salvador";
const rules: AvailabilityRule[] = [
  { weekday: 1, startLocal: "16:30", endLocal: "17:30", timezone: TZ, isActive: true },
  { weekday: 2, startLocal: "08:00", endLocal: "12:00", timezone: TZ, isActive: true },
  { weekday: 2, startLocal: "15:30", endLocal: "17:30", timezone: TZ, isActive: true },
  { weekday: 3, startLocal: "08:00", endLocal: "12:00", timezone: TZ, isActive: true },
  { weekday: 3, startLocal: "14:00", endLocal: "17:00", timezone: TZ, isActive: true },
  { weekday: 4, startLocal: "08:00", endLocal: "12:00", timezone: TZ, isActive: true },
  { weekday: 4, startLocal: "16:30", endLocal: "17:30", timezone: TZ, isActive: true },
  { weekday: 5, startLocal: "08:00", endLocal: "12:00", timezone: TZ, isActive: true },
  { weekday: 5, startLocal: "15:30", endLocal: "17:30", timezone: TZ, isActive: true },
  { weekday: 6, startLocal: "08:00", endLocal: "11:00", timezone: TZ, isActive: true },
];

// "Now" = Wed 2026-07-22 17:13 El Salvador (UTC-6) = 23:13 UTC. Today's window
// (14:00-17:00) has already closed; the next window is Thursday 08:00.
const nowUtc = new Date("2026-07-22T23:13:00Z");
const windowFromUtc = nowUtc;
const windowToUtc = new Date(nowUtc.getTime() + 7 * 86_400_000);

function firstSlots(kind: "staff" | "client") {
  const slots = materializeSlots({
    rules,
    settings: settingsForActorKind(settings, kind),
    exceptions: [],
    booked: [],
    windowFromUtc,
    windowToUtc,
    durationMin: settings.prospectDurationMinutes,
    nowUtc,
  });
  return slots.slice(0, 3).map((s) =>
    // Render each slot start in the office TZ for readability.
    new Intl.DateTimeFormat("es", {
      timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(s.startUtc),
  );
}

const staff = firstSlots("staff");
const client = firstSlots("client");

console.log("now (El Salvador):  mié 22/07 17:13");
console.log("min_notice_hours:   24 (prod)");
console.log("");
console.log("STAFF  first slots:", staff);
console.log("CLIENT first slots:", client);
console.log("");

const staffFirst = staff[0] ?? "(none)";
const clientFirst = client[0] ?? "(none)";
const staffSeesThursday = staff.some((s) => s.includes("23/07"));
const clientHidesThursday = !client.some((s) => s.includes("23/07"));

console.log(`STAFF sees Thursday 23/07 (inside 24h notice): ${staffSeesThursday ? "YES ✅" : "NO ❌"}`);
console.log(`CLIENT still hides Thursday 23/07:              ${clientHidesThursday ? "YES ✅" : "NO ❌"}`);
console.log(`Differential holds (staff earlier than client): ${staffFirst !== clientFirst ? "YES ✅" : "NO ❌"}`);

if (!(staffSeesThursday && clientHidesThursday && staffFirst !== clientFirst)) {
  console.error("\nUNEXPECTED: differential did not hold.");
  process.exit(1);
}
console.log("\nOK — min_notice bypassed for staff, preserved for client.");
