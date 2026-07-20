/**
 * EOIR-26A verification: fill the official AcroForm with the values the app would
 * resolve (client line items + COMPUTED totals from shared/form-logic/computed) and
 * render both pages to PNG, to confirm the totals land in the right boxes, the shared
 * MonthIncome/MonthExpense fields auto-fill BOTH the Part 1/2 total and the Part 3
 * copy, and the do-not-fill sections (signature, attorney) stay blank.
 *
 * Mirrors the XFA-safe recipe of src/backend/platform/pdf.ts#fillAcroForm.
 * Uses the guide §3 worked example: income 1400, expenses 1900 → TOTAL -500.00.
 *
 * Usage: node docs/_evidence/eoir26a-automation/verify-fill.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_PDF = "C:/Users/mauri/Documents/Trabajos/UsaLatinoPrime/documentos/EOIR-26A.pdf";

// COMPUTED totals, replicating resolveComputedValues (integer cents).
const cents = (n) => Math.round(n * 100);
const fmt = (c) => { const neg = c < 0; const [i, d] = Math.abs(c / 100).toFixed(2).split("."); return `${neg ? "-" : ""}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${d}`; };
const inc = [1400, 0, 0, 0], exp = [950, 220, 150, 500, 80];
const totInc = inc.reduce((a, b) => a + cents(b), 0);
const totExp = exp.reduce((a, b) => a + cents(b), 0);
const net = totInc - totExp;

const VALUES = {
  // Header + affidavit (as if resolved from the judge's decision extraction).
  "Name Last First Middle": "PALMA, Ivis",
  "Alien A Number": "A123-456-789",
  "Print name of alien filing the form": "Ivis Palma",
  // Part 1 — income line items (client_answer, as typed after NumberField normalises).
  "IncomeEmployment": String(inc[0]), "IncomeProperty": String(inc[1]), "IncomeInterest": String(inc[2]), "IncomeOther": String(inc[3]),
  // 1.A total (computed) — SAME field name appears on p1 and p2 (Part 3 copy).
  "MonthIncome": fmt(totInc),
  // Part 2 — expense line items.
  "ExpenseRent": String(exp[0]), "ExpenseUtil": String(exp[1]), "ExpenseInstall": String(exp[2]), "ExpenseLiving": String(exp[3]), "ExpenseOther": String(exp[4]),
  // 2.B total (computed) — shared name → fills 2.B + Part 3 copy.
  "MonthExpense": fmt(totExp),
  // Part 3 net (computed subtract) — negative.
  "TotalTot": fmt(net),
  // Part 4 explanation.
  "Information": "Trabajo solo medio tiempo y mantengo a dos hijos menores. Mis gastos superan mis ingresos cada mes, como se ve arriba.",
  // NOT filled (do_not_fill): Signature of Alien Filing the Form, AlienSigDate,
  // Signature of Attorney or Representative, Print Name, EOIR ID Number, Date.
};
console.log(`computed: 1.A=${fmt(totInc)}  2.B=${fmt(totExp)}  TOTAL=${fmt(net)}`);

const mupdf = await import("mupdf");
const doc = mupdf.Document.openDocument(fs.readFileSync(SRC_PDF), "application/pdf");

// Drop XFA + NeedAppearances (mirror of fillAcroForm).
try {
  const acro = doc.getTrailer?.()?.get("Root")?.get("AcroForm");
  if (acro && !acro.isNull()) {
    if (acro.get("XFA") && !acro.get("XFA").isNull()) acro.delete("XFA");
    acro.put("NeedAppearances", true);
  }
} catch (e) { console.warn("XFA step:", e.message); }

let setCount = 0;
for (let i = 0; i < doc.countPages(); i++) {
  for (const w of doc.loadPage(i).getWidgets()) {
    const name = w.getName?.() ?? "";
    if (!(name in VALUES)) continue;
    try { w.setTextValue?.(String(VALUES[name])); w.update?.(); setCount++; } catch (e) { console.warn(`set ${name}:`, e.message); }
  }
}
console.log("widgets set:", setCount, "(MonthIncome/MonthExpense count twice — shared names)");

doc.bake();
fs.writeFileSync(path.join(here, "eoir26a-test-fill.pdf"), doc.saveToBuffer("").asUint8Array());
const rendered = mupdf.Document.openDocument(fs.readFileSync(path.join(here, "eoir26a-test-fill.pdf")), "application/pdf");
for (const p of [1, 2]) {
  const pix = rendered.loadPage(p - 1).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
  fs.writeFileSync(path.join(here, `eoir26a-test-p${p}.png`), pix.asPNG());
  console.log(`rendered page ${p}`);
}
console.log("done");
