"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { GradientBtn, GhostBtn, Icon } from "@/frontend/components/brand";
import type { DemoStaffFixture } from "../../scenarios/types";

/**
 * ExpedienteDocument — the compiled legal file, rendered as a realistic
 * multi-page document (cover, TOC, I-589, memorándum, annexes, chronology) with
 * continuous "Página N de M" numbering. Colors are fixed hex (not theme tokens)
 * so the printed output looks identical in light or dark mode.
 *
 * Shown as a full-screen reader portaled to <body>: escaping the staff shell's
 * transformed ancestor makes `position: fixed` truly fill the screen, and — being
 * a direct child of <body> — it prints cleanly from the top (the previous
 * absolute-in-panel approach inherited the topbar's offset → blank space on the
 * first printed page). "Imprimir" uses `window.print()`; the `@media print` block
 * in staff-styles keeps only `.demo-expediente-reader`.
 */

const NAVY = "#0b1b33";
const NAVY_SOFT = "#1c3a63";
const GOLD = "#c08a2d";
const GOLD_SOFT = "#f3e7cf";
const INK = "#1f2a37";
const INK_SOFT = "#5b6672";
const LINE = "#dbe1e8";
const PAGE_W = 760;

/**
 * Print isolation, injected INSIDE the portaled reader so it is always present
 * when printing, lives in the (visible) reader subtree, and ships with the
 * component's JS module (reliable across hot-reloads — a global stylesheet edit
 * can be missed by the dev bundler). Hides every other direct child of <body>,
 * neutralises the reader's fixed positioning + the `.surface-staff` `zoom`, and
 * paginates by `.demo-print-page` so the file prints cleanly from page 1.
 */
const PRINT_CSS = `
@media print {
  @page { margin: 12mm; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; zoom: 1 !important; }
  body > *:not(.demo-expediente-reader) { display: none !important; }
  .demo-expediente-reader {
    position: static !important;
    inset: auto !important;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    background: #fff !important;
    z-index: auto !important;
    zoom: 1 !important;
  }
  .demo-no-print { display: none !important; }
  .demo-print-root { display: block !important; margin: 0 !important; padding: 0 !important; }
  .demo-print-page {
    width: 100% !important;
    max-width: 720px !important;
    min-height: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    margin: 0 auto !important;
    page-break-after: always;
    break-after: page;
  }
  .demo-print-page:last-child { page-break-after: auto; break-after: auto; }
}
`;

export interface ExpedienteDocLabels {
  print: string;
  regenerate: string;
  toolbarNote: string;
  close: string;
  org: string;
  coverKicker: string;
  confidential: string;
  tocTitle: string;
  repNote: string;
  pageWord: string;
  ofWord: string;
}

export function ExpedienteDocument({
  open,
  onClose,
  staff,
  labels,
  onRegenerate,
}: {
  open: boolean;
  onClose: () => void;
  staff: DemoStaffFixture;
  labels: ExpedienteDocLabels;
  onRegenerate: () => void;
}) {
  const exp = staff.expediente;
  const total = exp.totalPages;
  const pageLabel = (n: number) => `${labels.pageWord} ${n} ${labels.ofWord} ${total}`;

  const doPrint = React.useCallback(() => {
    if (typeof window !== "undefined") window.print();
  }, []);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="demo-expediente-reader"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        overflowY: "auto",
        background: "var(--bg)",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <style>{PRINT_CSS}</style>

      {/* Toolbar (sticky, not printed) */}
      <div
        className="demo-no-print"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "12px 16px",
          background: "color-mix(in srgb, var(--card) 86%, transparent)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={labels.close}
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--card)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Icon name="x" size={20} color="var(--navy)" />
        </button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--green)", fontWeight: 800, fontSize: 14 }}>
          <Icon name="check" size={18} color="var(--green)" stroke={2.8} />
          {labels.toolbarNote}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <GhostBtn icon="play" size="md" full={false} onClick={onRegenerate}>
            {labels.regenerate}
          </GhostBtn>
          <GradientBtn icon="doc" size="sm" full={false} onClick={doPrint}>
            {labels.print}
          </GradientBtn>
        </div>
      </div>

      {/* The document */}
      <div
        className="demo-print-root"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, padding: "24px 16px 60px" }}
      >
        {/* PAGE 1 — Cover */}
        <PrintPage bare>
          <div style={{ height: 190, background: `linear-gradient(135deg, ${NAVY}, ${NAVY_SOFT})`, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "22px 46px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#fff" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontWeight: 800, fontSize: 15, letterSpacing: 0.3 }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, background: GOLD, display: "grid", placeItems: "center" }}>
                  <Icon name="scale" size={18} color={NAVY} />
                </span>
                {labels.org}
              </span>
              <span style={{ fontSize: 12.5, opacity: 0.85, fontWeight: 700 }}>{staff.caseNumber}</span>
            </div>
            <div style={{ color: "#fff", fontSize: 11.5, letterSpacing: 2, textTransform: "uppercase", opacity: 0.82, fontWeight: 700 }}>
              {labels.coverKicker}
            </div>
          </div>

          <div style={{ padding: "54px 46px 0", textAlign: "center" }}>
            <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.15, color: NAVY, letterSpacing: -0.5, fontWeight: 900 }}>
              {exp.coverTitle}
            </h1>
            <div style={{ width: 120, height: 4, background: GOLD, borderRadius: 999, margin: "20px auto" }} />
            <p style={{ margin: 0, fontSize: 15, color: INK_SOFT, fontWeight: 600 }}>{exp.coverSubtitle}</p>
          </div>

          <div style={{ padding: "44px 60px 0" }}>
            <CoverRow k="Solicitante" v={staff.clientLegalName} />
            <CoverRow k="Dependientes" v="Alexander, Kamila y Amanda Rondón" />
            <CoverRow k="Servicio" v="Asilo Político (I-589)" />
            <CoverRow k="Plan" v={staff.planLabel} />
            <CoverRow k="Número de caso" v={staff.caseNumber} />
            <CoverRow k="Responsable" v={`${staff.owner.name} · ${staff.owner.role}`} />
          </div>

          <div style={{ margin: "56px 46px 0", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
            <span style={{ fontSize: 11, color: INK_SOFT, fontWeight: 600 }}>{labels.confidential}</span>
            <span style={{ fontSize: 11, color: INK_SOFT, fontWeight: 700 }}>{staff.caseNumber}</span>
          </div>
        </PrintPage>

        {/* PAGE 2 — Índice */}
        <PrintPage header={labels.org} caseNo={staff.caseNumber} footer={labels.confidential} page={pageLabel(2)}>
          <SectionTitle>{labels.tocTitle}</SectionTitle>
          <div style={{ marginTop: 18 }}>
            {exp.toc.map((e) => (
              <div key={e.title} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "10px 0", borderBottom: `1px solid ${LINE}` }}>
                <span style={{ fontSize: 14.5, color: INK, fontWeight: 700 }}>{e.title}</span>
                <span style={{ flex: 1, borderBottom: `1px dotted ${INK_SOFT}`, transform: "translateY(-4px)" }} />
                <span style={{ fontSize: 13.5, color: NAVY, fontWeight: 800 }}>{e.page}</span>
              </div>
            ))}
          </div>
        </PrintPage>

        {/* PAGE 3 — I-589 */}
        <PrintPage header={labels.org} caseNo={staff.caseNumber} footer={labels.confidential} page={pageLabel(3)}>
          <SectionKicker>Formulario oficial · USCIS</SectionKicker>
          <SectionTitle>Formulario I-589 — Parte A</SectionTitle>
          <p style={{ fontSize: 12.5, color: INK_SOFT, margin: "6px 0 16px", fontWeight: 600 }}>{staff.i589.officialTitle}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 22px" }}>
            {staff.i589.fields.map((f) => {
              const na = f.value == null;
              return (
                <div key={f.fieldName} style={{ borderBottom: `1px solid ${LINE}`, paddingBottom: 6 }}>
                  <div style={{ fontSize: 10.5, color: INK_SOFT, fontWeight: 700 }}>{f.official}</div>
                  <div style={{ fontSize: 13.5, color: na ? GOLD : INK, fontWeight: 800, marginTop: 2 }}>
                    {na ? "N/A" : f.value}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 18, fontSize: 11.5, color: INK_SOFT, fontStyle: "italic" }}>
            {staff.i589.naCount} campos sin dato se completaron con “N/A” conforme a 8 CFR 1208.3(c)(3). · {labels.repNote}
          </div>
        </PrintPage>

        {/* PAGE 4 — Memorándum */}
        <PrintPage header={labels.org} caseNo={staff.caseNumber} footer={labels.confidential} page={pageLabel(15)}>
          <SectionKicker>Generado con IA · Verificado</SectionKicker>
          <SectionTitle>Memorándum de Miedo Creíble</SectionTitle>
          <p style={{ fontSize: 13.5, color: INK, lineHeight: 1.7, margin: "10px 0 18px", textAlign: "justify" }}>
            La solicitante, <strong>{staff.clientLegalName}</strong>, ciudadana venezolana, presenta un
            temor fundado de persecución por su opinión política. Tras participar en manifestaciones
            pacíficas contra el régimen, fue amenazada, vigilada y agredida por grupos paraestatales, sin
            que el Estado ofreciera protección efectiva. El presente memorándum sustenta, con fundamento
            en la INA §208 y la jurisprudencia federal aplicable, que su caso satisface los elementos de
            un temor creíble de persecución.
          </p>
          <div style={{ background: GOLD_SOFT, borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, color: GOLD, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>Índice del memorándum</div>
            <ol style={{ margin: "8px 0 0", paddingLeft: 20, color: INK, fontSize: 13, lineHeight: 1.8 }}>
              {staff.memo.sections.map((s) => (
                <li key={s} style={{ fontWeight: 600 }}>{s}</li>
              ))}
            </ol>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Stat n={staff.memo.wordCount.toLocaleString("en-US")} label="palabras" />
            <Stat n={String(staff.memo.pageCount)} label="páginas" />
            <Stat n={String(staff.memo.exhibits)} label="precedentes" />
            <Stat n={String(staff.memo.sources)} label="fuentes verificadas" />
          </div>
        </PrintPage>

        {/* PAGE 5 — Anexos */}
        <PrintPage header={labels.org} caseNo={staff.caseNumber} footer={labels.confidential} page={pageLabel(266)}>
          <SectionKicker>Documentos de soporte</SectionKicker>
          <SectionTitle>Índice de anexos</SectionTitle>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 18 }}>
            {exp.anexos.map((group, gi) => (
              <div key={group.group}>
                <div style={{ fontSize: 13, color: NAVY, fontWeight: 800, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, background: NAVY, color: "#fff", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800 }}>
                    {String.fromCharCode(65 + gi)}
                  </span>
                  {group.group}
                </div>
                {group.items.map((it, ii) => (
                  <div key={it} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${LINE}` }}>
                    <Icon name="doc" size={15} color={GOLD} />
                    <span style={{ fontSize: 13, color: INK, fontWeight: 600 }}>{it}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11.5, color: INK_SOFT, fontWeight: 700 }}>
                      Anexo {String.fromCharCode(65 + gi)}.{ii + 1}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </PrintPage>

        {/* PAGE 6 — Cronología */}
        <PrintPage header={labels.org} caseNo={staff.caseNumber} footer={labels.confidential} page={pageLabel(283)}>
          <SectionKicker>Resumen del caso</SectionKicker>
          <SectionTitle>Tabla cronológica de hechos</SectionTitle>
          <div style={{ marginTop: 16 }}>
            {CHRONOLOGY.map((row) => (
              <div key={row.when} style={{ display: "flex", gap: 14, padding: "11px 0", borderBottom: `1px solid ${LINE}` }}>
                <span style={{ width: 96, flexShrink: 0, fontSize: 12.5, color: NAVY, fontWeight: 800 }}>{row.when}</span>
                <span style={{ fontSize: 13, color: INK, fontWeight: 600, lineHeight: 1.5 }}>{row.event}</span>
              </div>
            ))}
          </div>
        </PrintPage>
      </div>
    </div>,
    document.body,
  );
}

const CHRONOLOGY: { when: string; event: string }[] = [
  { when: "2018", event: "Se une a un partido político opositor y participa en manifestaciones pacíficas." },
  { when: "2021", event: "Recibe la primera amenaza directa tras liderar una protesta comunitaria." },
  { when: "2022", event: "Es vigilada y hostigada de forma reiterada por grupos afines al régimen." },
  { when: "2023", event: "Sufre una agresión física documentada en el informe médico del expediente." },
  { when: "Feb 2024", event: "Huye de Venezuela con sus tres hijos e ingresa a EE. UU. por Eagle Pass, Texas." },
  { when: "2025", event: "Presenta su solicitud de asilo (Formulario I-589) ante USCIS." },
];

function PrintPage({
  children,
  bare,
  header,
  caseNo,
  footer,
  page,
}: {
  children: React.ReactNode;
  bare?: boolean;
  header?: string;
  caseNo?: string;
  footer?: string;
  page?: string;
}) {
  return (
    <div
      className="demo-print-page"
      style={{
        position: "relative",
        width: PAGE_W,
        maxWidth: "100%",
        minHeight: 980,
        background: "#fff",
        borderRadius: 6,
        border: `1px solid ${LINE}`,
        boxShadow: "0 18px 44px rgba(11,27,51,0.16)",
        overflow: "hidden",
        color: INK,
        display: "flex",
        flexDirection: "column",
        padding: bare ? 0 : "40px 52px 56px",
      }}
    >
      {!bare && header && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottom: `2px solid ${GOLD}`, marginBottom: 22 }}>
          <span style={{ fontSize: 11.5, color: NAVY, fontWeight: 800 }}>{header}</span>
          <span style={{ fontSize: 11, color: INK_SOFT, fontWeight: 700 }}>{caseNo}</span>
        </div>
      )}
      <div style={{ flex: 1 }}>{children}</div>
      {!bare && page && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${LINE}`, paddingTop: 10, marginTop: 22 }}>
          <span style={{ fontSize: 10.5, color: INK_SOFT, fontWeight: 600 }}>{footer}</span>
          <span style={{ fontSize: 11, color: NAVY, fontWeight: 800 }}>{page}</span>
        </div>
      )}
    </div>
  );
}

function CoverRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "9px 0", borderBottom: `1px solid ${LINE}` }}>
      <span style={{ fontSize: 12.5, color: INK_SOFT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</span>
      <span style={{ fontSize: 14, color: NAVY, fontWeight: 800, textAlign: "right" }}>{v}</span>
    </div>
  );
}

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: GOLD, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ margin: 0, fontSize: 22, color: NAVY, fontWeight: 900, letterSpacing: -0.3 }}>{children}</h2>;
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 90, background: "#f5f7fa", borderRadius: 10, padding: "12px 10px", textAlign: "center", border: `1px solid ${LINE}` }}>
      <div style={{ fontSize: 20, color: NAVY, fontWeight: 900, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 10.5, color: INK_SOFT, fontWeight: 700, marginTop: 4 }}>{label}</div>
    </div>
  );
}
