/* Dump the official EOIR-26A AcroForm fields (name/type/page/rect) + per-page printed
 * text, replicating platform/pdf.ts detectAcroFields + extractPdfText. Read-only.
 * Grounds the config-as-data survey design against the REAL field names before publish.
 *
 * Uso: node docs/_evidence/eoir26a-automation/dump-fields.cjs [ruta-al-pdf]
 */
const fs = require("node:fs");
const path = require("node:path");

const PDF = process.argv[2] || "C:/Users/mauri/Documents/Trabajos/UsaLatinoPrime/documentos/EOIR-26A.pdf";

(async () => {
  const bytes = new Uint8Array(fs.readFileSync(PDF));
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const n = doc.countPages();

  const fields = [];
  const textByPage = [];
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const widgets = page.getWidgets?.() ?? [];
    for (const w of widgets) {
      const name = w.getName?.() ?? "";
      const rawType = w.getFieldType?.() ?? "text";
      const bounds = w.getBounds?.() ?? [0, 0, 0, 0];
      const type = ["text", "checkbox", "combobox", "radiobutton", "signature", "button"].includes(rawType)
        ? rawType : "text";
      // export values of a checkbox/radio (the value that ticks it) — needed for option mapping.
      let onState;
      try { onState = w.getButtonCaption?.(); } catch {}
      fields.push({ page: i + 1, name, type, rect: bounds.map((x) => Math.round(x)), onState });
    }
    let t = "";
    try {
      const st = page.toStructuredText?.("preserve-whitespace");
      if (st && typeof st.asText === "function") t = String(st.asText());
    } catch {}
    textByPage.push({ page: i + 1, text: t.replace(/\s+/g, " ").trim() });
  }

  console.log(`=== EOIR-26A — ${n} páginas · ${fields.length} campos AcroForm ===\n`);
  for (const f of fields) {
    console.log(`p${f.page}  ${f.type.padEnd(12)} ${f.name}${f.onState ? "  (on=" + f.onState + ")" : ""}`);
  }
  console.log("\n=== TEXTO IMPRESO POR PÁGINA (para mapear nombre→etiqueta) ===");
  for (const p of textByPage) console.log(`\n--- Página ${p.page} ---\n${p.text.slice(0, 1600)}`);

  fs.writeFileSync(
    path.join(__dirname, "fields.json"),
    JSON.stringify({ pages: n, fields, textByPage }, null, 1),
  );
  console.log(`\n(escrito ${path.join(__dirname, "fields.json")})`);
})();
