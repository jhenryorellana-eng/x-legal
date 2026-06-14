"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand";
import type { DetectedFieldVM } from "./types";
import type { FormEditorStrings } from "./strings";

/**
 * PdfViewer — the right panel of the "Estructurar" stage (DOC-53 §5.1.2).
 *
 * Renders every page of the official PDF on a <canvas> via pdfjs-dist, then
 * overlays the detected AcroForm fields positioned by their PDF rect. Each
 * overlay is colored by state: accent 30% (mapped to a question), gold-soft
 * dashed (unmapped), accent solid (selected). Clicking an overlay selects the
 * field (the parent jumps/creates its question); selecting a question in the
 * left panel scrolls the viewer to its field.
 *
 * pdfjs-dist is browser-only — this is a "use client" component and the library
 * is imported dynamically (no SSR). The worker is wired to the matching version.
 */

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = {
  getViewport: (opts: { scale: number }) => PdfViewport;
  render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => { promise: Promise<void> };
};
type PdfViewport = { width: number; height: number };

export interface PdfViewerProps {
  /** Object URL or signed URL of the PDF. */
  src: string | null;
  fields: DetectedFieldVM[];
  /** pdf_field_name set that is mapped to at least one question. */
  mappedNames: Set<string>;
  selectedField: string | null;
  onSelectField: (name: string) => void;
  strings: FormEditorStrings;
}

const PAGE_GAP = 14;
const RENDER_SCALE = 1.35;

export function PdfViewer({
  src,
  fields,
  mappedNames,
  selectedField,
  onSelectField,
  strings,
}: PdfViewerProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [pages, setPages] = React.useState<{ width: number; height: number }[]>([]);
  const [error, setError] = React.useState(false);
  const canvasRefs = React.useRef<Record<number, HTMLCanvasElement | null>>({});

  // Load + render the PDF when src changes.
  React.useEffect(() => {
    if (!src) {
      setPages([]);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Wire the worker to the bundled version (Turbopack resolves the URL).
        const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
          workerSrc;

        const loadingTask = (pdfjs as unknown as { getDocument: (s: { url: string }) => { promise: Promise<PdfDoc> } }).getDocument({
          url: src,
        });
        const doc = await loadingTask.promise;
        if (cancelled) return;

        const dims: { width: number; height: number }[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          dims.push({ width: viewport.width, height: viewport.height });
          // Defer the actual canvas paint to a microtask after state commits.
          queueMicrotask(async () => {
            const canvas = canvasRefs.current[i];
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: ctx, viewport }).promise;
          });
        }
        if (!cancelled) setPages(dims);
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  // Scroll to the selected field's page.
  React.useEffect(() => {
    if (!selectedField) return;
    const f = fields.find((x) => x.pdf_field_name === selectedField);
    if (!f) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${f.page}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedField, fields]);

  const fieldsByPage = React.useMemo(() => {
    const map = new Map<number, DetectedFieldVM[]>();
    for (const f of fields) {
      const arr = map.get(f.page) ?? [];
      arr.push(f);
      map.set(f.page, arr);
    }
    return map;
  }, [fields]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Legend strings={strings} />
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--panel-2, var(--card-alt))",
          borderRadius: 14,
          border: "1px solid var(--line-2, var(--line))",
          padding: PAGE_GAP,
        }}
      >
        {error && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--ink-2)", fontSize: 13 }}>
            {strings.noFieldsSub}
          </div>
        )}
        {!error && !src && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--ink-3)", textAlign: "center", padding: 24 }}>
            <span style={{ color: "var(--ink-3)", opacity: 0.6, marginBottom: 10 }}><Icon name="doc" size={40} /></span>
            <p style={{ fontSize: 13, margin: 0 }}>El visor del PDF aparece aquí.</p>
            <p style={{ fontSize: 12, margin: "4px 0 0", color: "var(--ink-3)" }}>Selecciona una pregunta o un campo para resaltarlo.</p>
          </div>
        )}
        {pages.map((dim, idx) => {
          const pageNum = idx + 1;
          const pageFields = fieldsByPage.get(pageNum) ?? [];
          return (
            <div
              key={pageNum}
              data-pdf-page={pageNum}
              style={{
                position: "relative",
                width: dim.width,
                height: dim.height,
                margin: `0 auto ${PAGE_GAP}px`,
                boxShadow: "var(--shadow-sm, 0 2px 10px rgba(7,17,33,.08))",
                borderRadius: 6,
                overflow: "hidden",
                background: "#fff",
              }}
            >
              <canvas
                ref={(el) => {
                  canvasRefs.current[pageNum] = el;
                }}
                style={{ display: "block", width: dim.width, height: dim.height }}
              />
              {pageFields.map((f) => (
                <FieldOverlay
                  key={f.pdf_field_name}
                  field={f}
                  pageHeight={dim.height}
                  state={
                    selectedField === f.pdf_field_name
                      ? "selected"
                      : mappedNames.has(f.pdf_field_name)
                        ? "mapped"
                        : "unmapped"
                  }
                  onClick={() => onSelectField(f.pdf_field_name)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FieldOverlay({
  field,
  pageHeight,
  state,
  onClick,
}: {
  field: DetectedFieldVM;
  pageHeight: number;
  state: "mapped" | "unmapped" | "selected";
  onClick: () => void;
}) {
  // mupdf rect is [x0, y0, x1, y1] in PDF points (origin bottom-left). We scale
  // by RENDER_SCALE and flip Y to the top-left canvas origin.
  const [x0, y0, x1, y1] = field.rect;
  const left = x0 * RENDER_SCALE;
  const width = (x1 - x0) * RENDER_SCALE;
  const heightPx = (y1 - y0) * RENDER_SCALE;
  const top = pageHeight - y1 * RENDER_SCALE;

  const palette = {
    mapped: { bg: "color-mix(in srgb, var(--accent) 30%, transparent)", border: "1.5px solid var(--accent)" },
    unmapped: { bg: "var(--gold-soft)", border: "1.5px dashed var(--gold-deep)" },
    selected: { bg: "var(--accent)", border: "2px solid var(--accent)" },
  }[state];

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${field.pdf_field_name} · ${field.field_type}`}
      aria-label={`${field.pdf_field_name} (${state})`}
      style={{
        position: "absolute",
        left,
        top,
        width: Math.max(width, 8),
        height: Math.max(heightPx, 8),
        background: palette.bg,
        border: palette.border,
        borderRadius: 3,
        cursor: "pointer",
        padding: 0,
        opacity: state === "selected" ? 0.55 : 0.85,
        transition: "background .15s, opacity .15s",
      }}
    />
  );
}

function Legend({ strings }: { strings: FormEditorStrings }) {
  const items: { label: string; swatch: React.CSSProperties }[] = [
    { label: strings.legendMapped, swatch: { background: "color-mix(in srgb, var(--accent) 30%, transparent)", border: "1.5px solid var(--accent)" } },
    { label: strings.legendUnmapped, swatch: { background: "var(--gold-soft)", border: "1.5px dashed var(--gold-deep)" } },
    { label: strings.legendSelected, swatch: { background: "var(--accent)" } },
  ];
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
          <span style={{ width: 13, height: 13, borderRadius: 3, ...it.swatch }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
