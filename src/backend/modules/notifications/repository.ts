/**
 * Notifications module — repository (data access layer).
 *
 * @module notifications/repository
 */

import {
  createServerClient,
  createServiceClient,
} from "@/backend/platform/supabase";
import type { Tables } from "@/shared/database.types";

export type NotificationRow = Tables<"notifications">;

// ---------------------------------------------------------------------------
// Insert idempotent — dedupe_key prevents duplicate notifications
// ---------------------------------------------------------------------------

export interface InsertNotificationResult {
  row: NotificationRow;
  created: boolean;
}

/**
 * Inserts a notification idempotently using dedupe_key.
 *
 * If a row with the same dedupe_key already exists, returns it with created=false.
 * This implements RF-TRX-024 CA2 (re-delivery of events produces 0 new rows).
 */
export async function insertNotificationIdempotent(input: {
  userId: string;
  type: string;
  titleI18n: { en: string; es: string };
  bodyI18n?: { en: string; es: string } | null;
  icon?: string;
  color?: string;
  actionUrl?: string | null;
  dedupeKey: string;
}): Promise<InsertNotificationResult> {
  const supabase = createServiceClient();

  // Fast path: already exists? Scoped to (user_id, dedupe_key) — the partial
  // unique index `notifications_user_dedupe_key_idx`.
  const { data: existing } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", input.userId)
    .eq("dedupe_key", input.dedupeKey)
    .maybeSingle();

  if (existing) {
    return { row: existing, created: false };
  }

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_id: input.userId,
      type: input.type,
      title_i18n: input.titleI18n as unknown as import("@/shared/database.types").Json,
      body_i18n: (input.bodyI18n ?? null) as unknown as import("@/shared/database.types").Json,
      icon: input.icon ?? "bell",
      color: input.color ?? "gray",
      action_url: input.actionUrl ?? null,
      dedupe_key: input.dedupeKey,
      read_at: null,
    })
    .select()
    .single();

  if (error || !data) {
    // A concurrent insert (QStash retry / event re-delivery) won the unique
    // (user_id, dedupe_key) race → re-read and report not-created so the heavy
    // channels (push/email) are NOT enqueued twice.
    if ((error as { code?: string } | null)?.code === "23505") {
      const { data: raced } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", input.userId)
        .eq("dedupe_key", input.dedupeKey)
        .maybeSingle();
      if (raced) return { row: raced, created: false };
    }
    throw new Error(
      `notifications.repository: insertNotificationIdempotent failed — ${error?.message}`,
    );
  }

  return { row: data, created: true };
}

// ---------------------------------------------------------------------------
// List notifications (paginated, actor-scoped)
// ---------------------------------------------------------------------------

export interface NotificationsPage {
  items: NotificationRow[];
  nextCursor: string | null;
}

export async function listNotificationsForUser(
  userId: string,
  opts: { cursor?: string; limit?: number },
): Promise<NotificationsPage> {
  const limit = opts.limit ?? 20;
  const supabase = await createServerClient();

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (opts.cursor) {
    query = query.lt("created_at", opts.cursor);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `notifications.repository: listNotificationsForUser failed — ${error.message}`,
    );
  }

  const items = data ?? [];
  const hasMore = items.length > limit;
  if (hasMore) items.pop();

  return {
    items,
    nextCursor:
      hasMore && items.length > 0 ? items[items.length - 1].created_at : null,
  };
}

// ---------------------------------------------------------------------------
// Mark read
// ---------------------------------------------------------------------------

export async function markNotificationRead(
  notificationId: string,
  userId: string,
): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId) // RLS-equivalent guard
    .is("read_at", null);

  if (error) {
    throw new Error(
      `notifications.repository: markNotificationRead failed — ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Find notification by ID (for deliver-notification job)
// ---------------------------------------------------------------------------

export async function findNotificationById(
  notificationId: string,
): Promise<NotificationRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("id", notificationId)
    .maybeSingle();

  return data ?? null;
}

// ---------------------------------------------------------------------------
// Resolve recipient info for notifications
// ---------------------------------------------------------------------------

export interface RecipientInfo {
  id: string;
  email: string | null;
  emailBouncedAt: string | null;
  locale: string | null;
  kind: string;
}

export async function findUserById(userId: string): Promise<RecipientInfo | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("id, email, email_bounced_at, locale, kind")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    email: (data as unknown as Record<string, unknown>).email as string | null,
    emailBouncedAt: (data as unknown as Record<string, unknown>).email_bounced_at as string | null,
    locale: (data as unknown as Record<string, unknown>).locale as string | null,
    kind: data.kind,
  };
}

/**
 * Returns the staff user IDs for a given role (e.g. "finance").
 */
export async function findStaffByRole(role: string): Promise<string[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("staff_profiles")
    .select("user_id, users!inner(is_active)")
    .eq("role", role)
    .eq("users.is_active", true);

  if (!data) return [];
  return data.map((r) => r.user_id);
}

/**
 * Returns case_members user IDs (clients) for a case.
 */
export async function findCaseClientMembers(caseId: string): Promise<string[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("case_members")
    .select("user_id, users!inner(kind, is_active)")
    .eq("case_id", caseId)
    .eq("users.kind", "client")
    .eq("users.is_active", true);

  if (!data) return [];
  return data.map((r) => r.user_id);
}

/**
 * Returns case assigned_sales_id and assigned_paralegal_id.
 */
export async function findCaseAssignedStaff(caseId: string): Promise<{
  salesId: string | null;
  paralegalId: string | null;
}> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cases")
    .select("assigned_sales_id, assigned_paralegal_id")
    .eq("id", caseId)
    .maybeSingle();

  return {
    salesId: data?.assigned_sales_id ?? null,
    paralegalId: data?.assigned_paralegal_id ?? null,
  };
}

/**
 * Returns the staff user_id assigned to a lead (leads.assigned_to field).
 * Used by the lead.created notification rule (DOC-47 §4.3).
 */
export async function findLeadAssignedStaff(
  leadId: string,
): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("leads")
    .select("assigned_to")
    .eq("id", leadId)
    .maybeSingle();

  return data?.assigned_to ?? null;
}

// ---------------------------------------------------------------------------
// Preferences (DOC-47 §4.1 step 4 + §5.3) — category + channel filtering
// ---------------------------------------------------------------------------

export type NotificationCategory =
  | "messages"
  | "appointment_reminders"
  | "payment_reminders"
  | "case_updates";

export interface NotificationPreferences {
  messages: boolean;
  appointment_reminders: boolean;
  payment_reminders: boolean;
  case_updates: boolean;
  channels: { inapp: boolean; push: boolean; email: boolean };
}

/** All-true defaults (the row may not exist yet — defaults match the column defaults). */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  messages: true,
  appointment_reminders: true,
  payment_reminders: true,
  case_updates: true,
  channels: { inapp: true, push: true, email: true },
};

/**
 * Returns the user's notification preferences, falling back to all-true
 * defaults when no row exists (DOC-47 §5.1 "defaults: todo true").
 */
export async function getPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("notification_preferences")
    .select("messages, appointment_reminders, payment_reminders, case_updates, channels")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return DEFAULT_PREFERENCES;

  const ch = (data.channels ?? {}) as Record<string, unknown>;
  return {
    messages: data.messages,
    appointment_reminders: data.appointment_reminders,
    payment_reminders: data.payment_reminders,
    case_updates: data.case_updates,
    channels: {
      inapp: ch.inapp !== false,
      push: ch.push !== false,
      email: ch.email !== false,
    },
  };
}

/**
 * Upserts the user's notification preferences (no retroactive effect — DOC-47 §5.3).
 * Runs as the authenticated user so the `notification_preferences` RLS (owner-only)
 * applies; falls back to service client only for the dispatcher path is NOT needed here.
 */
export async function upsertPreferences(
  userId: string,
  prefs: NotificationPreferences,
): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("notification_preferences")
    .upsert(
      {
        user_id: userId,
        messages: prefs.messages,
        appointment_reminders: prefs.appointment_reminders,
        payment_reminders: prefs.payment_reminders,
        case_updates: prefs.case_updates,
        channels: prefs.channels as unknown as import("@/shared/database.types").Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) {
    throw new Error(
      `notifications.repository: upsertPreferences failed — ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Unread count + mark all read (badge / center — DOC-47 §5.3)
// ---------------------------------------------------------------------------

export async function getUnreadCountForUser(userId: string): Promise<number> {
  const supabase = await createServerClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) {
    throw new Error(
      `notifications.repository: getUnreadCountForUser failed — ${error.message}`,
    );
  }
  return count ?? 0;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) {
    throw new Error(
      `notifications.repository: markAllNotificationsRead failed — ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Anti-burst digest (DOC-47 §4.2 / §5.2) — message.received grouping
// ---------------------------------------------------------------------------

/**
 * Finds the most recent UNREAD `message.received` notification for a user scoped
 * to a conversation (via its stable per-user action_url). Used to bump a digest
 * ("N mensajes nuevos…") instead of inserting a new row within the 5-min window.
 */
export async function findUnreadMessageDigest(
  userId: string,
  actionUrl: string,
): Promise<{ id: string; created_at: string; body_i18n: unknown } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, created_at, body_i18n")
    .eq("user_id", userId)
    .eq("type", "message.received")
    .eq("action_url", actionUrl)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

/**
 * Bumps an existing unread digest: replaces body with a bilingual "N nuevos
 * mensajes" counter and touches created_at so it re-sorts to the top. No push.
 */
export async function bumpMessageDigest(
  notificationId: string,
  userId: string,
  count: number,
  threadTitle: { es: string; en: string },
): Promise<void> {
  const supabase = createServiceClient();
  const body = {
    es: `${count} mensajes nuevos de ${threadTitle.es}`,
    en: `${count} new messages from ${threadTitle.en}`,
  };
  const { error } = await supabase
    .from("notifications")
    .update({
      body_i18n: body as unknown as import("@/shared/database.types").Json,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", notificationId)
    .eq("user_id", userId); // defense-in-depth: never bump another user's row

  if (error) {
    throw new Error(
      `notifications.repository: bumpMessageDigest failed — ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Push subscriptions (DOC-47 §5.3 + DOC-24) — Web Push VAPID
// ---------------------------------------------------------------------------

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Returns the user's push subscriptions (one per endpoint/device).
 * Service-role: the deliver-notification job runs outside a user session.
 */
export async function listPushSubscriptions(
  userId: string,
): Promise<PushSubscriptionRecord[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("push_subscriptions")
    .select("endpoint, keys")
    .eq("user_id", userId);

  if (!data) return [];
  return data.map((r) => ({
    endpoint: r.endpoint,
    keys: r.keys as unknown as { p256dh: string; auth: string },
  }));
}

/**
 * Upserts a push subscription by its UNIQUE endpoint (multi-device = 1 row per
 * endpoint). Service-role so a device handed between users is reassigned cleanly;
 * the caller passes the authenticated actor's userId.
 */
export async function upsertPushSubscription(input: {
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  platform: string;
}): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: input.userId,
        endpoint: input.endpoint,
        keys: input.keys as unknown as import("@/shared/database.types").Json,
        platform: input.platform,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );

  if (error) {
    throw new Error(
      `notifications.repository: upsertPushSubscription failed — ${error.message}`,
    );
  }
}

/** Removes a subscription by endpoint (stale-cleanup from the deliver job, 404/410). */
export async function deletePushSubscriptionByEndpoint(
  endpoint: string,
): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

/** Removes a subscription owned by the user (logout deassociates the device). */
export async function removePushSubscriptionForUser(
  userId: string,
  endpoint: string,
): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", endpoint);
}
