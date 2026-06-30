/**
 * Exhibits module — use cases.
 *
 * Two entry points:
 *   captureFromRun       — runs on `generation.completed`: reads the run's research
 *                          bundle + the letter's curated/dataset sources, normalizes
 *                          + dedups them, and fans out one `fetch-exhibit` job each.
 *   executeFetchExhibitJob — the QStash job: idempotently downloads/renders ONE source
 *                          to PDF, stores it, and marks the exhibit ready (or failed).
 *
 * @module exhibits/service
 */

import { createHash } from "node:crypto";
import { enqueueJob } from "@/backend/platform/qstash";
import { logger } from "@/backend/platform/logger";
import { can } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import {
  uploadBytesToStorage,
  downloadBytesFromStorage,
  createSignedUploadUrl,
  validateUploadedObject,
} from "@/backend/platform/storage";
import { countPdfPages, extractPdfText, htmlToPdf } from "@/backend/platform/pdf";
import { getRenderer } from "@/backend/platform/renderer";
import { safeFetch, NonRetryableFetchError, RetryableFetchError } from "@/backend/platform/safe-fetch";
import { SsrfError } from "@/backend/platform/ssrf";
import {
  normalizeAndDedup,
  selectExhibitsToAttach,
  isErrorPageText,
  buildExhibitIndexHtml,
  type RawSource,
  type ExhibitSourceKind,
  type FetchMethod,
} from "./domain";
import * as repo from "./repository";
import { emitExhibitsRunSettled } from "./events";

const EXHIBITS_BUCKET = "expedientes";
const FETCH_RETRIES = 2; // QStash retries → up to 3 deliveries
const MAX_ATTEMPTS = 3; // the handler marks 'failed' on the last delivery (2xx, no DLQ)

export class ExhibitsError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "ExhibitsError";
  }
}

export type ExhibitJobOutcome = "completed" | "failed" | "skipped";

// ---------------------------------------------------------------------------
// Capture (generation.completed consumer)
// ---------------------------------------------------------------------------

interface ResearchBundle {
  jurisprudence?: Array<Record<string, unknown>>;
  country_conditions?: Array<Record<string, unknown>>;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Builds the ordered RawSource list from the run's research bundle + config sources.
 *  Order mirrors the memo's "Index of Exhibits": Exhibit A (jurisprudence) then
 *  Exhibit B (country conditions), then admin-curated, then dataset. */
function collectSources(
  research: ResearchBundle,
  config: repo.AttachConfig,
  datasetItems: Array<{ title: string; url: string; publishedDate: string | null }>,
): RawSource[] {
  const sources: RawSource[] = [];
  let order = 0;

  const jur = research.jurisprudence ?? [];
  jur.forEach((j, i) => {
    const url = str(j.url);
    if (!url) return; // jurisprudence keeps its citation even with a dead URL, but only a live URL is attachable
    sources.push({
      url,
      title: str(j.name),
      publisher: str(j.court) ?? str(j.citation),
      publishedDate: str(j.year),
      supports: str(j.factual_analogy) ?? str(j.holding),
      kind: "jurisprudence",
      citeOrder: order++,
      exhibitLabel: `A-${i + 1}`,
    });
  });

  const cc = research.country_conditions ?? [];
  cc.forEach((c, i) => {
    const url = str(c.url);
    if (!url) return;
    sources.push({
      url,
      title: str(c.title) ?? str(c.source_name),
      publisher: str(c.author) ?? str(c.source_name),
      publishedDate: str(c.published_date),
      supports: str(c.why_it_helps) ?? str(c.summary),
      kind: "country_condition",
      citeOrder: order++,
      exhibitLabel: `B-${i + 1}`,
    });
  });

  config.curatedSources.forEach((s, i) => {
    const url = str(s.url);
    if (!url) return;
    sources.push({
      url,
      title: str(s.title),
      publisher: str(s.category),
      publishedDate: null,
      supports: null,
      kind: "admin_curated",
      citeOrder: order++,
      exhibitLabel: `C-${i + 1}`,
    });
  });

  datasetItems.forEach((d, i) => {
    sources.push({
      url: d.url,
      title: str(d.title),
      publisher: null,
      publishedDate: d.publishedDate,
      supports: null,
      kind: "dataset",
      citeOrder: order++,
      exhibitLabel: `D-${i + 1}`,
    });
  });

  return sources;
}

export interface CaptureResult {
  captured: number;
  enqueued: number;
  skipped: boolean;
}

/**
 * Captures the cited sources of a completed generation run as exhibits and fans out
 * the fetch jobs. Idempotent: re-delivery upserts on (run_id,url_hash) and only
 * (re)enqueues still-pending exhibits.
 */
export async function captureFromRun(input: { runId: string }): Promise<CaptureResult> {
  const run = await repo.getRunForCapture(input.runId);
  if (!run) return { captured: 0, enqueued: 0, skipped: true };

  const config = await repo.getAttachConfig(run.formDefinitionId);
  if (!config || !config.enabled) return { captured: 0, enqueued: 0, skipped: true };

  const research = (run.configSnapshot.research ?? {}) as ResearchBundle;
  const datasetItems =
    config.kinds.includes("dataset") && config.datasetId
      ? await repo.getDatasetUrlItems(config.datasetId)
      : [];

  const sources = collectSources(research, config, datasetItems);
  const normalized = normalizeAndDedup(sources);
  const selected = selectExhibitsToAttach(normalized, {
    enabledKinds: config.kinds as ExhibitSourceKind[],
    maxExhibits: null,
  });

  await repo.insertExhibits(
    selected.map((s) => ({
      caseId: run.caseId,
      runId: run.id,
      sourceKind: s.kind,
      citeOrder: s.citeOrder,
      exhibitLabel: s.exhibitLabel,
      sourceUrl: s.url,
      canonicalUrl: s.canonicalUrl,
      urlHash: s.urlHash,
      title: s.title,
      publisher: s.publisher,
      publishedDate: s.publishedDate,
      supports: s.supports,
    })),
  );

  const orgId = await repo.getCaseOrgId(run.caseId);
  const pending = await repo.listPendingByRun(run.id);
  let enqueued = 0;
  for (const ex of pending) {
    await enqueueJob(
      {
        jobKey: "fetch-exhibit",
        entityId: ex.id,
        attempt: 1,
        dedupeId: `fetch-exhibit:${ex.id}:a1`,
        exhibitId: ex.id,
        ...(orgId ? { orgId } : {}),
      },
      { retries: FETCH_RETRIES },
    );
    enqueued++;
  }

  logger.info(
    { runId: run.id, caseId: run.caseId, captured: selected.length, enqueued },
    "exhibits: captured from run",
  );
  return { captured: selected.length, enqueued, skipped: false };
}

// ---------------------------------------------------------------------------
// Fetch pipeline (fetch-exhibit job)
// ---------------------------------------------------------------------------

const PDF_MAGIC = "%PDF";

function isPdfBytes(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 4)).toString("latin1") === PDF_MAGIC;
}

/** Latest Wayback Machine snapshot URL for a dead/blocked source, or null. */
async function waybackLatest(url: string): Promise<string | null> {
  try {
    const r = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json().catch(() => null)) as
      | { archived_snapshots?: { closest?: { available?: boolean; url?: string } } }
      | null;
    const snap = j?.archived_snapshots?.closest;
    return snap?.available && snap.url ? snap.url : null;
  } catch {
    return null;
  }
}

/** Primary acquisition: a direct PDF is used as-is; anything else (HTML/image) is
 *  rendered by the managed Renderer. Throws typed errors on bad HTTP status. */
async function acquirePrimary(url: string): Promise<{ pdf: Uint8Array; method: FetchMethod }> {
  const res = await safeFetch(url);
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    // 4xx (paywall/404/block) won't fix on retry → permanent (caller tries Wayback);
    // 5xx is transient → retry.
    if (res.status >= 400 && res.status < 500) throw new NonRetryableFetchError(`HTTP ${res.status}`);
    throw new RetryableFetchError(`HTTP ${res.status}`);
  }
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/pdf")) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!isPdfBytes(bytes)) throw new RetryableFetchError("declared PDF but bytes are not %PDF");
    return { pdf: bytes, method: "pdf" };
  }
  res.body?.cancel().catch(() => {});
  const pdf = await getRenderer().render(url);
  if (!isPdfBytes(pdf)) throw new RetryableFetchError("renderer did not return a PDF");
  return { pdf, method: "render" };
}

/** Best-effort: does the rendered PDF look like a bot-block / error page (a valid
 *  PDF whose content is a 403/"forbidden"/Cloudflare interstitial, not the source)?
 *  Extraction failures never block — they return false. */
async function looksLikeErrorPage(pdf: Uint8Array): Promise<boolean> {
  try {
    const [text, pages] = await Promise.all([extractPdfText(pdf), countPdfPages(pdf)]);
    return isErrorPageText(text, pages);
  } catch {
    return false;
  }
}

/**
 * Acquires a source to PDF with resilience: per-domain circuit breaker (skip a
 * domain that's failing en masse), SSRF-guarded fetch, bot-block/error-page
 * detection, and a Wayback Machine fallback for dead/blocked links. `finalUrl`
 * reflects the effective source (a Wayback snapshot when used) for provenance.
 */
async function acquire(canonicalUrl: string): Promise<{ pdf: Uint8Array; method: FetchMethod; finalUrl: string }> {
  const domain = new URL(canonicalUrl).hostname;
  if (await repo.isCircuitOpen(domain)) throw new RetryableFetchError(`circuit open: ${domain}`);

  try {
    const out = await acquirePrimary(canonicalUrl);
    // A rendered page can be a bot-block/error page that is STILL a valid PDF (e.g.
    // State Dept 403). Reject it so the Wayback fallback runs instead of filing garbage.
    if (out.method === "render" && (await looksLikeErrorPage(out.pdf))) {
      throw new NonRetryableFetchError("rendered page looks like a bot-block/error page");
    }
    await repo.recordDomainSuccess(domain);
    return { ...out, finalUrl: canonicalUrl };
  } catch (err) {
    await repo.recordDomainFailure(domain);
    const snap = await waybackLatest(canonicalUrl);
    if (snap) {
      try {
        const pdf = await getRenderer().render(snap);
        if (isPdfBytes(pdf) && !(await looksLikeErrorPage(pdf))) {
          return { pdf, method: "archive", finalUrl: snap };
        }
      } catch {
        /* snapshot render failed → rethrow the original error below */
      }
    }
    throw err;
  }
}

async function settleCheck(runId: string, caseId: string, orgId: string | null): Promise<void> {
  const unsettled = await repo.countUnsettledByRun(runId);
  if (unsettled > 0) return;
  const all = await repo.listByRun(runId);
  const ready = all.filter((e) => e.status === "ready" || e.status === "manual").length;
  const failed = all.filter((e) => e.status === "failed").length;
  emitExhibitsRunSettled({ runId, caseId, orgId: orgId ?? "", ready, failed });
}

/**
 * Fetches ONE exhibit. Idempotent: a re-delivery after 'ready' is a no-op. On a
 * permanent error (SSRF / unsupported) or after MAX_ATTEMPTS, marks 'failed' (2xx,
 * no retry); on a transient error before the cap, rethrows so QStash retries.
 */
export async function executeFetchExhibitJob(input: { exhibitId: string }): Promise<ExhibitJobOutcome> {
  const claimed = await repo.claimExhibit(input.exhibitId);
  if (!claimed) return "skipped"; // already ready/manual, or won by another delivery

  const orgId = await repo.getCaseOrgId(claimed.case_id);
  const path = `exhibits/${claimed.case_id}/${claimed.url_hash}.pdf`;

  try {
    // Content cache: the SAME source already fetched for another case → copy the
    // bytes (skip the expensive render/download), keeping per-case storage isolation.
    const reusable = await repo.findReusableByUrlHash(claimed.url_hash, claimed.id);
    if (reusable?.pdf_path) {
      const bytes = await downloadBytesFromStorage(EXHIBITS_BUCKET, reusable.pdf_path);
      await uploadBytesToStorage(EXHIBITS_BUCKET, path, bytes, "application/pdf");
      await repo.markReady(input.exhibitId, {
        pdfPath: path,
        contentSha256: reusable.content_sha256 ?? createHash("sha256").update(bytes).digest("hex"),
        pageCount: reusable.page_count ?? (await countPdfPages(bytes)),
        fetchMethod: (reusable.fetch_method as FetchMethod) ?? "pdf",
        finalUrl: reusable.final_url ?? claimed.canonical_url,
      });
      await settleCheck(claimed.run_id, claimed.case_id, orgId);
      logger.info({ exhibitId: input.exhibitId, reusedFrom: reusable.id }, "exhibits: fetch ready (cache reuse)");
      return "completed";
    }

    const acquired = await acquire(claimed.canonical_url);
    const contentSha256 = createHash("sha256").update(acquired.pdf).digest("hex");
    await uploadBytesToStorage(EXHIBITS_BUCKET, path, acquired.pdf, "application/pdf");
    const pageCount = await countPdfPages(acquired.pdf);

    await repo.markReady(input.exhibitId, {
      pdfPath: path,
      contentSha256,
      pageCount,
      fetchMethod: acquired.method,
      finalUrl: acquired.finalUrl,
    });
    await settleCheck(claimed.run_id, claimed.case_id, orgId);
    logger.info(
      { exhibitId: input.exhibitId, method: acquired.method, pages: pageCount },
      "exhibits: fetch ready",
    );
    return "completed";
  } catch (err) {
    const permanent = err instanceof SsrfError || err instanceof NonRetryableFetchError;
    const attempts = claimed.attempts ?? 0; // already includes this delivery (claim bumped it)
    if (permanent || attempts >= MAX_ATTEMPTS) {
      const msg = err instanceof Error ? err.message : String(err);
      await repo.markFailed(input.exhibitId, msg);
      await settleCheck(claimed.run_id, claimed.case_id, orgId);
      logger.warn({ exhibitId: input.exhibitId, err: msg, permanent }, "exhibits: fetch failed (terminal)");
      return "failed";
    }
    throw err; // transient → QStash retries (re-claims 'fetching' on next delivery)
  }
}

// ---------------------------------------------------------------------------
// Diana panel — read + retry + manual upload (staff, gated by 'expedientes')
// ---------------------------------------------------------------------------

/** All exhibits of a case with status — feeds Diana's panel in the ensamblador. */
export async function getExhibitsForCase(actor: Actor, caseId: string): Promise<repo.CaseExhibitRow[]> {
  can(actor, "expedientes", "view");
  return repo.listAllByCase(caseId);
}

/**
 * Renders the formal "Index of Exhibits" divider page (Tab · Source · Date · Supports)
 * for the given exhibit ids, in cite order. Consumed by the expediente compile, which
 * splices it as a synthetic item right before the exhibits (so it always reflects the
 * exhibits actually filed). No actor gate — called by the compile (service-role).
 */
export async function renderExhibitIndexForExhibits(exhibitIds: string[]): Promise<Uint8Array> {
  const rows = await repo.listByIds(exhibitIds);
  return htmlToPdf(
    buildExhibitIndexHtml(
      rows.map((e) => ({
        label: e.exhibit_label,
        source: e.publisher ?? e.title ?? "Source",
        date: e.published_date,
        supports: e.supports,
      })),
    ),
  );
}

/** Re-queues a failed exhibit (Diana "Reintentar"). */
export async function retryExhibit(actor: Actor, exhibitId: string): Promise<void> {
  can(actor, "expedientes", "edit");
  const ex = await repo.getExhibitById(exhibitId);
  if (!ex) throw new ExhibitsError("EXHIBIT_NOT_FOUND");
  await repo.resetToPending(exhibitId);
  const orgId = await repo.getCaseOrgId(ex.case_id);
  await enqueueJob(
    {
      jobKey: "fetch-exhibit",
      entityId: exhibitId,
      attempt: (ex.attempts ?? 0) + 1,
      dedupeId: `fetch-exhibit:${exhibitId}:retry-${(ex.attempts ?? 0) + 1}`,
      exhibitId,
      ...(orgId ? { orgId } : {}),
    },
    { retries: FETCH_RETRIES },
  );
}

/** Step 1 of manual upload: a signed URL to PUT a hand-picked PDF for a failed exhibit. */
export async function createExhibitUploadUrl(
  actor: Actor,
  exhibitId: string,
): Promise<{ signedUrl: string; path: string }> {
  can(actor, "expedientes", "edit");
  const ex = await repo.getExhibitById(exhibitId);
  if (!ex) throw new ExhibitsError("EXHIBIT_NOT_FOUND");
  const path = `exhibits/${ex.case_id}/manual-${exhibitId}.pdf`;
  return createSignedUploadUrl(EXHIBITS_BUCKET, path);
}

/** Step 2: validate the uploaded PDF and mark the exhibit 'manual'. */
export async function confirmManualExhibit(
  actor: Actor,
  input: { exhibitId: string; path: string },
): Promise<void> {
  can(actor, "expedientes", "edit");
  const ex = await repo.getExhibitById(input.exhibitId);
  if (!ex) throw new ExhibitsError("EXHIBIT_NOT_FOUND");
  const v = await validateUploadedObject(EXHIBITS_BUCKET, input.path, "expedientes");
  if (!v.ok || !v.bytes) throw new ExhibitsError("EXHIBIT_UPLOAD_INVALID", v.reason);
  const pageCount = await countPdfPages(new Uint8Array(v.bytes));
  await repo.setManual(input.exhibitId, { pdfPath: input.path, pageCount });
}

export { listReadyByCase, listByRun } from "./repository";
