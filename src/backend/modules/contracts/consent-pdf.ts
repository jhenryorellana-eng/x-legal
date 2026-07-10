/**
 * Consent PDF renderer (DOC-51 §12).
 *
 * Assembles the frozen in-app consent (the text the client read + accepted) with
 * the client's signature image and legal metadata (date, IP, terms version) into
 * a US-Letter PDF via the platform mupdf html→pdf pipeline. This is what the
 * "Descargar consentimiento firmado" button serves — the full signed document,
 * not just the signature image.
 *
 * Mirrors contract-pdf.ts: builds an HTML string from the snapshot + optional
 * signature, then delegates rasterization to platform/pdf. No DB/IO of its own.
 *
 * @module contracts/consent-pdf
 */

import { htmlToPdf } from "@/backend/platform/pdf";
import type { ConsentDocumentSnapshot } from "@/shared/consent";

const NAVY = "#002855";
const INK = "#1a1a1a";
const INK2 = "#444";
const INK3 = "#777";

function esc(s: string): string {
  return String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

/** Renders a plain-text block into paragraphs, preserving blank-line breaks. */
function paragraphs(text: string): string {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 8px;font-size:11pt;line-height:1.55;color:${INK2}">${esc(
          p,
        ).replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
}

export interface ConsentPdfOptions {
  /** Client signature as a data URL (image/jpeg|png). Embedded in the sign block. */
  signatureImageDataUrl?: string | null;
  /** Signer's display name, shown under the signature line. */
  signerName?: string | null;
  /** Acceptance timestamp (ISO) — rendered as the signed-on date. */
  acceptedAt?: string | null;
  /** Acceptance IP, part of the legal evidence line. */
  ip?: string | null;
  /** Accepted terms version (e.g. "v1.0"). */
  version?: string | null;
}

/** Localized labels (the snapshot carries its own locale). */
function labels(locale: string) {
  const en = locale === "en";
  return {
    signature: en ? "Client signature" : "Firma del cliente",
    signedOn: en ? "Signed on" : "Firmado el",
    evidence: en ? "Acceptance record" : "Registro de aceptación",
    ip: "IP",
    version: en ? "Version" : "Versión",
  };
}

/** Renders the signed consent (text + signature + evidence) to a US-Letter PDF. */
export async function renderConsentPdf(
  snapshot: ConsentDocumentSnapshot,
  opts: ConsentPdfOptions = {},
): Promise<Uint8Array> {
  const L = labels(snapshot.locale ?? "es");

  const sectionsHtml = (snapshot.sections ?? [])
    .map(
      (sec) =>
        `<section style="margin:0 0 14px">
          ${
            sec.title
              ? `<h3 style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-weight:bold;font-size:12pt;color:${NAVY}">${esc(
                  sec.title,
                )}</h3>`
              : ""
          }
          ${paragraphs(sec.body)}
        </section>`,
    )
    .join("");

  const closingHtml = snapshot.closing
    ? `<section style="margin:14px 0 0">${paragraphs(snapshot.closing)}</section>`
    : "";

  const signatureImg = opts.signatureImageDataUrl
    ? `<img src="${opts.signatureImageDataUrl}" alt="" style="max-height:64pt;max-width:220pt;display:block;margin:0 0 4px" />`
    : `<div style="height:52pt"></div>`;

  const signedOn = opts.acceptedAt ? `${L.signedOn} ${opts.acceptedAt.slice(0, 10)}` : "";
  const evidenceBits = [
    signedOn,
    opts.ip ? `${L.ip}: ${esc(opts.ip)}` : "",
    opts.version ? `${L.version}: ${esc(opts.version)}` : "",
  ].filter(Boolean);

  const signatureHtml = `<section style="margin:28px 0 0">
    <table style="width:100%;border-collapse:collapse"><tr>
      <td style="width:55%;vertical-align:bottom">
        ${signatureImg}
        <div style="border-top:1px solid ${INK};padding-top:4px">
          <p style="margin:0;font-size:11pt;font-weight:bold;color:${INK}">${esc(
            opts.signerName ?? "",
          )}</p>
          <p style="margin:0;font-size:9.5pt;color:${INK2}">${esc(L.signature)}</p>
        </div>
      </td>
    </tr></table>
    ${
      evidenceBits.length
        ? `<p style="margin:14px 0 0;font-size:9pt;color:${INK3}">${esc(
            L.evidence,
          )} — ${evidenceBits.join(" · ")}</p>`
        : ""
    }
  </section>`;

  const html = `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;margin:54pt;color:${INK}">
    <header style="text-align:center;margin:0 0 18px">
      <h1 style="margin:0 0 4px;font-size:15pt;color:${NAVY};letter-spacing:0.04em">${esc(
        snapshot.title,
      )}</h1>
      <div style="height:3px;background:${NAVY};margin:10px auto 0;max-width:140pt"></div>
    </header>
    ${sectionsHtml}
    ${closingHtml}
    ${signatureHtml}
  </body></html>`;

  return htmlToPdf(html);
}
