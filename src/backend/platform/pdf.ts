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
