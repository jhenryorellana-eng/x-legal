/**
 * Repro: /ventas/citas week grid is shifted -1 day for negative-offset TZs.
 *
 * Run under Vercel-like UTC server: `TZ=UTC npx tsx docs/_evidence/citas-week-grid/repro.ts`
 * Shows the BUGGY line (toZonedTime on a civil-date string) vs the FIX.
 */
import { toZonedTime } from "date-fns-tz";
import { startOfISOWeek, addDays, format } from "date-fns";

const staffTz = "America/El_Salvador"; // UTC-6, what the UI chip showed
const now = new Date("2026-07-22T23:36:00Z"); // Wed 17:36 in El Salvador

function currentWeekStart(now: Date, tz: string): string {
  const zoned = toZonedTime(now, tz);
  const monday = startOfISOWeek(zoned);
  return format(monday, "yyyy-MM-dd");
}

const realWeekStart = currentWeekStart(now, staffTz);
console.log("process TZ:", process.env.TZ ?? "(system)");
console.log("realWeekStart (correct Monday):", realWeekStart, "\n");

const buggy = toZonedTime(new Date(`${realWeekStart}T00:00:00`), staffTz); // current code
const fixed = new Date(`${realWeekStart}T00:00:00`); // proposed fix

const labels = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
console.log("label | BUGGY date (getDate) | FIXED date (getDate)");
for (let i = 0; i < 7; i++) {
  const b = addDays(buggy, i);
  const f = addDays(fixed, i);
  console.log(
    `${labels[i]}   | ${format(b, "yyyy-MM-dd")} (${b.getDate()})      | ${format(f, "yyyy-MM-dd")} (${f.getDate()})`,
  );
}

const buggyThu = format(addDays(buggy, 3), "yyyy-MM-dd"); // JUE column
const fixedWed = format(addDays(fixed, 2), "yyyy-MM-dd"); // MIÉ column
console.log("");
console.log(`BUG: 22 under JUE?  → JUE shows ${buggyThu} ${buggyThu === "2026-07-22" ? "❌ (22 mislabeled Thursday)" : ""}`);
console.log(`FIX: 22 under MIÉ?  → MIÉ shows ${fixedWed} ${fixedWed === "2026-07-22" ? "✅ (22 correctly Wednesday)" : ""}`);
