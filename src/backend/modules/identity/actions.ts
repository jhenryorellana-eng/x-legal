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

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  loginClientByPhone,
  requestStaffPasswordReset,
  updateStaffPassword,
  inviteEmployee,
  updateEmployeePermissions,
  deactivateEmployee,
  reactivateEmployee,
  listEmployees,
  setUserLocale,
  setUserTimezone,
  setUserLocation,
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
// setUserLocaleAction — authenticated (client or staff)
// ---------------------------------------------------------------------------

const SetLocaleSchema = z.enum(["es", "en"]);

/**
 * Persists the authenticated user's UI language to `users.locale` AND mirrors it
 * to the `ulp-locale` cookie so next-intl re-renders in the new language on the
 * next request. Used by the client /config switch and every staff role's
 * configuración (DOC-24 i18n). The caller reloads after this resolves.
 */
export async function setUserLocaleAction(rawLocale: string): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const locale = SetLocaleSchema.parse(rawLocale);
    await setUserLocale(actor, locale);
    const jar = await cookies();
    jar.set("ulp-locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthzError) {
      return { ok: false, error: { code: "unauthorized", message: "No autorizado." } };
    }
    logger.error({ err }, "[setUserLocaleAction] Unexpected error");
    return { ok: false, error: { code: "unknown", message: "No se pudo cambiar el idioma." } };
  }
}

// ---------------------------------------------------------------------------
// setUserTimezoneAction — authenticated (client or staff)
// ---------------------------------------------------------------------------

const SetTimezoneSchema = z.string().min(1).max(64);

/**
 * Persists the authenticated user's timezone to `users.timezone` AND mirrors it
 * to the `ulp-tz` cookie so SSR (next-intl getTimeZone) renders appointment
 * times in the new zone on the next request. The client /config switch reloads
 * after this resolves. Invalid zones fall back to America/New_York in service.
 */
export async function setUserTimezoneAction(rawTz: string): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const candidate = SetTimezoneSchema.parse(rawTz);
    const tz = await setUserTimezone(actor, candidate);
    const jar = await cookies();
    jar.set("ulp-tz", tz, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthzError) {
      return { ok: false, error: { code: "unauthorized", message: "No autorizado." } };
    }
    logger.error({ err }, "[setUserTimezoneAction] Unexpected error");
    return { ok: false, error: { code: "unknown", message: "No se pudo cambiar la zona horaria." } };
  }
}

// ---------------------------------------------------------------------------
// setUserLocationAction — authenticated (client or staff)
// ---------------------------------------------------------------------------

const SetLocationSchema = z.object({
  timezone: z.string().min(1).max(64),
  city: z.string().max(120).nullable().optional(),
  country: z.string().max(120).nullable().optional(),
  countryCode: z.string().max(8).nullable().optional(),
});

/**
 * Persists the user's detected location (timezone + city/country) to the DB AND
 * mirrors the timezone to the ulp-tz cookie so SSR renders in the new zone. Used
 * by the "Detect my location" button (browser geolocation + reverse geocode).
 * The client reloads after this resolves.
 */
export async function setUserLocationAction(raw: {
  timezone: string;
  city?: string | null;
  country?: string | null;
  countryCode?: string | null;
}): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    const input = SetLocationSchema.parse(raw);
    const tz = await setUserLocation(actor, input);
    const jar = await cookies();
    jar.set("ulp-tz", tz, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthzError) {
      return { ok: false, error: { code: "unauthorized", message: "No autorizado." } };
    }
    logger.error({ err }, "[setUserLocationAction] Unexpected error");
    return { ok: false, error: { code: "unknown", message: "No se pudo guardar la ubicación." } };
  }
}

// ---------------------------------------------------------------------------
// loginClientByPhoneAction — public, no Actor (DOC-22 §1, phone-only login)
// ---------------------------------------------------------------------------

/**
 * Logs a client in with ONLY their phone number (no OTP — TEMPORARY, SMS-OTP
 * comes later). On success the SSR session cookie is set and the UI navigates to
 * /home. A non-existent / ineligible phone returns the SAME uniform error as a
 * sign-in failure (anti-enumeration). Only rate limit / malformed phone get a
 * specific message.
 */
export async function loginClientByPhoneAction(
  rawPhone: string,
): Promise<ActionResult> {
  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? headerStore.get("x-real-ip")
    ?? "unknown";

  try {
    await loginClientByPhone(rawPhone, ip);
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
            message: "El teléfono no es válido. Verifica e intenta de nuevo.",
          },
        };
      }
      if (err.code === "wrong_kind") {
        // Not found / ineligible / sign-in failed — uniform message (anti-enum).
        return {
          ok: false,
          error: {
            code: "no_access",
            message: "No encontramos un caso con ese número. Verifica e intenta de nuevo.",
          },
        };
      }
    }
    logger.error({ err }, "[loginClientByPhoneAction] Unexpected error");
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
