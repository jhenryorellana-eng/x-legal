/**
 * Pure string helpers shared across backend + frontend (no dependencies).
 *
 * Centralizes the slugify pattern that was previously duplicated inline in
 * catalog-wizard.tsx (milestone/doc slugs) and is now also used to derive the
 * semantic download filename for case documents.
 */

/**
 * Converts a human string into a kebab-case, accent-stripped slug.
 *   "Pasaporte de Juan"      → "pasaporte-de-juan"
 *   "Evidencia #1 (José)"    → "evidencia-1-jose"
 * Returns "" for empty / symbol-only input — callers should provide a fallback.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normalizes a string for fuzzy, case/accent/symbol-insensitive search matching:
 * lowercases, strips diacritics, and removes every non-alphanumeric character.
 *   "José Pérez"        → "joseperez"
 *   "(305) 555-0142"    → "3055550142"
 *   "U26-000015"        → "u26000015"
 * So `normalizeForSearch(haystack).includes(normalizeForSearch(needle))` ignores
 * case, accents, spaces and punctuation.
 */
export function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Builds a safe, semantic download filename from a human display name + extension.
 *   ("Pasaporte de Juan", "pdf") → "pasaporte-de-juan.pdf"
 * Falls back to "documento" when the name slugifies to empty, and omits the dot
 * when no extension is given.
 */
export function toDownloadFilename(displayName: string, ext: string): string {
  const base = slugify(displayName) || "documento";
  const cleanExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return cleanExt ? `${base}.${cleanExt}` : base;
}
