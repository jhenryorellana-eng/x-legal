/**
 * Kanban module — pure domain logic (no I/O).
 *
 * Covers kanban boards/columns/cards rules AND leads sub-domain rules.
 * All functions are deterministic given their inputs; no DB calls here.
 *
 * References: DOC-47 §2 (columns, seeds, leads rules), DOC-30 §3 (tables).
 *
 * @module kanban/domain
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BoardKind = "leads" | "cases" | "collections";

export type LeadStatus = "open" | "won" | "lost";

/** Color tokens accepted for kanban columns (DOC-01 design tokens). */
export const COLOR_TOKENS = [
  "accent",
  "gold",
  "green",
  "red",
  "navy",
  "purple",
] as const;

export type ColumnColor = (typeof COLOR_TOKENS)[number];

export interface SeedColumn {
  label: string;
  color: ColumnColor;
  position: number;
  isTerminalWon: boolean;
  isTerminalLost: boolean;
}

// ---------------------------------------------------------------------------
// §2.2 — Seed columns per board_kind (NORMATIVE — closes PT-2 / RF-TRX-006.1)
// ---------------------------------------------------------------------------

/**
 * Returns the canonical seed columns for a given board_kind.
 *
 * Labels are the exact strings from DOC-47 §2.2.
 * Positions are 1-indexed; the entry column is always position 1.
 */
export function seedColumnsFor(kind: BoardKind): SeedColumn[] {
  switch (kind) {
    case "leads":
      return [
        { label: "Nuevo",              color: "accent", position: 1, isTerminalWon: false, isTerminalLost: false },
        { label: "Contactado",         color: "navy",   position: 2, isTerminalWon: false, isTerminalLost: false },
        { label: "Llamada agendada",   color: "purple", position: 3, isTerminalWon: false, isTerminalLost: false },
        { label: "En seguimiento",     color: "gold",   position: 4, isTerminalWon: false, isTerminalLost: false },
        { label: "Listo para cerrar",  color: "green",  position: 5, isTerminalWon: false, isTerminalLost: false },
        { label: "Listo para contrato",color: "green",  position: 6, isTerminalWon: true,  isTerminalLost: false },
        { label: "Rechazado",          color: "red",    position: 7, isTerminalWon: false, isTerminalLost: true  },
      ];

    case "cases":
      return [
        { label: "Por iniciar",        color: "accent", position: 1, isTerminalWon: false, isTerminalLost: false },
        { label: "En progreso",        color: "navy",   position: 2, isTerminalWon: false, isTerminalLost: false },
        { label: "Esperando cliente",  color: "gold",   position: 3, isTerminalWon: false, isTerminalLost: false },
        { label: "En validación",      color: "purple", position: 4, isTerminalWon: false, isTerminalLost: false },
        { label: "Listo",              color: "green",  position: 5, isTerminalWon: true,  isTerminalLost: false },
      ];

    case "collections":
      return [
        { label: "Por cobrar inicial", color: "accent", position: 1, isTerminalWon: false, isTerminalLost: false },
        { label: "Cuotas por vencer",  color: "gold",   position: 2, isTerminalWon: false, isTerminalLost: false },
        { label: "Vencidas",           color: "red",    position: 3, isTerminalWon: false, isTerminalLost: false },
        { label: "Por imprimir",       color: "navy",   position: 4, isTerminalWon: false, isTerminalLost: false },
        { label: "Hecho",              color: "green",  position: 5, isTerminalWon: true,  isTerminalLost: false },
      ];
  }
}

// ---------------------------------------------------------------------------
// §2.1.4 — board_kind <-> ref_type compatibility
// ---------------------------------------------------------------------------

/** Returns the valid ref_type for a given board_kind. */
export function validRefTypeForKind(kind: BoardKind): "lead" | "case" {
  return kind === "leads" ? "lead" : "case";
}

/** Returns the module key for authorization. */
export function moduleKeyForKind(kind: BoardKind): "leads" | "cases" | "collections" {
  return kind;
}

// ---------------------------------------------------------------------------
// §2.3 — Column validation rules
// ---------------------------------------------------------------------------

/**
 * Validates column label — must not be empty or whitespace-only.
 */
export function isColumnLabelValid(label: string): boolean {
  return typeof label === "string" && label.trim().length > 0;
}

/**
 * Validates column color — must be one of the design-system tokens.
 */
export function isColumnColorValid(color: string): boolean {
  return (COLOR_TOKENS as readonly string[]).includes(color);
}

/**
 * Validates that a single column does not have both terminal flags set.
 * DOC-47 §2.3: terminal flags are mutually exclusive on a column.
 */
export function columnTerminalFlagsValid(
  isTerminalWon: boolean,
  isTerminalLost: boolean,
): boolean {
  return !(isTerminalWon && isTerminalLost);
}

// ---------------------------------------------------------------------------
// §2.5 — Lead phone shape validation (pure — no I/O)
// ---------------------------------------------------------------------------

/**
 * Returns true when a phone string has a valid E.164 shape.
 * The service layer normalizes via identity.normalizePhoneE164; this function
 * is used in domain tests and as a final guard.
 *
 * E.164: starts with +, 8–15 digits total.
 */
export function isLeadPhoneShapeValid(phone: string): boolean {
  if (typeof phone !== "string") return false;
  // E.164: + followed by 7–14 digits (total 8–15 chars)
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

// ---------------------------------------------------------------------------
// §2.5 — Duplicate detection (pure — receives pre-queried list)
// ---------------------------------------------------------------------------

export interface LeadDuplicateCandidate {
  id: string;
  phoneE164: string;
  fullName: string | null;
}

export interface DuplicateCheckResult {
  hasMatches: boolean;
  exactMatches: LeadDuplicateCandidate[];
  weakMatches: LeadDuplicateCandidate[];
}

/**
 * Detects duplicate leads at two levels (DOC-47 §2.5):
 *
 * (a) Exact: same normalized E.164 phone in the org.
 * (b) Weak: same last-4 digits (catches different country prefix, typos, etc.)
 *
 * The service queries existing leads and passes them here; this function is
 * pure so it can be unit-tested without DB.
 *
 * @param normalizedPhone - The already-normalized E.164 phone of the new lead.
 * @param existingLeads   - All leads for the org that share the last 4 digits.
 */
export function findLeadDuplicates(
  normalizedPhone: string,
  existingLeads: LeadDuplicateCandidate[],
): DuplicateCheckResult {
  const last4 = normalizedPhone.slice(-4);

  const exactMatches = existingLeads.filter(
    (l) => l.phoneE164 === normalizedPhone,
  );

  // Weak matches: same last-4 digits but different exact phone
  const weakMatches = existingLeads.filter(
    (l) =>
      l.phoneE164 !== normalizedPhone &&
      l.phoneE164.slice(-4) === last4,
  );

  return {
    hasMatches: exactMatches.length > 0 || weakMatches.length > 0,
    exactMatches,
    weakMatches,
  };
}
