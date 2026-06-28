"use server";

/**
 * Diana — "Mi día" personal task actions (DOC-47 §3.9, DOC-48 API-KAN-08..12).
 *
 * Thin "use server" wrappers over the kanban module's staff-task use cases.
 * staff_tasks are strictly personal (RLS staff_id = auth.uid()); the module
 * enforces the owner guard. Boundary R1/R2: app → module-pub only.
 */

import { requireActor, AuthzError } from "@/backend/modules/identity";
import {
  createTask,
  updateTask,
  toggleTaskDone,
  deleteTask,
  KanbanError,
} from "@/backend/modules/kanban";

type Err = { ok: false; error: { code: string } };

function mapErr(err: unknown): Err {
  if (err instanceof AuthzError) return { ok: false, error: { code: err.reason } };
  if (err instanceof KanbanError) return { ok: false, error: { code: err.code } };
  console.error("[legal mi-dia action] unexpected:", (err as Error)?.message ?? String(err));
  return { ok: false, error: { code: "internal" } };
}

// API-KAN-08 — create a personal task
export async function createTaskAction(input: {
  text: string;
  tag?: string;
  caseId?: string;
}): Promise<{ ok: true; taskId: string } | Err> {
  try {
    const actor = await requireActor();
    const task = await createTask(actor, input);
    return { ok: true, taskId: task.id };
  } catch (err) {
    return mapErr(err);
  }
}

// API-KAN-09 — toggle done/undone. The module use case is a pure toggle (it
// flips the current server state), so the caller only needs the task id; the
// client tracks the resulting state optimistically.
export async function toggleTaskDoneAction(input: {
  taskId: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await toggleTaskDone(actor, input.taskId);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

// API-KAN-10 — edit text / tag
export async function updateTaskAction(input: {
  taskId: string;
  text?: string;
  tag?: string | null;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await updateTask(actor, input);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

// API-KAN-11 — delete a task
export async function deleteTaskAction(input: {
  taskId: string;
}): Promise<{ ok: boolean; error?: { code: string } }> {
  try {
    const actor = await requireActor();
    await deleteTask(actor, input.taskId);
    return { ok: true };
  } catch (err) {
    return mapErr(err);
  }
}

