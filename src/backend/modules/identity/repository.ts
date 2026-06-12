/**
 * Identity repository — data access layer.
 *
 * All queries use the service client (RLS bypass) for gate checks,
 * as required by DOC-22 §1.4: the gate query must be authoritative
 * and not subject to the client's own RLS context.
 *
 * This file is internal to the identity module (module-int boundary).
 */

import { createServiceClient } from "@/backend/platform/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientEligibilityResult {
  eligible: boolean;
}

// ---------------------------------------------------------------------------
// Gate: "solo teléfonos con contrato" — DOC-22 §1.4
//
// A client is eligible to receive an OTP if:
//   - users.phone_e164 = <phone> AND users.kind = 'client' AND users.is_active = true
//   - AND EXISTS at least 1 case_members row joining a case with opened_at IS NOT NULL
//     (i.e., the case has been activated — opened_at set on payment confirmed + case activation)
//
// This query runs with the SERVICE CLIENT to bypass RLS (DOC-22 §1.4).
// ---------------------------------------------------------------------------

/**
 * Checks whether a phone number belongs to an eligible client.
 * A client is eligible if they have kind='client', is_active=true,
 * and at least one activated case (cases.opened_at IS NOT NULL).
 *
 * Anti-enumeration: always returns { eligible: false } on any error —
 * errors are logged server-side but NOT surfaced to callers.
 */
export async function checkClientEligibility(
  phoneE164: string,
): Promise<ClientEligibilityResult> {
  try {
    const supabase = createServiceClient();

    // Single query: users + existence of an activated case_member
    // We use a join approach with .select() + .limit(1) for efficiency.
    const { data, error } = await supabase
      .from("users")
      .select(
        `
        id,
        is_active,
        kind,
        case_members!inner(
          case_id,
          cases!inner(opened_at)
        )
      `,
      )
      .eq("phone_e164", phoneE164)
      .eq("kind", "client")
      .eq("is_active", true)
      .not("case_members.cases.opened_at", "is", null)
      .limit(1)
      .single();

    if (error || !data) {
      return { eligible: false };
    }

    return { eligible: true };
  } catch {
    // Never leak error details to callers (anti-enumeration)
    return { eligible: false };
  }
}

/**
 * Same eligibility check used by the post-OTP re-gate (RF-CLI-006).
 * Accepts a userId (already known from the verified session) instead of phone.
 */
export async function checkClientEligibilityById(
  userId: string,
): Promise<ClientEligibilityResult> {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("users")
      .select(
        `
        id,
        is_active,
        kind,
        case_members!inner(
          case_id,
          cases!inner(opened_at)
        )
      `,
      )
      .eq("id", userId)
      .eq("kind", "client")
      .eq("is_active", true)
      .not("case_members.cases.opened_at", "is", null)
      .limit(1)
      .single();

    if (error || !data) {
      return { eligible: false };
    }

    return { eligible: true };
  } catch {
    return { eligible: false };
  }
}
