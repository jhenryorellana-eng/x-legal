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

  // Check if already exists (interino dedupe while column-based dedupe is live)
  const { data: existing } = await supabase
    .from("notifications")
    .select("*")
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
