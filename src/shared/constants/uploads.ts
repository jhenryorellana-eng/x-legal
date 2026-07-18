/**
 * Upload limits — single source of truth (DOC-15 RF-TRX / RNF-016).
 *
 * RNF-016 defines the per-client-file cap as "default 25 MB, configurable".
 * Raised to 50 MB: real scanned court records (asylum filings with annexes)
 * exceed 200 pages / 25 MB. Every surface — client PWA, staff case tabs and
 * the server-side confirm validation — must import THIS constant; the
 * `case-documents` bucket `file_size_limit` mirrors it in Storage.
 */
export const UPLOAD_MAX_FILE_MB = 50;

export const UPLOAD_MAX_FILE_BYTES = UPLOAD_MAX_FILE_MB * 1024 * 1024;
