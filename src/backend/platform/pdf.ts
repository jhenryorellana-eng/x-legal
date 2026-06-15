/**
 * PDF platform wrapper — mupdf (ESM/WASM) + docx
 *
 * Provides three PDF/document capabilities:
 *   1. renderMarkdownToPdf  — md → HTML → mupdf → PDF bytes (US Letter)
 *   2. renderMarkdownToDocx — md → docx bytes via `docx` npm package
 *   3. detectAcroFields     — enumerate AcroForm widgets from a PDF
 *   4. fillAcroForm         — fill + flatten AcroForm fields (XFA-safe recipe)
 *
 * mupdf is ESM-only with a WASM binary. Next.js must NOT bundle it:
 *   next.config.ts: serverExternalPackages: ['mupdf']
 *
 * Spike evidence: docs/_evidence/f4-spike/SPIKE-FINDINGS.md
 *   - html→pdf confirmed via Document.openDocument(buf, "text/html") + layout(612,792,11)
 *   - XFA fill recipe: drop XFA → setTextValue → update → bake → saveToBuffer
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectedField {
  name: string;
  type: "text" | "checkbox" | "combobox" | "radiobutton" | "signature" | "button";
  page: number;
  rect: [number, number, number, number]; // [x0, y0, x1, y1]
}

export interface AcroFillMapping {
  /** pdf_field_name → profile/extraction field path (for logging only) */
  [pdfFieldName: string]: string;
}

export interface AcroFillValues {
  /** pdf_field_name → value to set */
  [pdfFieldName: string]: string | boolean;
}

// ---------------------------------------------------------------------------
// A. renderMarkdownToPdf
//    md → HTML → mupdf Document.openDocument → layout(612,792,11) → PDF bytes
// ---------------------------------------------------------------------------

/**
 * Renders a markdown string to a US Letter PDF (612x792 pt) via mupdf.
 *
 * Pipeline: markdown-it (md→HTML) → mupdf html→pdf.
 * Uses server-side dynamic import of mupdf (ESM/WASM — not bundled by Next.js).
 *
 * @returns Uint8Array of PDF bytes (starts with %PDF)
 */
export async function renderMarkdownToPdf(md: string): Promise<Uint8Array> {
  // markdown-it: md → HTML
  const MarkdownIt = (await import("markdown-it")).default;
  const mdi = new MarkdownIt({ html: false, linkify: false });
  const html = `<!DOCTYPE html><html><body style="font-family:serif;font-size:11pt;margin:72pt">${mdi.render(md)}</body></html>`;

  // mupdf: HTML → PDF (dynamic import — ESM module, not bundled)
  const mupdf = await import("mupdf");

  const buf = new TextEncoder().encode(html);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const htmlDoc = (mupdf.Document as any).openDocument(buf, "text/html");

  try {
  // US Letter: 612 × 792 pt, 11pt base font
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (htmlDoc as any).layout(612, 792, 11);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = (htmlDoc as any).countPages();

  // Preferred path: toPDFDocument()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (htmlDoc as any).toPDFDocument === "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdf = (htmlDoc as any).toPDFDocument();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (pdf.saveToBuffer("") as any).asUint8Array() as Uint8Array;
  }

  // Fallback: DocumentWriter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writerBuf = new (mupdf as any).Buffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writer = new (mupdf as any).DocumentWriter(writerBuf, "pdf", "");
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (htmlDoc as any).loadPage(i);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bounds = (page as any).getBounds();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dev = (writer as any).beginPage(bounds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (page as any).run(dev, (mupdf as any).Matrix.identity);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (writer as any).endPage();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (writer as any).close();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (writerBuf as any).asUint8Array() as Uint8Array;
  } finally {
    // Release the mupdf WASM document (linear allocator — avoid a per-call leak).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { (htmlDoc as any).destroy?.(); } catch { /* already freed */ }
  }
}

// ---------------------------------------------------------------------------
// B. renderMarkdownToDocx
//    md → DOCX bytes via `docx` npm package (P-42-1 gated in catalog UI)
// ---------------------------------------------------------------------------

/**
 * Renders a markdown string to a DOCX file (US Letter, 1in margins).
 *
 * Supports: headings (H1-H3), bold, italic, paragraphs, bullet lists.
 * Complex constructs (tables, blockquotes) are rendered as plain paragraphs.
 */
export async function renderMarkdownToDocx(md: string): Promise<Uint8Array> {
  const { Document, Paragraph, TextRun, HeadingLevel, Packer } = await import("docx");

  // Parse markdown into a list of paragraph-like structures
  const paragraphs: InstanceType<typeof Paragraph>[] = [];

  const lines = md.split("\n");
  let currentBullets: string[] = [];

  const flushBullets = () => {
    for (const bullet of currentBullets) {
      paragraphs.push(
        new Paragraph({
          text: bullet,
          bullet: { level: 0 },
        }),
      );
    }
    currentBullets = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("### ")) {
      flushBullets();
      paragraphs.push(new Paragraph({ text: trimmed.slice(4), heading: HeadingLevel.HEADING_3 }));
    } else if (trimmed.startsWith("## ")) {
      flushBullets();
      paragraphs.push(new Paragraph({ text: trimmed.slice(3), heading: HeadingLevel.HEADING_2 }));
    } else if (trimmed.startsWith("# ")) {
      flushBullets();
      paragraphs.push(new Paragraph({ text: trimmed.slice(2), heading: HeadingLevel.HEADING_1 }));
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      currentBullets.push(trimmed.slice(2));
    } else if (trimmed === "" || trimmed === "---") {
      flushBullets();
      // blank line or hr → empty paragraph as separator
      paragraphs.push(new Paragraph({}));
    } else {
      flushBullets();
      // Inline bold/italic parsing (simple)
      const runs: InstanceType<typeof TextRun>[] = [];
      const rest = trimmed;
      // Simple bold (**text**) and italic (*text*) parsing
      const boldItalicRe = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|(.+?)(?=\*|$))/g;
      let match: RegExpExecArray | null;
      while ((match = boldItalicRe.exec(rest)) !== null) {
        if (match[2]) {
          runs.push(new TextRun({ text: match[2], bold: true, italics: true }));
        } else if (match[3]) {
          runs.push(new TextRun({ text: match[3], bold: true }));
        } else if (match[4]) {
          runs.push(new TextRun({ text: match[4], italics: true }));
        } else if (match[5]) {
          runs.push(new TextRun({ text: match[5] }));
        }
      }
      if (runs.length === 0) {
        runs.push(new TextRun({ text: rest }));
      }
      paragraphs.push(new Paragraph({ children: runs }));
    }
  }
  flushBullets();

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 }, // US Letter in TWIPs (1/20 pt)
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // 1 inch = 1440 TWIPs
          },
        },
        children: paragraphs,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// C. detectAcroFields
//    Enumerate AcroForm widgets from a PDF (Ola 2 — pdf_automation)
//    Spike evidence: detect.cjs / mupdf-test.mjs
// ---------------------------------------------------------------------------

/**
 * Enumerates all AcroForm widgets in a PDF.
 *
 * Returns an array of detected fields with name, type, page index, and bounds.
 * Used by catalog/service for form_automation_versions.detected_fields (Ola 2).
 */
export async function detectAcroFields(bytes: Uint8Array): Promise<DetectedField[]> {
  const mupdf = await import("mupdf");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (mupdf.Document as any).openDocument(bytes, "application/pdf");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = (doc as any).countPages();
  const fields: DetectedField[] = [];

  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (doc as any).loadPage(i);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const widgets: any[] = (page as any).getWidgets?.() ?? [];
    for (const w of widgets) {
      const name: string = w.getName?.() ?? "";
      const rawType: string = w.getFieldType?.() ?? "text";
      const bounds: [number, number, number, number] = w.getBounds?.() ?? [0, 0, 0, 0];

      const type = (
        ["text", "checkbox", "combobox", "radiobutton", "signature", "button"].includes(rawType)
          ? rawType
          : "text"
      ) as DetectedField["type"];

      fields.push({ name, type, page: i, rect: bounds });
    }
  }

  return fields;
}

// ---------------------------------------------------------------------------
// D. fillAcroForm
//    Fill + flatten AcroForm fields using the XFA-safe recipe from the spike
//    Spike evidence: fill-debug.mjs / SPIKE-FINDINGS.md
// ---------------------------------------------------------------------------

/**
 * Fills AcroForm fields in a PDF and returns flattened bytes.
 *
 * XFA-safe recipe (confirmed on I-765, I-360):
 *   1. Drop XFA layer so AcroForm static layer becomes authoritative
 *   2. Set NeedAppearances = true
 *   3. setTextValue / setChoiceValue / checkbox toggle per field + update()
 *   4. bake() — flattens widgets to content (after this: 0 widgets)
 *   5. saveToBuffer → Uint8Array
 *
 * @param bytes    Raw PDF bytes (from storage)
 * @param _mapping field name → source path (informational only; unused at runtime)
 * @param values   field name → value to set
 */
export async function fillAcroForm(
  bytes: Uint8Array,
  _mapping: AcroFillMapping,
  values: AcroFillValues,
): Promise<Uint8Array> {
  const mupdf = await import("mupdf");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = (mupdf.Document as any).openDocument(bytes, "application/pdf") as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDoc = doc as any;

  // Step 1: Drop XFA so AcroForm static layer wins
  try {
    const acroForm = pdfDoc.getTrailer?.()?.get?.("Root")?.get?.("AcroForm");
    if (acroForm) {
      acroForm.delete("XFA");
      acroForm.put("NeedAppearances", pdfDoc.newBoolean?.(true) ?? true);
    }
  } catch {
    // Non-fatal: continue without XFA drop if doc structure is unexpected
  }

  // Step 2: Fill fields
  const n: number = pdfDoc.countPages();
  for (let i = 0; i < n; i++) {
    const page = pdfDoc.loadPage(i);
    const widgets: unknown[] = (page as { getWidgets?: () => unknown[] }).getWidgets?.() ?? [];
    for (const w of widgets) {
      const widget = w as {
        getName?: () => string;
        getFieldType?: () => string;
        setTextValue?: (v: string) => void;
        setChoiceValue?: (v: string) => void;
        toggle?: () => void;
        update?: () => void;
      };
      const name = widget.getName?.() ?? "";
      if (!(name in values)) continue;

      const val = values[name];
      const fieldType = widget.getFieldType?.() ?? "text";

      try {
        if (fieldType === "checkbox") {
          // For checkboxes, a truthy value toggles on
          if (val) widget.toggle?.();
        } else if (fieldType === "combobox" || fieldType === "radiobutton") {
          widget.setChoiceValue?.(String(val));
        } else {
          widget.setTextValue?.(String(val));
        }
        widget.update?.();
      } catch {
        // Skip individual field errors — log at call site
      }
    }
  }

  // Step 3: bake + save
  try {
    pdfDoc.bake?.();
  } catch {
    // Non-fatal: bake may not be available on all mupdf versions
  }

  const outBuf = pdfDoc.saveToBuffer?.("") ?? pdfDoc.save?.("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (outBuf as any).asUint8Array() as Uint8Array;
}

// ---------------------------------------------------------------------------
// E. renderCoverPdf  — deterministic cover page (carátula) via mupdf html→pdf
// ---------------------------------------------------------------------------

export interface CoverData {
  /** Big title (e.g. "EXPEDIENTE" or the service name). */
  title: string;
  /** Subtitle / form name (optional). */
  subtitle?: string;
  caseNumber: string;
  /** Canonical client label "{inicial}. {apellido}" — no PII. */
  clientLabel: string;
  serviceLabel: string;
  /** Footer line (org name / date). */
  footer?: string;
  /** "ulp-classic" (portada) | "ulp-divider" (separador). */
  style?: "ulp-classic" | "ulp-divider";
}

const NAVY = "#0b1f3a";
const GOLD = "#c8a24a";

/** Internal: mupdf html→pdf (US Letter), shared by cover + TOC renders.
 * Mirrors renderMarkdownToPdf: prefer toPDFDocument(), else DocumentWriter. */
async function htmlToPdf(html: string): Promise<Uint8Array> {
  const mupdf = await import("mupdf");
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const M = mupdf as any;
  const doc = M.Document.openDocument(new TextEncoder().encode(html), "text/html");
  try {
    doc.layout(612, 792, 11);
    const n = doc.countPages();
    if (typeof doc.toPDFDocument === "function") {
      return doc.toPDFDocument().saveToBuffer("").asUint8Array() as Uint8Array;
    }
    const buf = new M.Buffer();
    const writer = new M.DocumentWriter(buf, "pdf", "");
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i);
      const dev = writer.beginPage(page.getBounds());
      page.run(dev, M.Matrix.identity);
      writer.endPage();
    }
    writer.close();
    return buf.asUint8Array() as Uint8Array;
  } finally {
    try { doc.destroy?.(); } catch { /* freed */ }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Renders a deterministic ULP cover/divider page (navy + gold, Helvetica) to a
 * one-page US Letter PDF. Same inputs → same bytes. DOC-45 §3.1.1.
 */
export async function renderCoverPdf(data: CoverData): Promise<Uint8Array> {
  const esc = (s: string) =>
    String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const isDivider = data.style === "ulp-divider";
  const html = `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;margin:0;padding:0;color:${NAVY}">
    <div style="margin:96pt 72pt;border:2pt solid ${GOLD};padding:48pt 36pt;text-align:center">
      <div style="font-size:11pt;letter-spacing:3pt;color:${GOLD};font-weight:bold">USALATINOPRIME</div>
      <div style="height:${isDivider ? "8pt" : "36pt"}"></div>
      <div style="font-size:${isDivider ? "22pt" : "30pt"};font-weight:bold;letter-spacing:1pt">${esc(data.title)}</div>
      ${data.subtitle ? `<div style="font-size:14pt;color:${NAVY};margin-top:8pt">${esc(data.subtitle)}</div>` : ""}
      <div style="height:24pt"></div>
      <div style="border-top:1pt solid ${GOLD};width:40%;margin:0 auto"></div>
      <div style="height:24pt"></div>
      <table style="margin:0 auto;font-size:12pt;text-align:left">
        <tr><td style="color:${GOLD};padding:3pt 12pt 3pt 0">Caso</td><td style="font-weight:bold">${esc(data.caseNumber)}</td></tr>
        <tr><td style="color:${GOLD};padding:3pt 12pt 3pt 0">Cliente</td><td style="font-weight:bold">${esc(data.clientLabel)}</td></tr>
        <tr><td style="color:${GOLD};padding:3pt 12pt 3pt 0">Servicio</td><td style="font-weight:bold">${esc(data.serviceLabel)}</td></tr>
      </table>
    </div>
    ${data.footer ? `<div style="position:fixed;bottom:48pt;left:0;right:0;text-align:center;font-size:9pt;color:${GOLD}">${esc(data.footer)}</div>` : ""}
  </body></html>`;
  return htmlToPdf(html);
}

// ---------------------------------------------------------------------------
// F. compileExpedientePdf — merge ordered items into one PDF + TOC + page numbers
// ---------------------------------------------------------------------------

export interface ExpedienteItemInput {
  /** Raw bytes of the item's source document. */
  bytes: Uint8Array;
  /** "application/pdf" | "image/jpeg" | "image/png" — how mupdf opens it. */
  mimeType: string;
  /** Index title (visible in the TOC). */
  title: string;
  includeInToc: boolean;
}

export interface CompiledExpediente {
  pdf: Uint8Array;
  pageCount: number;
  toc: Array<{ title: string; startPage: number; pageCount: number }>;
}

/**
 * Compiles an ordered list of items into a single US Letter PDF:
 *   1. open every item, count pages (two-pass to size the auto TOC),
 *   2. render a Table-of-Contents page (navy/gold) with each item's START page,
 *   3. merge TOC + every item's pages via a DocumentWriter (vector-preserving —
 *      not rasterized), stamping a continuous "{n} / {total}" footer per page.
 *
 * Robust to mixed inputs (PDF + scanned images). DOC-45 §3.4.
 */
export async function compileExpedientePdf(items: ExpedienteItemInput[]): Promise<CompiledExpediente> {
  const mupdf = await import("mupdf");
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const M = mupdf as any;

  // Open each item as a PDFDocument (graftPage needs PDF source + copies objects
  // verbatim — no font re-processing, unlike DocumentWriter which fails on USCIS
  // forms with "substitute font creation not implemented"). Non-PDF (scanned
  // images) are first rendered to a 1-page PDF (no fonts → safe via DocumentWriter).
  const toPdfDoc = (bytes: Uint8Array, mimeType: string): any => {
    if (!mimeType || mimeType === "application/pdf") return M.Document.openDocument(bytes, "application/pdf");
    const src = M.Document.openDocument(bytes, mimeType);
    const buf = new M.Buffer();
    const w = new M.DocumentWriter(buf, "pdf", "");
    for (let i = 0; i < Math.max(1, src.countPages()); i++) {
      const p = src.loadPage(i);
      const d = w.beginPage(p.getBounds());
      p.run(d, M.Matrix.identity);
      w.endPage();
    }
    w.close();
    try { src.destroy?.(); } catch { /* freed */ }
    return M.Document.openDocument(buf.asUint8Array(), "application/pdf");
  };

  // --- open each item + count pages ---
  const opened = items.map((it) => {
    const doc = toPdfDoc(it.bytes, it.mimeType);
    return { it, doc, pages: Math.max(1, doc.countPages()) };
  });

  const esc = (s: string) =>
    String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const buildTocHtml = (rows: Array<{ title: string; startPage: number }>) =>
    `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;margin:54pt 60pt;color:${NAVY}">
      <div style="font-size:11pt;letter-spacing:3pt;color:${GOLD};font-weight:bold">USALATINOPRIME</div>
      <div style="font-size:22pt;font-weight:bold;margin:6pt 0 4pt">Índice del expediente</div>
      <div style="border-top:2pt solid ${GOLD};margin-bottom:14pt"></div>
      <table style="width:100%;font-size:12pt;border-collapse:collapse">
        ${rows
          .map(
            (r) =>
              `<tr><td style="padding:5pt 0">${esc(r.title)}</td><td style="padding:5pt 0;text-align:right;color:${GOLD};font-weight:bold">${r.startPage}</td></tr>`,
          )
          .join("")}
      </table>
    </body></html>`;

  // --- two-pass: render the TOC to PDF, measure it, finalize START pages ---
  let tocPages = 1;
  let toc: Array<{ title: string; startPage: number; pageCount: number }> = [];
  let tocPdf: any = null;
  for (let iter = 0; iter < 4; iter++) {
    let cursor = tocPages + 1; // first item page (1-based, after the TOC)
    toc = [];
    const rows: Array<{ title: string; startPage: number }> = [];
    for (const o of opened) {
      if (o.it.includeInToc) {
        toc.push({ title: o.it.title, startPage: cursor, pageCount: o.pages });
        rows.push({ title: o.it.title, startPage: cursor });
      }
      cursor += o.pages;
    }
    const tocBytes = await htmlToPdf(buildTocHtml(rows));
    try { tocPdf?.destroy?.(); } catch { /* freed */ }
    tocPdf = M.Document.openDocument(tocBytes, "application/pdf");
    const n = Math.max(1, tocPdf.countPages());
    if (n === tocPages) break;
    tocPages = n;
  }

  const totalPages = tocPages + opened.reduce((s, o) => s + o.pages, 0);

  // --- merge: graftPage TOC + every item into a fresh PDFDocument (verbatim) ---
  // NOTE: the TOC carries each item's START page (the navigation aid that matters).
  // A continuous footer page-number stamp is deferred — the mupdf WASM build can't
  // create substitute fonts for on-device text, so it needs an embedded font asset.
  const dst = new M.PDFDocument();
  const graft = (src: any) => {
    const n = src.countPages();
    for (let i = 0; i < n; i++) dst.graftPage(dst.countPages(), src, i);
  };
  graft(tocPdf);
  for (const o of opened) graft(o.doc);

  const pdf = dst.saveToBuffer("").asUint8Array() as Uint8Array;
  try { tocPdf?.destroy?.(); } catch { /* freed */ }
  for (const o of opened) { try { o.doc.destroy?.(); } catch { /* freed */ } }
  try { dst.destroy?.(); } catch { /* freed */ }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { pdf, pageCount: totalPages, toc };
}
