/**
 * Does changing the staff timezone (config → other country) break the week grid?
 *
 * For each TZ: build the grid the way page.tsx does, with the OLD (buggy) line and
 * the NEW (fixed) line, then check that the date under each weekday label actually
 * falls on that weekday. Run as Vercel does: `TZ=UTC npx tsx <this>`.
 */
import { toZonedTime } from "date-fns-tz";
import { startOfISOWeek, addDays, format } from "date-fns";

const now = new Date("2026-07-22T23:36:00Z"); // fixed reference instant
const LABELS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const EXPECTED_DOW = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun as JS getUTCDay (Sun=0)

function currentWeekStart(now: Date, tz: string): string {
  const zoned = toZonedTime(now, tz);
  return format(startOfISOWeek(zoned), "yyyy-MM-dd");
}

// Real weekday of a civil date, evaluated at UTC noon (DST-safe, TZ-agnostic).
const realDow = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

function gridAligned(weekStartDate: Date): { ok: boolean; row: string } {
  const cells: string[] = [];
  let ok = true;
  for (let i = 0; i < 7; i++) {
    const ymd = format(addDays(weekStartDate, i), "yyyy-MM-dd");
    const good = realDow(ymd) === EXPECTED_DOW[i];
    if (!good) ok = false;
    cells.push(`${LABELS[i]}=${ymd.slice(8)}${good ? "" : "✗"}`);
  }
  return { ok, row: cells.join(" ") };
}

const ZONES = [
  "America/El_Salvador", // UTC-6 (Vanessa now)
  "America/Bogota",      // UTC-5 (Colombia)
  "America/New_York",    // UTC-4 (DST)
  "America/Los_Angeles", // UTC-7 (DST)
  "UTC",                 // 0
  "Europe/Madrid",       // UTC+2 (DST) — positive offset
  "Africa/Nairobi",      // UTC+3
  "Asia/Kolkata",        // UTC+5:30 (half-hour)
  "Asia/Tokyo",          // UTC+9
  "Pacific/Kiritimati",  // UTC+14 (extreme)
];

console.log("TZ(server):", process.env.TZ ?? "(system)", "| now:", now.toISOString(), "\n");
let allFixedOk = true;
for (const tz of ZONES) {
  const wk = currentWeekStart(now, tz);
  const buggy = gridAligned(toZonedTime(new Date(`${wk}T00:00:00`), tz)); // OLD
  const fixed = gridAligned(new Date(`${wk}T00:00:00`));                   // NEW
  if (!fixed.ok) allFixedOk = false;
  console.log(`${tz.padEnd(20)} monday=${wk}`);
  console.log(`  OLD  ${buggy.ok ? "OK " : "BUG"}  ${buggy.row}`);
  console.log(`  NEW  ${fixed.ok ? "OK " : "BUG"}  ${fixed.row}`);
}
console.log("\n" + (allFixedOk
  ? "✅ FIX: every weekday label aligns with a real matching weekday, in EVERY timezone."
  : "❌ FIX broke in some timezone (see ✗ above)."));
