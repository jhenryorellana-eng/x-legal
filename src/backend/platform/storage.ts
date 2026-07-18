/**
 * Storage helpers — DOC-27 §5 (private buckets, signed URLs, MIME validation).
 *
 * All buckets are private (0 public policies). Access is exclusively through
 * short-lived signed URLs:
 * - Upload: TTL 15 min (mobile uploads on slow networks)
 * - Download: TTL 5 min (minimizes exposure window)
 *
 * Server-side validation is MANDATORY before registering a file row (§5.1):
 * - Extension allowlist per bucket context
 * - File size ≤ UPLOAD_MAX_FILE_BYTES (RNF-016, single shared constant)
 */

import { UPLOAD_MAX_FILE_BYTES } from "@/shared/constants/uploads";

import { createServiceClient } from "./supabase";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default max file size (RNF-016). One source of truth for every surface —
 * see `src/shared/constants/uploads.ts`; the `case-documents` bucket
 * `file_size_limit` mirrors this value.
 */
export const MAX_FILE_SIZE_BYTES = UPLOAD_MAX_FILE_BYTES;

/** Signed URL TTL for downloads: 5 min (DOC-27 §5) */
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

// NOTE: DOC-27 §5 asks for a 15-min upload TTL, but Supabase fixes signed
// *upload* URL TTL at 2h (not configurable via createSignedUploadUrl).
// Mitigation: token is single-use and the path is confirmed server-side.

// ---------------------------------------------------------------------------
// MIME allowlists per bucket context (DOC-27 §5.1)
// ---------------------------------------------------------------------------

export type BucketContext =
  | "case-documents"
  | "expedientes"
  | "generated"
  | "contracts"
  | "payment-proofs"
  | "avatars"
  | "catalog-assets"
  | "chat-attachments";

const ALLOWED_EXTENSIONS: Record<BucketContext, string[]> = {
  "case-documents": ["pdf", "jpg", "jpeg", "png", "heic", "webp"],
  expedientes: ["pdf"],
  generated: ["pdf", "docx", "md"],
  contracts: ["pdf", "jpg", "jpeg", "png"],
  "payment-proofs": ["pdf", "jpg", "jpeg", "png", "webp"],
  avatars: ["jpg", "jpeg", "png", "webp"],
  "catalog-assets": ["pdf", "png", "jpg", "jpeg"],
  "chat-attachments": ["pdf", "jpg", "jpeg", "png", "heic", "webp"],
};

// Magic bytes for MIME type verification (§5.1)
// Map from extension to expected magic byte prefixes (hex)
const MAGIC_BYTES: Record<string, Buffer[]> = {
  pdf: [Buffer.from("255044462D", "hex")], // %PDF-
  jpg: [Buffer.from("FFD8FF", "hex")],
  jpeg: [Buffer.from("FFD8FF", "hex")],
  png: [Buffer.from("89504E47", "hex")],
  webp: [Buffer.from("52494646", "hex")], // RIFF
  heic: [
    Buffer.from("00000018", "hex"),
    Buffer.from("0000001C", "hex"),
    Buffer.from("00000020", "hex"),
  ],
  docx: [Buffer.from("504B0304", "hex")], // ZIP (OOXML)
  md: [], // plain text — no magic bytes; extension check sufficient
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface StorageValidationResult {
  ok: boolean;
  reason?: string;
  /**
   * The downloaded object bytes — present only on success of
   * `validateUploadedObject`. Returned so callers (e.g. the document quality
   * gate) can reuse them without downloading the object a second time.
   */
  bytes?: Buffer;
}

/**
 * Validates extension against the allowlist for the given bucket context.
 */
export function validateMime(
  filename: string,
  bucketContext: BucketContext,
): StorageValidationResult {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const allowed = ALLOWED_EXTENSIONS[bucketContext] ?? [];

  if (!allowed.includes(ext)) {
    return {
      ok: false,
      reason: `Extension ".${ext}" is not allowed in bucket "${bucketContext}". Allowed: ${allowed.join(", ")}`,
    };
  }

  return { ok: true };
}

/**
 * Validates magic bytes of a file buffer against the expected extension.
 * Returns { ok: true } for extensions with no magic bytes defined (e.g. .md).
 */
export function validateMagicBytes(
  filename: string,
  fileBuffer: Buffer,
): StorageValidationResult {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const signatures = MAGIC_BYTES[ext];

  if (!signatures || signatures.length === 0) {
    // No magic bytes defined for this extension — extension check is sufficient
    return { ok: true };
  }

  const matches = signatures.some((sig) =>
    fileBuffer.subarray(0, sig.length).equals(sig),
  );

  if (!matches) {
    return {
      ok: false,
      reason: `File "${filename}" magic bytes do not match the declared extension ".${ext}". Possible MIME type spoofing.`,
    };
  }

  return { ok: true };
}

/**
 * Validates file size against the shared upload limit (RNF-016).
 */
export function validateFileSize(
  sizeBytes: number,
  maxBytes: number = MAX_FILE_SIZE_BYTES,
): StorageValidationResult {
  if (sizeBytes > maxBytes) {
    const mb = (sizeBytes / 1024 / 1024).toFixed(2);
    const maxMb = (maxBytes / 1024 / 1024).toFixed(0);
    return {
      ok: false,
      reason: `File size ${mb} MB exceeds the maximum of ${maxMb} MB.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Signed URLs
// ---------------------------------------------------------------------------

/**
 * Creates a signed upload URL for a private bucket.
 *
 * The path is generated server-side (clients never control it — prevents path
 * traversal between cases, DOC-27 §5). After the upload, call
 * `validateUploadedObject()` before registering the file row.
 *
 * @param bucket - Supabase Storage bucket name
 * @param path - Server-generated storage path (e.g. `case/{caseId}/doc-123.pdf`)
 * @param opts - `upsert: true` lets the PUT replace an existing object (the
 *   signed token embeds the permission) — for deterministic paths where
 *   re-uploading means replacing.
 * @returns signed URL (15-min TTL) + the canonical path
 */
export async function createSignedUploadUrl(
  bucket: string,
  path: string,
  opts?: { upsert?: boolean },
): Promise<{ signedUrl: string; path: string }> {
  const storage = createServiceClient().storage;
  const { data, error } = await storage
    .from(bucket)
    .createSignedUploadUrl(path, opts?.upsert ? { upsert: true } : undefined);

  if (error || !data) {
    logger.error({ bucket, path, err: error }, "storage: failed to create signed upload URL");
    throw new Error(`Failed to create signed upload URL: ${error?.message}`);
  }

  return { signedUrl: data.signedUrl, path: data.path };
}

/**
 * Creates a signed download URL for a private bucket object.
 * TTL: 5 minutes (DOC-27 §5).
 *
 * @param bucket - Supabase Storage bucket name
 * @param path - Object path in the bucket
 */
export async function createSignedDownloadUrl(
  bucket: string,
  path: string,
): Promise<string> {
  const storage = createServiceClient().storage;
  const { data, error } = await storage
    .from(bucket)
    .createSignedUrl(path, DOWNLOAD_URL_TTL_SECONDS);

  if (error || !data) {
    logger.error({ bucket, path, err: error }, "storage: failed to create signed download URL");
    throw new Error(`Failed to create signed download URL: ${error?.message}`);
  }

  return data.signedUrl;
}

/**
 * Validates an uploaded object after the client has PUT it to the signed URL.
 *
 * Checks:
 * 1. Object exists and its size ≤ the shared upload limit
 * 2. Extension is in the allowlist for the bucket context
 * 3. Magic bytes match the declared extension (§5.1)
 *
 * If validation fails, the object is deleted from Storage and the reason is
 * returned. The caller must NOT register a file row in this case.
 */
export async function validateUploadedObject(
  bucket: string,
  path: string,
  bucketContext: BucketContext,
  opts?: {
    /** Overrides the shared default — only up to the bucket's own limit. */
    maxBytes?: number;
  },
): Promise<StorageValidationResult> {
  const storage = createServiceClient().storage;

  // Download first KB to check magic bytes
  const { data: blob, error: downloadErr } = await storage
    .from(bucket)
    .download(path);

  if (downloadErr || !blob) {
    return { ok: false, reason: "Object not found or not yet available." };
  }

  const arrayBuffer = await blob.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);
  const filename = path.split("/").pop() ?? path;

  // Size check
  const sizeResult = validateFileSize(buf.length, opts?.maxBytes ?? MAX_FILE_SIZE_BYTES);
  if (!sizeResult.ok) {
    await deleteObject(bucket, path);
    return sizeResult;
  }

  // Extension check
  const mimeResult = validateMime(filename, bucketContext);
  if (!mimeResult.ok) {
    await deleteObject(bucket, path);
    return mimeResult;
  }

  // Magic bytes check (first few bytes only)
  const headerBuf = buf.subarray(0, 16);
  const magicResult = validateMagicBytes(filename, headerBuf);
  if (!magicResult.ok) {
    await deleteObject(bucket, path);
    return magicResult;
  }

  // Return the downloaded bytes so the caller can run further checks (e.g. the
  // document quality gate) without a second 25 MB download.
  return { ok: true, bytes: buf };
}

/**
 * Uploads raw bytes to a private bucket (server-side, no signed URL).
 * Used for machine-generated files (filled PDFs, generated documents).
 *
 * @returns The canonical storage path of the uploaded file.
 */
export async function uploadBytesToStorage(
  bucket: string,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const storage = createServiceClient().storage;
  // Copy ONLY the view's bytes into a fresh ArrayBuffer. `bytes.buffer` is the
  // entire backing store, which for mupdf/wasm outputs is a large (possibly
  // SharedArrayBuffer) pool whose PDF view is only a slice — uploading `.buffer`
  // shipped megabytes of garbage + corrupted every generated file.
  const exact = new Uint8Array(bytes.byteLength);
  exact.set(bytes);
  const blob = new Blob([exact], { type: contentType });
  const { error } = await storage
    .from(bucket)
    .upload(path, blob, { contentType, upsert: true });

  if (error) {
    logger.error({ bucket, path, err: error }, "storage: failed to upload bytes");
    throw new Error(`Failed to upload bytes to storage: ${error.message}`);
  }

  return path;
}

/**
 * Downloads an object's raw bytes from a private bucket using the service
 * client (bypasses RLS — callers MUST authorize before calling, e.g. with
 * requireCaseAccess). Used to stream a document inline through a same-origin
 * route handler without exposing a signed URL.
 */
export async function downloadBytesFromStorage(
  bucket: string,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await createServiceClient().storage
    .from(bucket)
    .download(path);

  if (error || !data) {
    logger.error({ bucket, path, err: error }, "storage: failed to download bytes");
    throw new Error(`Failed to download bytes from storage: ${error?.message}`);
  }

  return new Uint8Array(await data.arrayBuffer());
}

export async function deleteObject(bucket: string, path: string): Promise<void> {
  const { error } = await createServiceClient().storage
    .from(bucket)
    .remove([path]);
  if (error) {
    logger.warn({ bucket, path, err: error }, "storage: failed to delete invalid object");
  }
}

export interface StorageObjectInfo {
  /** Object name relative to the listed prefix (no folders in between). */
  name: string;
  updatedAt: string | null;
  sizeBytes: number | null;
}

/**
 * Lists the objects directly under a prefix (service client — callers MUST
 * authorize first). Used for deterministic-path features that treat Storage as
 * the source of truth (no companion table), e.g. demo assets.
 */
export async function listObjects(
  bucket: string,
  prefix: string,
): Promise<StorageObjectInfo[]> {
  const { data, error } = await createServiceClient().storage
    .from(bucket)
    .list(prefix, { limit: 100 });

  if (error || !data) {
    logger.error({ bucket, prefix, err: error }, "storage: failed to list objects");
    throw new Error(`Failed to list storage objects: ${error?.message}`);
  }

  return data.map((f) => ({
    name: f.name,
    updatedAt: f.updated_at ?? null,
    sizeBytes: typeof f.metadata?.size === "number" ? f.metadata.size : null,
  }));
}
