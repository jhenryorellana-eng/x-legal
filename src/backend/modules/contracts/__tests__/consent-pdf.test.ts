/**
 * renderConsentPdf (DOC-51 §12) — assembles the frozen consent text + the
 * client's signature + the legal evidence line into a PDF. We mock the mupdf
 * html→pdf step and assert the assembled HTML (deterministic, fast).
 */

import { describe, it, expect, vi } from "vitest";

const mockHtmlToPdf = vi.hoisted(() =>
  vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
);
vi.mock("@/backend/platform/pdf", () => ({ htmlToPdf: mockHtmlToPdf }));

import { renderConsentPdf } from "../consent-pdf";
import type { ConsentDocumentSnapshot } from "@/shared/consent";

const snapshot: ConsentDocumentSnapshot = {
  locale: "es",
  title: "Antes de empezar",
  sections: [
    { title: "1. Naturaleza del servicio", body: "Texto de la sección uno." },
    { title: "2. Confidencialidad", body: "Texto de la sección dos." },
  ],
  closing: "Al firmar aceptas estos términos.",
};

describe("renderConsentPdf", () => {
  it("assembles the consent text + signature + evidence into a PDF", async () => {
    const bytes = await renderConsentPdf(snapshot, {
      signatureImageDataUrl: "data:image/jpeg;base64,AAAA",
      signerName: "María González",
      acceptedAt: "2026-07-09T12:00:00Z",
      ip: "203.0.113.7",
      version: "v1.0",
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(mockHtmlToPdf).toHaveBeenCalledOnce();
    const html = mockHtmlToPdf.mock.calls[0][0] as string;

    // The consent TEXT (not just the signature) is in the document.
    expect(html).toContain("Antes de empezar");
    expect(html).toContain("1. Naturaleza del servicio");
    expect(html).toContain("Texto de la sección dos.");
    expect(html).toContain("Al firmar aceptas estos términos.");
    // Signature embedded + legal evidence line.
    expect(html).toContain("data:image/jpeg;base64,AAAA");
    expect(html).toContain("María González");
    expect(html).toContain("2026-07-09");
    expect(html).toContain("203.0.113.7");
    expect(html).toContain("v1.0");
  });

  it("renders without an <img> when no signature image is provided", async () => {
    await renderConsentPdf(snapshot, { signerName: "X" });
    const html = mockHtmlToPdf.mock.calls.at(-1)![0] as string;
    expect(html).not.toContain("<img");
  });
});
