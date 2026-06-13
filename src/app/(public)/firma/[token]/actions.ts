"use server";

/**
 * Public contract-signing server action (DOC-22 §4, DOC-51 §27).
 *
 * The signing page is anonymous (bearer of the signing token). This thin
 * "use server" wrapper owns the IP extraction (server context) and delegates to
 * contracts.signContractFromImage, which wraps the signature image into the PDF
 * the `contracts` bucket requires, uploads it and records the signature.
 *
 * Boundary R1/R2: app → module-pub only (no platform import here).
 */

import { headers } from "next/headers";
import {
  signContractFromImage,
  ContractError,
} from "@/backend/modules/contracts";

export interface SignResult {
  ok: boolean;
  /** "signed" (just signed now) | "already" (CONTRACT_ALREADY_SIGNED) */
  outcome?: "signed" | "already";
  error?: { code: string };
}

export async function signContractAction(
  token: string,
  /** JPEG data URL — the client re-encodes the SignaturePad PNG to JPEG. */
  signatureJpegDataUrl: string,
): Promise<SignResult> {
  const headerStore = await headers();
  const ip =
    headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerStore.get("x-real-ip") ??
    "unknown";

  try {
    await signContractFromImage(token, signatureJpegDataUrl, ip);
    return { ok: true, outcome: "signed" };
  } catch (err) {
    if (err instanceof ContractError) {
      if (err.code === "CONTRACT_ALREADY_SIGNED") {
        return { ok: true, outcome: "already" };
      }
      return { ok: false, error: { code: "generic" } };
    }
    return { ok: false, error: { code: "generic" } };
  }
}
