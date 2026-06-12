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
import { z } from "zod";
import {
  requestClientOtp,
  verifyClientOtp,
  requestStaffPasswordReset,
  updateStaffPassword,
  inviteEmployee,
  updateEmployeePermissions,
  deactivateEmployee,
  reactivateEmployee,
  listEmployees,
  IdentityError,
  type EmployeeRow,
} from "./service";
import type { EmployeePermissionInput } from "./repository";
import { requireActor } from "@/backend/platform/authz";
import { AuthzError } from "@/backend/platform/authz";
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
// signOutAction — authenticated (client or staff)
// ---------------------------------------------------------------------------

/**
 * Signs the current device out (scope: 'local') and redirects to the staff
 * login (DOC-22 §1.7). Used by the staff shell logout control.
 */
export async function signOutAction(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
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

// ---------------------------------------------------------------------------
// Employee management actions (F1)
// ---------------------------------------------------------------------------

/** Typed ActionResult for employee management actions (extends base ActionResult). */
export type TypedActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

function okTyped<T>(data: T): TypedActionResult<T> {
  return { ok: true, data };
}

function failTyped(code: string, message: string): TypedActionResult<never> {
  return { ok: false, error: { code, message } };
}

function handleEmployeeError(err: unknown): TypedActionResult<never> {
  if (err instanceof AuthzError) {
    return failTyped(err.reason, "No tienes permiso para realizar esta acción.");
  }
  if (err instanceof IdentityError) {
    return failTyped(err.code, err.message);
  }
  if (err instanceof z.ZodError) {
    // Zod v4: .issues (not .errors)
    return failTyped("VALIDATION_ERROR", err.issues[0]?.message ?? "Datos inválidos.");
  }
  const msg = err instanceof Error ? err.message : "Error inesperado.";
  logger.error({ err }, "[identity/actions] Unexpected employee management error");
  return failTyped("INTERNAL_ERROR", msg);
}

const InviteEmployeeSchema = z.object({
  // Zod v4: .email() takes no string arg (use options object if needed)
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  titleI18n: z.record(z.string(), z.unknown()).nullable().optional(),
  role: z.enum(["sales", "paralegal", "finance"]),
  permissionsPreset: z
    .array(
      z.object({
        module_key: z.string(),
        can_view: z.boolean(),
        can_edit: z.boolean(),
      }),
    )
    .optional(),
});

const UpdatePermissionsSchema = z.object({
  // Zod v4: .uuid() takes no string arg
  staffId: z.string().uuid(),
  permissions: z.array(
    z.object({
      module_key: z.string(),
      can_view: z.boolean(),
      can_edit: z.boolean(),
    }),
  ),
});

/**
 * Creates a new staff member and sends a staff-invite email.
 * @api-id API-AUT-09
 */
export async function inviteEmployeeAction(
  rawInput: unknown,
): Promise<TypedActionResult<{ userId: string }>> {
  try {
    const actor = await requireActor();
    const input = InviteEmployeeSchema.parse(rawInput);

    const result = await inviteEmployee(actor, {
      email: input.email,
      displayName: input.displayName,
      titleI18n: (input.titleI18n ?? null) as Record<string, string> | null,
      role: input.role,
      permissionsPreset: input.permissionsPreset as EmployeePermissionInput[] | undefined,
    });

    return okTyped({ userId: result.userId });
  } catch (err) {
    return handleEmployeeError(err);
  }
}

/**
 * Replaces the full permission matrix for a staff member.
 * Effect is immediate on the next request.
 * @api-id API-AUT-10
 */
export async function updateEmployeePermissionsAction(
  rawInput: unknown,
): Promise<TypedActionResult<void>> {
  try {
    const actor = await requireActor();
    const input = UpdatePermissionsSchema.parse(rawInput);

    await updateEmployeePermissions(
      actor,
      input.staffId,
      input.permissions as EmployeePermissionInput[],
    );

    return okTyped(undefined);
  } catch (err) {
    return handleEmployeeError(err);
  }
}

/**
 * Deactivates a staff member and revokes all their sessions.
 * @api-id API-AUT-11
 */
export async function deactivateEmployeeAction(
  staffId: string,
): Promise<TypedActionResult<void>> {
  try {
    const actor = await requireActor();
    z.string().uuid().parse(staffId);

    await deactivateEmployee(actor, staffId);
    return okTyped(undefined);
  } catch (err) {
    return handleEmployeeError(err);
  }
}

/**
 * Reactivates a previously deactivated staff member.
 * @api-id API-AUT-12
 */
export async function reactivateEmployeeAction(
  staffId: string,
): Promise<TypedActionResult<void>> {
  try {
    const actor = await requireActor();
    z.string().uuid().parse(staffId);

    await reactivateEmployee(actor, staffId);
    return okTyped(undefined);
  } catch (err) {
    return handleEmployeeError(err);
  }
}

/**
 * Lists all staff members with their permissions.
 * @api-id API-AUT-13
 */
export async function listEmployeesAction(): Promise<
  TypedActionResult<{ employees: EmployeeRow[] }>
> {
  try {
    const actor = await requireActor();
    const result = await listEmployees(actor);
    return okTyped(result);
  } catch (err) {
    return handleEmployeeError(err);
  }
}
