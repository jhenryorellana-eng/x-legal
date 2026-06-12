/**
 * Identity server actions — public surface (module-pub boundary).
 *
 * These are Next.js Server Actions consumed by the app layer.
 * They are the only legal entry point from app/* into this module.
 *
 * Boundary rule (DOC-21 R1/R2): app → module-pub (index/actions) only.
 * Actions delegate entirely to service.ts; they handle:
 * - Header reading (IP extraction) — server context
 * - Error → user-facing result mapping
 * - Redirect on re-gate failure
 *
 * CSRF protection: Next.js Server Actions validate Origin header natively
 * (DOC-27 §6.3); no additional CSRF token needed.
 */

"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  requestClientOtp,
  verifyClientOtp,
  requestStaffPasswordReset,
  updateStaffPassword,
  IdentityError,
} from "./service";
import { createServerClient } from "@/backend/platform/supabase";
import { limitStaffLogin } from "@/backend/platform/ratelimit";
import { logger } from "@/backend/platform/logger";
import { env } from "@/backend/platform/env";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ActionResult {
  ok: boolean;
  error?: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// signInStaffAction — public, staff login
// ---------------------------------------------------------------------------

/**
 * Staff email+password login.
 * Rate limited: 5 attempts per 15 min per email+IP (DOC-27 §4).
 */
export async function signInStaffAction(
  email: string,
  password: string,
): Promise<ActionResult> {
  const headerStore = await headers();
  const ip =
    headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerStore.get("x-real-ip") ??
    "unknown";

  // Rate limit: 5/15 min per email+IP (DOC-27 §4)
  const rl = await limitStaffLogin(email, ip);
  if (!rl.allowed) {
    return {
      ok: false,
      error: { code: "rate_limited", message: "Demasiados intentos. Espera 15 minutos." },
    };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    logger.info({ err: error.message }, "signInStaff: failed");
    return {
      ok: false,
      error: { code: "invalid_credentials", message: "Email o contraseña incorrectos." },
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// requestClientOtpAction — public, no Actor
// ---------------------------------------------------------------------------

/**
 * Requests an OTP for the given phone number.
 * Always returns { ok: true } even if the phone is not registered (anti-enumeration).
 * Only throws on rate limit (so UI can show the "wait" message).
 */
export async function requestClientOtpAction(
  rawPhone: string,
): Promise<ActionResult> {
  // Extract IP for per-IP rate limiting
  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? headerStore.get("x-real-ip")
    ?? "unknown";

  try {
    await requestClientOtp(rawPhone, ip);
    return { ok: true };
  } catch (err) {
    if (err instanceof IdentityError) {
      if (err.code === "rate_limited") {
        return {
          ok: false,
          error: {
            code: "rate_limited",
            message: "Demasiados intentos. Espera unos minutos antes de reintentar.",
          },
        };
      }
      if (err.code === "invalid_phone") {
        return {
          ok: false,
          error: {
            code: "invalid_phone",
            message: "El número de teléfono no es válido. Verifica e intenta de nuevo.",
          },
        };
      }
    }
    // Unexpected error — return generic, log server-side
    logger.error({ err }, "[requestClientOtpAction] Unexpected error");
    return {
      ok: false,
      error: { code: "unknown", message: "Algo salió mal. Intenta de nuevo." },
    };
  }
}

// ---------------------------------------------------------------------------
// verifyClientOtpAction — public, no Actor
// ---------------------------------------------------------------------------

/**
 * Verifies an OTP code.
 * On re-gate failure (RF-CLI-006): redirects to /no-access.
 * On invalid code: returns generic error ("Ese código no coincide").
 */
export async function verifyClientOtpAction(
  rawPhone: string,
  code: string,
): Promise<ActionResult> {
  try {
    await verifyClientOtp(rawPhone, code);
    return { ok: true };
  } catch (err) {
    if (err instanceof IdentityError) {
      if (err.code === "wrong_kind" && err.message === "no_access") {
        // Re-gate failed — redirect to no-access (DOC-22 RF-CLI-006)
        redirect("/no-access");
      }
      if (err.code === "rate_limited") {
        return {
          ok: false,
          error: {
            code: "rate_limited",
            message: "Demasiados intentos. Espera unos minutos.",
          },
        };
      }
      if (err.code === "invalid_otp") {
        return {
          ok: false,
          error: {
            code: "invalid_otp",
            message: "Ese código no coincide. Inténtalo de nuevo, sin prisa.",
          },
        };
      }
    }
    logger.error({ err }, "[verifyClientOtpAction] Unexpected error");
    return {
      ok: false,
      error: { code: "unknown", message: "Algo salió mal. Intenta de nuevo." },
    };
  }
}

// ---------------------------------------------------------------------------
// requestStaffPasswordResetAction — public, no Actor
// ---------------------------------------------------------------------------

/**
 * Sends a password reset email.
 * Always returns { ok: true } (DOC-22 §2.4 anti-enumeration).
 */
export async function requestStaffPasswordResetAction(
  email: string,
): Promise<ActionResult> {
  const appUrl = env.NEXT_PUBLIC_APP_URL;
  const redirectTo = `${appUrl}/reset-password`;

  try {
    await requestStaffPasswordReset(email, redirectTo);
  } catch {
    // Swallow — uniform response
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// updateStaffPasswordAction — authenticated
// ---------------------------------------------------------------------------

/**
 * Changes the staff member's own password.
 * On success, redirects to /admin (the staff home).
 */
export async function updateStaffPasswordAction(
  newPassword: string,
): Promise<ActionResult> {
  try {
    await updateStaffPassword(newPassword);
    // After a successful password change, redirect to staff home
    redirect("/admin");
  } catch (err) {
    if (err instanceof IdentityError) {
      if (err.code === "password_too_short") {
        return {
          ok: false,
          error: {
            code: "password_too_short",
            message: "La contraseña debe tener al menos 12 caracteres.",
          },
        };
      }
      if (err.code === "password_too_weak") {
        return {
          ok: false,
          error: {
            code: "password_too_weak",
            message: "La contraseña es muy fácil de adivinar. Intenta con una combinación más variada.",
          },
        };
      }
      if (err.code === "unauthenticated") {
        redirect("/login");
      }
      if (err.code === "wrong_kind") {
        redirect("/welcome");
      }
    }
    logger.error({ err }, "[updateStaffPasswordAction] Unexpected error");
    return {
      ok: false,
      error: { code: "unknown", message: "Algo salió mal. Intenta de nuevo." },
    };
  }
}
