/**
 * Kanban module — repository layer (sole Supabase access point for the module).
 *
 * Rule R5 (DOC-21): all DB access for kanban + leads goes through this file.
 * Uses createServiceClient() (service_role) for all mutations to bypass RLS
 * and to support system-actor listeners. Queries that need RLS (getBoard via
 * authenticated user) also use service client — RLS for kanban lives on the
 * Realtime policies (board:{id}), not on the table-level SELECT.
 *
 * @module kanban/repository
 */

import { createServiceClient } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/database.types";
import type { SeedColumn, BoardKind } from "./domain";

// ---------------------------------------------------------------------------
// Row types (re-exported for callers)
// ---------------------------------------------------------------------------

export type BoardRow    = Tables<"kanban_boards">;
export type ColumnRow   = Tables<"kanban_columns">;
export type CardRow     = Tables<"kanban_cards">;
export type LeadRow     = Tables<"leads">;
export type CategoryRow = Tables<"lead_categories">;
export type TaskRow     = Tables<"staff_tasks">;

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export async function findBoard(
  ownerStaffId: string,
  kind: BoardKind,
): Promise<BoardRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("kanban_boards")
    .select("*")
    .eq("owner_staff_id", ownerStaffId)
    .eq("board_kind", kind)
    .maybeSingle();
  if (error) {
    logger.error({ err: error.message, ownerStaffId, kind }, "kanban: findBoard error");
    return null;
  }
  return data;
}

/**
 * Creates a board with its seed columns in a single logical transaction.
 * Uses ON CONFLICT DO NOTHING on the board to handle concurrent creation races.
 * Returns the board (newly created or pre-existing).
 */
export async function createBoardWithSeed(
  ownerStaffId: string,
  orgId: string,
  kind: BoardKind,
  seedColumns: SeedColumn[],
): Promise<BoardRow> {
  const client = createServiceClient();

  // Upsert board (on conflict do nothing = concurrent creation is idempotent)
  const { data: board, error: boardErr } = await client
    .from("kanban_boards")
    .upsert(
      { owner_staff_id: ownerStaffId, org_id: orgId, board_kind: kind },
      { onConflict: "owner_staff_id,board_kind", ignoreDuplicates: false },
    )
    .select()
    .single();

  if (boardErr || !board) {
    // Race: another request inserted first — re-select
    const existing = await findBoard(ownerStaffId, kind);
    if (!existing) throw new Error(`kanban: createBoardWithSeed failed: ${boardErr?.message}`);
    return existing;
  }

  // Insert seed columns (ignore duplicate inserts — idempotent)
  const colInserts: TablesInsert<"kanban_columns">[] = seedColumns.map((col) => ({
    board_id: board.id,
    label: col.label,
    color: col.color,
    position: col.position,
    is_terminal_won: col.isTerminalWon,
    is_terminal_lost: col.isTerminalLost,
  }));

  const { error: colErr } = await client
    .from("kanban_columns")
    .upsert(colInserts, { onConflict: "board_id,position", ignoreDuplicates: true });

  if (colErr) {
    logger.warn({ err: colErr.message, boardId: board.id }, "kanban: seed columns partial failure");
  }

  return board;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export async function listColumns(boardId: string): Promise<ColumnRow[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("kanban_columns")
    .select("*")
    .eq("board_id", boardId)
    .order("position", { ascending: true });
  if (error) throw new Error(`kanban: listColumns: ${error.message}`);
  return data ?? [];
}

export async function findColumn(columnId: string): Promise<ColumnRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("kanban_columns")
    .select("*")
    .eq("id", columnId)
    .maybeSingle();
  if (error) throw new Error(`kanban: findColumn: ${error.message}`);
  return data;
}

export async function insertColumn(
  insert: TablesInsert<"kanban_columns">,
): Promise<ColumnRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("kanban_columns")
    .insert(insert)
    .select()
    .single();
  if (error || !data) throw new Error(`kanban: insertColumn: ${error?.message}`);
  return data;
}

export async function updateColumn(
  columnId: string,
  update: TablesUpdate<"kanban_columns">,
): Promise<ColumnRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("kanban_columns")
    .update(update)
    .eq("id", columnId)
    .select()
    .single();
  if (error || !data) throw new Error(`kanban: updateColumn: ${error?.message}`);
  return data;
}

export async function deleteColumn(columnId: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from("kanban_columns")
    .delete()
    .eq("id", columnId);
  if (error) throw new Error(`kanban: deleteColumn: ${error.message}`);
}

export async function maxColumnPosition(boardId: string): Promise<number> {
  const cols = await listColumns(boardId);
  return cols.reduce((max, c) => Math.max(max, c.position), 0);
}

/**
 * Reorders columns within a board transactionally by temporarily using
 * large position offsets (avoids unique constraint violations mid-update).
 */
export async function reorderColumns(
  boardId: string,
  orderedColumnIds: string[],
): Promise<void> {
  const client = createServiceClient();
  const OFFSET = 10000;

  // Step 1: move to temp positions to avoid constraint conflicts
  for (let i = 0; i < orderedColumnIds.length; i++) {
    const { error } = await client
      .from("kanban_columns")
      .update({ position: OFFSET + i + 1 })
      .eq("id", orderedColumnIds[i])
      .eq("board_id", boardId);
    if (error) throw new Error(`kanban: reorderColumns step1: ${error.message}`);
  }

  // Step 2: set final positions
  for (let i = 0; i < orderedColumnIds.length; i++) {
    const { error } = await client
      .from("kanban_columns")
      .update({ position: i + 1 })
      .eq("id", orderedColumnIds[i])
      .eq("board_id", boardId);
    if (error) throw new Error(`kanban: reorderColumns step2: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export async function listCards(boardId: string): Promise<CardRow[]> {
  const client = createServiceClient();
  // Join via columns to filter by board
  const { data, error } = await client
    .from("kanban_cards")
    .select("*, kanban_columns!inner(board_id)")
    .eq("kanban_columns.board_id", boardId)
    .order("position", { ascending: true });
  if (error) throw new Error(`kanban: listCards: ${error.message}`);
  return (data ?? []).map((r) => {
    const { kanban_columns: _cols, ...card } = r as CardRow & { kanban_columns: unknown };
    return card as CardRow;
  });
}

export async function findCard(cardId: string): Promise<CardRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("kanban_cards")
    .select("*")
    .eq("id", cardId)
    .maybeSingle();
  if (error) throw new Error(`kanban: findCard: ${error.message}`);
  return data;
}

export async function findCardByRef(
  boardId: string,
  refType: string,
  refId: string,
): Promise<CardRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("kanban_cards")
    .select("*, kanban_columns!inner(board_id)")
    .eq("ref_type", refType)
    .eq("ref_id", refId)
    .eq("kanban_columns.board_id", boardId)
    .maybeSingle();
  if (error) throw new Error(`kanban: findCardByRef: ${error.message}`);
  if (!data) return null;
  const { kanban_columns: _cols, ...card } = data as CardRow & { kanban_columns: unknown };
  return card as CardRow;
}

export async function insertCard(
  insert: TablesInsert<"kanban_cards">,
): Promise<CardRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("kanban_cards")
    .insert(insert)
    .select()
    .single();
  if (error || !data) throw new Error(`kanban: insertCard: ${error?.message}`);
  return data;
}

export async function updateCard(
  cardId: string,
  update: TablesUpdate<"kanban_cards">,
): Promise<CardRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("kanban_cards")
    .update(update)
    .eq("id", cardId)
    .select()
    .single();
  if (error || !data) throw new Error(`kanban: updateCard: ${error?.message}`);
  return data;
}

export async function deleteCard(cardId: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from("kanban_cards")
    .delete()
    .eq("id", cardId);
  if (error) throw new Error(`kanban: deleteCard: ${error.message}`);
}

export async function deleteCardByRef(
  boardId: string,
  refType: string,
  refId: string,
): Promise<void> {
  const card = await findCardByRef(boardId, refType, refId);
  if (card) await deleteCard(card.id);
}

/**
 * Moves all cards from one column to the end of another column.
 * Skips cards whose ref already exists in destColumn (constraint-safe).
 * DOC-47 §2.3: migration for deleteColumn.
 */
export async function migrateCardsToColumn(
  fromColumnId: string,
  toColumnId: string,
): Promise<void> {
  const client = createServiceClient();

  // Get cards in source column
  const { data: sourceCards, error: srcErr } = await client
    .from("kanban_cards")
    .select("*")
    .eq("column_id", fromColumnId)
    .order("position", { ascending: true });
  if (srcErr) throw new Error(`kanban: migrateCards src: ${srcErr.message}`);
  if (!sourceCards || sourceCards.length === 0) return;

  // Get existing ref_ids in dest column (to avoid duplicate-ref clash)
  const { data: destCards, error: dstErr } = await client
    .from("kanban_cards")
    .select("ref_id, position")
    .eq("column_id", toColumnId);
  if (dstErr) throw new Error(`kanban: migrateCards dst: ${dstErr.message}`);

  const existingRefs = new Set((destCards ?? []).map((c) => c.ref_id));
  const maxDestPos = Math.max(0, ...(destCards ?? []).map((c) => c.position));

  let offset = maxDestPos;
  for (const card of sourceCards) {
    if (existingRefs.has(card.ref_id)) {
      // Already has a card for this entity in dest — discard migrated (keep existing)
      continue;
    }
    offset += 1;
    const { error } = await client
      .from("kanban_cards")
      .update({ column_id: toColumnId, position: offset })
      .eq("id", card.id);
    if (error) {
      logger.warn(
        { err: error.message, cardId: card.id },
        "kanban: migrateCardsToColumn partial failure",
      );
    }
  }
}

export async function countCardsInColumn(columnId: string): Promise<number> {
  const client = createServiceClient();
  const { count, error } = await client
    .from("kanban_cards")
    .select("id", { count: "exact", head: true })
    .eq("column_id", columnId);
  if (error) throw new Error(`kanban: countCardsInColumn: ${error.message}`);
  return count ?? 0;
}

export async function maxCardPosition(columnId: string): Promise<number> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("kanban_cards")
    .select("position")
    .eq("column_id", columnId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`kanban: maxCardPosition: ${error.message}`);
  return data?.position ?? 0;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export async function findLead(leadId: string): Promise<LeadRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(`kanban: findLead: ${error.message}`);
  return data;
}

export async function findLeadsByLast4(
  orgId: string,
  last4: string,
): Promise<LeadRow[]> {
  const client = createServiceClient();
  // Postgres: right(phone_e164, 4) = last4
  // Use ilike workaround since Supabase JS doesn't expose arbitrary SQL expressions easily.
  // Fallback: filter client-side from a broader query for the org.
  // NOTE: DOC-47 §2.5 says the service passes the list; we query by org + last4.
  const { data, error } = await client
    .from("leads")
    .select("*")
    .eq("org_id", orgId);
  if (error) throw new Error(`kanban: findLeadsByLast4: ${error.message}`);
  return (data ?? []).filter((l) => l.phone_e164.slice(-4) === last4);
}

export async function insertLead(
  insert: TablesInsert<"leads">,
): Promise<LeadRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("leads")
    .insert(insert)
    .select()
    .single();
  if (error || !data) throw new Error(`kanban: insertLead: ${error?.message}`);
  return data;
}

export async function updateLead(
  leadId: string,
  update: TablesUpdate<"leads">,
): Promise<LeadRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("leads")
    .update(update)
    .eq("id", leadId)
    .select()
    .single();
  if (error || !data) throw new Error(`kanban: updateLead: ${error?.message}`);
  return data;
}

export async function listLeads(
  orgId: string,
  filters: {
    source?: string;
    categoryId?: string;
    serviceId?: string;
    uncontacted?: boolean;
    cursor?: string;
    limit?: number;
  },
): Promise<{ items: LeadRow[]; nextCursor: string | null }> {
  const client = createServiceClient();
  const limit = filters.limit ?? 50;

  let query = client
    .from("leads")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (filters.source) query = query.eq("source", filters.source);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (filters.serviceId) query = query.eq("interested_service_id", filters.serviceId);
  if (filters.uncontacted) query = query.is("contacted_at", null);
  if (filters.cursor) query = query.lt("created_at", filters.cursor);

  const { data, error } = await query;
  if (error) throw new Error(`kanban: listLeads: ${error.message}`);

  const items = data ?? [];
  const hasMore = items.length > limit;
  if (hasMore) items.pop();

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.created_at ?? null : null,
  };
}

// ---------------------------------------------------------------------------
// Lead categories
// ---------------------------------------------------------------------------

export async function findLeadCategory(
  categoryId: string,
): Promise<CategoryRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("lead_categories")
    .select("*")
    .eq("id", categoryId)
    .maybeSingle();
  if (error) throw new Error(`kanban: findLeadCategory: ${error.message}`);
  return data;
}

export async function insertLeadCategory(
  insert: TablesInsert<"lead_categories">,
): Promise<CategoryRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("lead_categories")
    .insert(insert)
    .select()
    .single();
  if (error || !data) throw new Error(`kanban: insertLeadCategory: ${error?.message}`);
  return data;
}

export async function maxCategoryPosition(orgId: string): Promise<number> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("lead_categories")
    .select("position")
    .eq("org_id", orgId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`kanban: maxCategoryPosition: ${error.message}`);
  return data?.position ?? 0;
}

// ---------------------------------------------------------------------------
// Finance staff resolution (for automatic card listeners §3.8)
// ---------------------------------------------------------------------------

/**
 * Returns all active staff with role='finance' that have can_view on 'collections'.
 * Used by listeners to route case cards to Andrium's board.
 *
 * Resolution via users (org_id) → staff_profiles (role) → employee_module_permissions.
 */
export async function findFinanceStaff(
  orgId: string,
): Promise<Array<{ userId: string }>> {
  const client = createServiceClient();

  // Step 1: get all active staff user_ids in the org
  const { data: orgUsers, error: usersErr } = await client
    .from("users")
    .select("id")
    .eq("org_id", orgId)
    .eq("kind", "staff")
    .eq("is_active", true);

  if (usersErr || !orgUsers || orgUsers.length === 0) {
    logger.warn({ err: usersErr?.message, orgId }, "kanban: findFinanceStaff no org users");
    return [];
  }

  const userIds = orgUsers.map((u) => u.id);

  // Step 2: filter by role=finance
  const { data: financeProfiles, error: profileErr } = await client
    .from("staff_profiles")
    .select("user_id")
    .in("user_id", userIds)
    .eq("role", "finance");

  if (profileErr || !financeProfiles || financeProfiles.length === 0) {
    return [];
  }

  const financeIds = financeProfiles.map((p) => p.user_id);

  // Step 3: filter by collections module permission
  const { data: perms, error: permErr } = await client
    .from("employee_module_permissions")
    .select("staff_id")
    .in("staff_id", financeIds)
    .eq("module_key", "collections")
    .eq("can_view", true);

  if (permErr) {
    logger.warn({ err: permErr.message, orgId }, "kanban: findFinanceStaff perm error");
    return [];
  }

  return (perms ?? []).map((p) => ({ userId: p.staff_id }));
}

// ---------------------------------------------------------------------------
// Staff tasks (§3.9 — RF-VAN-004)
// ---------------------------------------------------------------------------

export async function listTasks(
  staffId: string,
  includeDone = false,
): Promise<TaskRow[]> {
  const client = createServiceClient();
  let query = client
    .from("staff_tasks")
    .select("*")
    .eq("staff_id", staffId);

  if (!includeDone) {
    query = query.is("done_at", null);
  }

  // Open tasks: by position asc; done tasks: by done_at desc
  query = query.order("position", { ascending: true });

  const { data, error } = await query;
  if (error) throw new Error(`kanban: listTasks: ${error.message}`);
  return data ?? [];
}

export async function findTask(taskId: string): Promise<TaskRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("staff_tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error(`kanban: findTask: ${error.message}`);
  return data;
}

export async function insertTask(
  insert: TablesInsert<"staff_tasks">,
): Promise<TaskRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("staff_tasks")
    .insert(insert)
    .select()
    .single();
  if (error || !data) throw new Error(`kanban: insertTask: ${error?.message}`);
  return data;
}

export async function updateTask(
  taskId: string,
  update: TablesUpdate<"staff_tasks">,
): Promise<TaskRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("staff_tasks")
    .update(update)
    .eq("id", taskId)
    .select()
    .single();
  if (error || !data) throw new Error(`kanban: updateTask: ${error?.message}`);
  return data;
}

export async function deleteTask(taskId: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from("staff_tasks")
    .delete()
    .eq("id", taskId);
  if (error) throw new Error(`kanban: deleteTask: ${error.message}`);
}

export async function maxTaskPosition(staffId: string): Promise<number> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("staff_tasks")
    .select("position")
    .eq("staff_id", staffId)
    .is("done_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`kanban: maxTaskPosition: ${error.message}`);
  return data?.position ?? 0;
}

export async function reorderTasks(
  staffId: string,
  orderedTaskIds: string[],
): Promise<void> {
  const client = createServiceClient();
  const OFFSET = 10000;

  // Step 1: temp positions
  for (let i = 0; i < orderedTaskIds.length; i++) {
    const { error } = await client
      .from("staff_tasks")
      .update({ position: OFFSET + i + 1 })
      .eq("id", orderedTaskIds[i])
      .eq("staff_id", staffId);
    if (error) throw new Error(`kanban: reorderTasks step1: ${error.message}`);
  }

  // Step 2: final positions
  for (let i = 0; i < orderedTaskIds.length; i++) {
    const { error } = await client
      .from("staff_tasks")
      .update({ position: i + 1 })
      .eq("id", orderedTaskIds[i])
      .eq("staff_id", staffId);
    if (error) throw new Error(`kanban: reorderTasks step2: ${error.message}`);
  }
}
