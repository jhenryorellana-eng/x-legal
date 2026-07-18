"use server";

/**
 * ai-engine module — Lex case chat: server actions (module-pub boundary).
 *
 * Contract with the frontend (case workspace "Lex" tab) — these signatures are
 * STABLE: getLexThreadAction / sendLexMessageAction / getLexMessageStatusAction.
 *
 * Each action: requireActor() → delegate to lex-service (which enforces
 * requireCaseAccess + staff-only + thread ownership). Errors never propagate
 * raw to the client: sendLexMessageAction returns { ok: false, error } and the
 * polling reads degrade to an empty thread / null.
 */

import { requireActor } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import {
  getLexThread,
  sendLexMessage,
  getLexMessageStatus,
  LexError,
} from "./lex-service";
import type { LexThreadVM, LexMessageVM } from "./lex-domain";

/**
 * The staff member's Lex thread on a case (empty VM when never used).
 * Access/infra failures degrade to the empty thread (the tab renders the
 * composer regardless) — the send path is the one that reports errors.
 */
export async function getLexThreadAction(caseId: string): Promise<LexThreadVM> {
  try {
    const actor = await requireActor();
    return await getLexThread(actor, caseId);
  } catch (err) {
    logger.warn({ err, caseId }, "ai-engine: getLexThreadAction failed — returning empty thread");
    return { threadId: null, messages: [] };
  }
}

/**
 * Sends a staff question and enqueues the async answer (job lex-answer).
 * Returns { ok: false, error } on validation (LEX_MESSAGE_INVALID), concurrency
 * (LEX_BUSY) or authorization failures — never throws to the client.
 */
export async function sendLexMessageAction(
  caseId: string,
  content: string,
): Promise<{ ok: true; threadId: string; messageId: string } | { ok: false; error: string }> {
  try {
    const actor = await requireActor();
    const { threadId, messageId } = await sendLexMessage(actor, caseId, content);
    return { ok: true, threadId, messageId };
  } catch (err) {
    if (err instanceof LexError) return { ok: false, error: err.code };
    const message = err instanceof Error ? err.message : "INTERNAL_ERROR";
    logger.warn({ err, caseId }, "ai-engine: sendLexMessageAction failed");
    return { ok: false, error: message };
  }
}

/**
 * Polls one assistant message (running → completed/failed). Owner-only inside
 * the service; failures degrade to null (the UI keeps polling / stops on
 * refetch of the full thread).
 */
export async function getLexMessageStatusAction(messageId: string): Promise<LexMessageVM | null> {
  try {
    const actor = await requireActor();
    return await getLexMessageStatus(actor, messageId);
  } catch (err) {
    logger.warn({ err, messageId }, "ai-engine: getLexMessageStatusAction failed — returning null");
    return null;
  }
}
