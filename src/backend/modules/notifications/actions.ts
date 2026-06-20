"use server";

/**
 * Notifications module — server actions ("use server"; importable by client UI).
 *
 * Each action: requireActor() → service → typed ActionResult. A "use server"
 * file may only export async functions, so ActionResult and the ok/fail helpers
 * are kept internal.
 */

import { requireActor, AuthzError } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import {
  getNotifications,
  markRead,
  markAllRead,
  getUnreadCount,
  getPreferences,
  updatePreferences,
  registerPushSubscription,
  removePushSubscription,
} from "./service";
import type {
  NotificationsPage,
  NotificationPreferences,
} from "./index";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

function fail(err: unknown): ActionResult<never> {
  if (err instanceof AuthzError) {
    return { success: false, error: { code: err.reason ?? "UNAUTHORIZED", message: "Unauthorized" } };
  }
  logger.error({ err }, "notifications action: unexpected error");
  return { success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } };
}

// ---------------------------------------------------------------------------
// Center (list / unread / mark) — DOC-47 §5.3
// ---------------------------------------------------------------------------

export async function listNotificationsAction(
  opts: { cursor?: string; limit?: number },
): Promise<ActionResult<NotificationsPage>> {
  try {
    const actor = await requireActor();
    return ok(await getNotifications(actor, opts));
  } catch (err) {
    return fail(err);
  }
}

export async function getUnreadCountAction(): Promise<ActionResult<{ total: number }>> {
  try {
    const actor = await requireActor();
    return ok(await getUnreadCount(actor));
  } catch (err) {
    return fail(err);
  }
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await markRead(actor, notificationId);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await markAllRead(actor);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Preferences — DOC-47 §5.3
// ---------------------------------------------------------------------------

export async function getPreferencesAction(): Promise<ActionResult<NotificationPreferences>> {
  try {
    const actor = await requireActor();
    return ok(await getPreferences(actor));
  } catch (err) {
    return fail(err);
  }
}

export async function updatePreferencesAction(
  input: Partial<NotificationPreferences> & { channels?: Partial<NotificationPreferences["channels"]> },
): Promise<ActionResult<NotificationPreferences>> {
  try {
    const actor = await requireActor();
    return ok(await updatePreferences(actor, input));
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Web Push subscription — DOC-47 §5.3 + DOC-24
// ---------------------------------------------------------------------------

export async function registerPushSubscriptionAction(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  platform?: string;
}): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await registerPushSubscription(actor, input);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

export async function removePushSubscriptionAction(
  endpoint: string,
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await removePushSubscription(actor, endpoint);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}
