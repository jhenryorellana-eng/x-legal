"use server";

/**
 * Disclaimer (in-app terms acceptance) server action — DOC-51 §12
 * (API-CASE-12 + API-CTR-06).
 *
 * Thin "use server" wrapper over contracts.acceptTermsFromImage (module-pub),
 * which owns the PDF wrapping + signed-URL upload + acceptance recording. The app
 * layer only resolves the actor and the client IP (server context) and stays
 * boundary-clean (app → module-pub only).
 */

import { headers } from "next/headers";
import { requireActor } from "@/backend/modules/identity";
import { acceptTermsFromImage, ContractError } from "@/backend/modules/contracts";

export interface AcceptTermsResult {
  ok: boolean;
  error?: { code: string };
}

function clientIp(headerStore: Headers): string {
  return (
    headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerStore.get("x-real-ip") ??
    "0.0.0.0"
  );
}

export async function acceptTermsAction(input: {
  caseId: string;
  /** SignaturePad output re-encoded to JPEG: "data:image/jpeg;base64,...". */
  signatureJpegDataUrl: string;
}): Promise<AcceptTermsResult> {
  try {
    const actor = await requireActor();
    const headerStore = await headers();
    await acceptTermsFromImage(actor, {
      caseId: input.caseId,
      signatureJpegDataUrl: input.signatureJpegDataUrl,
      ip: clientIp(headerStore),
    });
    return { ok: true };
  } catch (err) {
    const code = err instanceof ContractError ? err.code : "UNEXPECTED";
    return { ok: false, error: { code } };
  }
}
