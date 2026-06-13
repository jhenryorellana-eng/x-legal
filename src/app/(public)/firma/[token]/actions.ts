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
  /**
   * "signed" — signed successfully now.
   * "already" — reserved for future secondary lookup; currently unreachable
   * (H-1: token null-lookup returns CONTRACT_TOKEN_INVALID, not CONTRACT_ALREADY_SIGNED).
   */
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
    // H-1: CONTRACT_ALREADY_SIGNED is dead code here — signContract looks up the
    // contract by signing_token, which is nulled atomically at signing time. A
    // second call with the same token therefore hits the null lookup and throws
    // CONTRACT_TOKEN_INVALID, never CONTRACT_ALREADY_SIGNED. We removed the dead
    // branch: both "token not found / expired / consumed" and "already signed" map
    // to the same generic error screen, which is the intended anti-enumeration UX
    // (DOC-22 §4). If a distinct "already signed" screen is ever needed, a
    // secondary contract lookup by token history would be required.
    if (err instanceof ContractError) {
      return { ok: false, error: { code: "generic" } };
    }
    return { ok: false, error: { code: "generic" } };
  }
}
