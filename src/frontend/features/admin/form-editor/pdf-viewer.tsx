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
type PdfAnnotation = { subtype?: string; fieldName?: string; rect: number[] };
type PdfPage = {
  getViewport: (opts: { scale: number }) => PdfViewport;
  getAnnotations: () => Promise<PdfAnnotation[]>;
  render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => { promise: Promise<void> };
};
type PdfViewport = { width: number; height: number; convertToViewportRectangle: (rect: number[]) => number[] };

/** A form field positioned in pdfjs viewport (canvas) coords — guaranteed to align
 *  with the rendered page because both come from the SAME pdfjs page object. */
type PlacedField = { name: string; page: number; left: number; top: number; width: number; height: number };

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
  mappedNames,
  selectedField,
  onSelectField,
  strings,
}: PdfViewerProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const docRef = React.useRef<PdfDoc | null>(null);
  const [pages, setPages] = React.useState<{ width: number; height: number }[]>([]);
  const [placed, setPlaced] = React.useState<PlacedField[]>([]);
  const [error, setError] = React.useState(false);
  const canvasRefs = React.useRef<Record<number, HTMLCanvasElement | null>>({});

  // STEP 1 — load the doc + measure page dims when src changes (no painting yet).
  React.useEffect(() => {
    docRef.current = null;
    if (!src) {
      setPages([]);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Worker URL — bundler-agnostic. The previous `?url` import only resolved
        // under Turbopack (npm run dev), leaving the worker UNSET under webpack
        // (the production `next build` AND `npx next dev`), so the canvas never
        // painted (the right panel looked empty). `new URL(module, import.meta.url)`
        // is honored by both webpack 5 and Turbopack.
        (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
          new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

        const loadingTask = (pdfjs as unknown as { getDocument: (s: { url: string }) => { promise: Promise<PdfDoc> } }).getDocument({
          url: src,
        });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        docRef.current = doc;

        const dims: { width: number; height: number }[] = [];
        const placedFields: PlacedField[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          dims.push({ width: viewport.width, height: viewport.height });
          // Field positions come from pdfjs's OWN annotations + viewport transform,
          // so the overlay boxes ALWAYS line up with the rendered page (the previous
          // mupdf rects used a different coordinate system → misaligned overlays).
          const annots = await page.getAnnotations();
          for (const a of annots) {
            if (a.subtype !== "Widget" || typeof a.fieldName !== "string" || !a.fieldName) continue;
            const r = viewport.convertToViewportRectangle(a.rect);
            const left = Math.min(r[0], r[2]);
            const top = Math.min(r[1], r[3]);
            placedFields.push({
              name: a.fieldName,
              page: i,
              left,
              top,
              width: Math.abs(r[2] - r[0]),
              height: Math.abs(r[3] - r[1]),
            });
          }
        }
        if (!cancelled) {
          setPages(dims);
          setPlaced(placedFields);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  // STEP 2 — paint each page AFTER its <canvas> has mounted (pages committed). This
  // fixes the race where the old code painted in a microtask before the canvases
  // existed (canvasRefs were null → backing stayed the 300px default → blurry upscale).
  // Render at device-pixel-ratio so the official-form text is CRISP.
  React.useEffect(() => {
    const doc = docRef.current;
    if (!doc || pages.length === 0) return;
    let cancelled = false;
    (async () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return;
        const canvas = canvasRefs.current[i];
        if (!canvas) continue;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: RENDER_SCALE * dpr });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pages]);

  // Scroll to the selected field's page.
  React.useEffect(() => {
    if (!selectedField) return;
    const f = placed.find((x) => x.name === selectedField);
    if (!f) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${f.page}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedField, placed]);

  const fieldsByPage = React.useMemo(() => {
    const map = new Map<number, PlacedField[]>();
    for (const f of placed) {
      const arr = map.get(f.page) ?? [];
      arr.push(f);
      map.set(f.page, arr);
    }
    return map;
  }, [placed]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <Legend strings={strings} />
        {src && (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 13px", borderRadius: 999, background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 800, textDecoration: "none", flexShrink: 0 }}
            title={strings.viewOfficialPdf}
          >
            <Icon name="doc" size={13} color="#fff" /> {strings.viewOfficialPdf}
          </a>
        )}
      </div>
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
                  key={f.name}
                  placed={f}
                  state={
                    selectedField === f.name
                      ? "selected"
                      : mappedNames.has(f.name)
                        ? "mapped"
                        : "unmapped"
                  }
                  onClick={() => onSelectField(f.name)}
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
  placed,
  state,
  onClick,
}: {
  placed: PlacedField;
  state: "mapped" | "unmapped" | "selected";
  onClick: () => void;
}) {
  // Coordinates already in canvas/viewport space (from pdfjs convertToViewportRectangle),
  // so they line up exactly with the rendered page — no manual scale/flip needed.
  // Subtle by default so the official form text reads THROUGH the overlays: unmapped
  // fields are just a dashed outline; mapped a faint tint; the selected one stands out.
  const palette = {
    mapped: { bg: "color-mix(in srgb, var(--accent) 14%, transparent)", border: "1.5px solid var(--accent)", op: 0.85 },
    unmapped: { bg: "transparent", border: "1.5px dashed var(--gold-deep)", op: 0.65 },
    selected: { bg: "color-mix(in srgb, var(--accent) 38%, transparent)", border: "2px solid var(--accent)", op: 1 },
  }[state];

  return (
    <button
      type="button"
      onClick={onClick}
      title={placed.name}
      aria-label={`${placed.name} (${state})`}
      style={{
        position: "absolute",
        left: placed.left,
        top: placed.top,
        width: Math.max(placed.width, 8),
        height: Math.max(placed.height, 8),
        background: palette.bg,
        border: palette.border,
        borderRadius: 3,
        cursor: "pointer",
        padding: 0,
        opacity: palette.op,
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
    <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
          <span style={{ width: 13, height: 13, borderRadius: 3, ...it.swatch }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
