/**
 * Contract PDF renderer (DOC-51).
 *
 * Turns a frozen ContractDocument into a US-Letter PDF via the platform mupdf
 * html→pdf pipeline. Used for: (a) the unsigned preview the admin can download,
 * and (b) the SIGNED contract — the same document with the client's signature
 * image embedded — attached to the case after the client signs the /firma link.
 *
 * Pure-ish: builds an HTML string from the document + optional signature, then
 * delegates rasterization to platform/pdf. No DB/IO of its own.
 *
 * @module contracts/contract-pdf
 */

import { htmlToPdf } from "@/backend/platform/pdf";
import type { ContractBlock, ContractDocument } from "./contract-document";

const NAVY = "#002855";
const INK = "#1a1a1a";
const INK2 = "#444";
const LINE = "#d8d8d8";

function esc(s: string): string {
  return String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

function blockHtml(block: ContractBlock): string {
  switch (block.kind) {
    case "paragraph":
      return `<p style="margin:0 0 8px;font-size:11pt;line-height:1.5;color:${INK2}">${esc(block.text)}</p>`;
    case "list":
      return `<ol style="margin:0 0 8px;padding-left:20pt;color:${INK2}">${block.items
        .map((it) => `<li style="font-size:11pt;line-height:1.5;margin-bottom:3pt">${esc(it)}</li>`)
        .join("")}</ol>`;
    case "fieldGroup":
      return `<div style="margin:0 0 10px">
        <p style="margin:0 0 3px;font-size:11pt;font-weight:bold;color:${INK}">${esc(block.heading)}</p>
        ${block.rows
          .map(
            (r) =>
              `<p style="margin:0;font-size:11pt;line-height:1.5;color:${INK2}"><b style="color:${INK}">${esc(r.label)}:</b> ${esc(r.value)}</p>`,
          )
          .join("")}
      </div>`;
    case "scheduleTable":
      return `<table style="width:100%;border-collapse:collapse;margin:4px 0 8px;font-size:10.5pt">
        <thead><tr>${block.headers
          .map(
            (h, i) =>
              `<th style="text-align:${i === 0 ? "left" : i === 2 ? "right" : "center"};padding:5px 6px;border-bottom:2px solid ${LINE};color:${INK2};font-size:9.5pt">${esc(h)}</th>`,
          )
          .join("")}</tr></thead>
        <tbody>${block.rows
          .map(
            (row) =>
              `<tr style="${row.emphasis ? "font-weight:bold" : ""}">${row.cells
                .map(
                  (c, j) =>
                    `<td style="text-align:${j === 0 ? "left" : j === 2 ? "right" : "center"};padding:5px 6px;border-top:1px solid ${LINE};color:${row.emphasis ? INK : INK2}">${esc(c)}</td>`,
                )
                .join("")}</tr>`,
          )
          .join("")}</tbody>
      </table>`;
    default:
      return "";
  }
}

export interface ContractPdfOptions {
  /** Client signature as a data URL (image/jpeg|png). Embedded in the signatures block. */
  signatureImageDataUrl?: string | null;
  /** Localized "Signed on {date}" line, when signed. */
  signedOnLabel?: string | null;
}

/** Renders the contract document (optionally signed) to a US-Letter PDF. */
export async function renderContractPdf(
  document: ContractDocument,
  opts: ContractPdfOptions = {},
): Promise<Uint8Array> {
  const sectionsHtml = document.sections
    .map(
      (sec) =>
        `<section style="margin:0 0 14px">
          <h3 style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-weight:bold;font-size:12pt;color:${NAVY}">${esc(sec.title)}</h3>
          ${sec.blocks.map(blockHtml).join("")}
        </section>`,
    )
    .join("");

  const sig = document.signatures;
  const clientSigImg = opts.signatureImageDataUrl
    ? `<img src="${opts.signatureImageDataUrl}" alt="" style="max-height:60pt;max-width:200pt;display:block;margin:0 0 4px" />`
    : `<div style="height:48pt"></div>`;
  // Consultant "manuscript" signature: italic representative name (no custom font in mupdf).
  const consultorSig = `<div style="font-style:italic;font-size:16pt;color:${NAVY};margin:0 0 4px">${esc(sig.consultor.name)}</div>`;

  const signaturesHtml = `<section style="margin:24px 0 0">
    <table style="width:100%;border-collapse:collapse"><tr>
      <td style="width:50%;vertical-align:bottom;padding-right:18pt">
        ${consultorSig}
        <div style="border-top:1px solid ${INK};padding-top:4px">
          <p style="margin:0;font-size:11pt;font-weight:bold;color:${INK}">${esc(sig.consultor.name)}</p>
          <p style="margin:0;font-size:9.5pt;color:${INK2}">${esc(sig.consultor.role)}</p>
        </div>
      </td>
      <td style="width:50%;vertical-align:bottom;padding-left:18pt">
        ${clientSigImg}
        <div style="border-top:1px solid ${INK};padding-top:4px">
          <p style="margin:0;font-size:11pt;font-weight:bold;color:${INK}">${esc(sig.client.name)}</p>
          <p style="margin:0;font-size:9.5pt;color:${INK2}">${esc(sig.client.role)}</p>
        </div>
      </td>
    </tr></table>
    ${opts.signedOnLabel ? `<p style="margin:14px 0 0;font-size:9.5pt;color:${INK2}">${esc(opts.signedOnLabel)}</p>` : ""}
  </section>`;

  const html = `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;margin:54pt;color:${INK}">
    <header style="text-align:center;margin:0 0 18px">
      <h1 style="margin:0 0 4px;font-size:15pt;color:${NAVY};letter-spacing:0.04em">${esc(document.title)}</h1>
      ${document.subtitle ? `<p style="margin:0 0 2px;font-size:12pt;font-weight:bold;color:${INK}">${esc(document.subtitle)}</p>` : ""}
      ${document.dateLabel ? `<p style="margin:0;font-size:10pt;color:${INK2}">${esc(document.dateLabel)}</p>` : ""}
      <div style="height:3px;background:${NAVY};margin:10px auto 0;max-width:140pt"></div>
    </header>
    ${sectionsHtml}
    ${signaturesHtml}
  </body></html>`;

  return htmlToPdf(html);
}
