/**
 * Kanban domain — TDD tests.
 *
 * Pure functions only — no I/O, no mocks.
 *
 * Coverage:
 *  - seedColumnsFor: exact columns per kind (DOC-47 §2.2 NORMATIVE)
 *  - findLeadDuplicates: exact + weak (last-4) detection (DOC-47 §2.5)
 *  - isLeadPhoneShapeValid: E.164 shape validation
 *  - isColumnLabelValid / isColumnColorValid / columnTerminalFlagsValid
 *  - validRefTypeForKind / moduleKeyForKind
 */

import { describe, it, expect } from "vitest";

import {
  seedColumnsFor,
  findLeadDuplicates,
  isLeadPhoneShapeValid,
  isColumnLabelValid,
  isColumnColorValid,
  columnTerminalFlagsValid,
  validRefTypeForKind,
  moduleKeyForKind,
  type SeedColumn,
  type LeadDuplicateCandidate,
} from "../domain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wonColumns(cols: SeedColumn[]): SeedColumn[] {
  return cols.filter((c) => c.isTerminalWon);
}

function lostColumns(cols: SeedColumn[]): SeedColumn[] {
  return cols.filter((c) => c.isTerminalLost);
}

// ---------------------------------------------------------------------------
// seedColumnsFor — DOC-47 §2.2 (NORMATIVE)
// ---------------------------------------------------------------------------

describe("seedColumnsFor('leads')", () => {
  const cols = seedColumnsFor("leads");

  it("returns exactly 7 columns", () => {
    expect(cols).toHaveLength(7);
  });

  it("positions are 1-indexed and contiguous", () => {
    const positions = cols.map((c) => c.position).sort((a, b) => a - b);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("entry column (position=1) is 'Nuevo' with color accent", () => {
    const entry = cols.find((c) => c.position === 1)!;
    expect(entry.label).toBe("Nuevo");
    expect(entry.color).toBe("accent");
    expect(entry.isTerminalWon).toBe(false);
    expect(entry.isTerminalLost).toBe(false);
  });

  it("second column is 'Contactado' with color navy", () => {
    const col = cols.find((c) => c.position === 2)!;
    expect(col.label).toBe("Contactado");
    expect(col.color).toBe("navy");
  });

  it("third column is 'Llamada agendada' with color purple", () => {
    const col = cols.find((c) => c.position === 3)!;
    expect(col.label).toBe("Llamada agendada");
    expect(col.color).toBe("purple");
  });

  it("fourth column is 'En seguimiento' with color gold", () => {
    const col = cols.find((c) => c.position === 4)!;
    expect(col.label).toBe("En seguimiento");
    expect(col.color).toBe("gold");
  });

  it("fifth column is 'Listo para cerrar' with color green", () => {
    const col = cols.find((c) => c.position === 5)!;
    expect(col.label).toBe("Listo para cerrar");
    expect(col.color).toBe("green");
  });

  it("exactly one terminal-won column (Ganado, position=6)", () => {
    const won = wonColumns(cols);
    expect(won).toHaveLength(1);
    expect(won[0].label).toBe("Ganado");
    expect(won[0].position).toBe(6);
    expect(won[0].color).toBe("green");
  });

  it("exactly one terminal-lost column (Perdido, position=7)", () => {
    const lost = lostColumns(cols);
    expect(lost).toHaveLength(1);
    expect(lost[0].label).toBe("Perdido");
    expect(lost[0].position).toBe(7);
    expect(lost[0].color).toBe("red");
  });

  it("no column has both terminal flags set", () => {
    for (const col of cols) {
      expect(col.isTerminalWon && col.isTerminalLost).toBe(false);
    }
  });
});

describe("seedColumnsFor('cases')", () => {
  const cols = seedColumnsFor("cases");

  it("returns exactly 5 columns", () => {
    expect(cols).toHaveLength(5);
  });

  it("positions are 1-indexed and contiguous", () => {
    const positions = cols.map((c) => c.position).sort((a, b) => a - b);
    expect(positions).toEqual([1, 2, 3, 4, 5]);
  });

  it("entry column (position=1) is 'Por iniciar' with color accent", () => {
    const entry = cols.find((c) => c.position === 1)!;
    expect(entry.label).toBe("Por iniciar");
    expect(entry.color).toBe("accent");
  });

  it("second column is 'En progreso' with color navy", () => {
    const col = cols.find((c) => c.position === 2)!;
    expect(col.label).toBe("En progreso");
    expect(col.color).toBe("navy");
  });

  it("third column is 'Esperando cliente' with color gold", () => {
    const col = cols.find((c) => c.position === 3)!;
    expect(col.label).toBe("Esperando cliente");
    expect(col.color).toBe("gold");
  });

  it("fourth column is 'En validación' with color purple", () => {
    const col = cols.find((c) => c.position === 4)!;
    expect(col.label).toBe("En validación");
    expect(col.color).toBe("purple");
  });

  it("exactly one terminal-won column (Listo, position=5)", () => {
    const won = wonColumns(cols);
    expect(won).toHaveLength(1);
    expect(won[0].label).toBe("Listo");
    expect(won[0].position).toBe(5);
    expect(won[0].color).toBe("green");
  });

  it("no terminal-lost columns on cases board", () => {
    expect(lostColumns(cols)).toHaveLength(0);
  });

  it("no column has both terminal flags set", () => {
    for (const col of cols) {
      expect(col.isTerminalWon && col.isTerminalLost).toBe(false);
    }
  });
});

describe("seedColumnsFor('collections')", () => {
  const cols = seedColumnsFor("collections");

  it("returns exactly 5 columns", () => {
    expect(cols).toHaveLength(5);
  });

  it("positions are 1-indexed and contiguous", () => {
    const positions = cols.map((c) => c.position).sort((a, b) => a - b);
    expect(positions).toEqual([1, 2, 3, 4, 5]);
  });

  it("entry column (position=1) is 'Por cobrar inicial' with color accent", () => {
    const entry = cols.find((c) => c.position === 1)!;
    expect(entry.label).toBe("Por cobrar inicial");
    expect(entry.color).toBe("accent");
  });

  it("second column is 'Cuotas por vencer' with color gold", () => {
    const col = cols.find((c) => c.position === 2)!;
    expect(col.label).toBe("Cuotas por vencer");
    expect(col.color).toBe("gold");
  });

  it("third column is 'Vencidas' with color red", () => {
    const col = cols.find((c) => c.position === 3)!;
    expect(col.label).toBe("Vencidas");
    expect(col.color).toBe("red");
  });

  it("fourth column is 'Por imprimir' with color navy", () => {
    const col = cols.find((c) => c.position === 4)!;
    expect(col.label).toBe("Por imprimir");
    expect(col.color).toBe("navy");
  });

  it("exactly one terminal-won column (Hecho, position=5)", () => {
    const won = wonColumns(cols);
    expect(won).toHaveLength(1);
    expect(won[0].label).toBe("Hecho");
    expect(won[0].position).toBe(5);
    expect(won[0].color).toBe("green");
  });

  it("no terminal-lost columns on collections board", () => {
    expect(lostColumns(cols)).toHaveLength(0);
  });

  it("no column has both terminal flags set", () => {
    for (const col of cols) {
      expect(col.isTerminalWon && col.isTerminalLost).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// findLeadDuplicates — DOC-47 §2.5 (two-level detection)
// ---------------------------------------------------------------------------

describe("findLeadDuplicates", () => {
  const existing: LeadDuplicateCandidate[] = [
    { id: "11111111-1111-4111-8111-111111111111", phoneE164: "+17035551234", fullName: "Ana García" },
    { id: "22222222-2222-4222-8222-222222222222", phoneE164: "+17035559234", fullName: "Carlos López" },
    { id: "33333333-3333-4333-8333-333333333333", phoneE164: "+12145551234", fullName: "María Torres" },
  ];

  describe("level (a): exact match", () => {
    it("detects an exact E.164 match (exact in exactMatches; other same-last4 go into weak)", () => {
      const result = findLeadDuplicates("+17035551234", existing);
      expect(result.hasMatches).toBe(true);
      expect(result.exactMatches).toHaveLength(1);
      expect(result.exactMatches[0].id).toBe("11111111-1111-4111-8111-111111111111");
      // "+12145551234" also ends in "1234" and is NOT the exact match → appears in weak
      expect(result.weakMatches).toHaveLength(1);
      expect(result.weakMatches[0].id).toBe("33333333-3333-4333-8333-333333333333");
    });

    it("returns no matches when phone is unique", () => {
      const result = findLeadDuplicates("+17035550000", existing);
      expect(result.hasMatches).toBe(false);
      expect(result.exactMatches).toHaveLength(0);
      expect(result.weakMatches).toHaveLength(0);
    });
  });

  describe("level (b): weak match (last-4 digits)", () => {
    it("detects weak match when last-4 digits are the same but prefix differs", () => {
      // "+11235551234" has same last-4 "1234" as "+17035551234" and "+12145551234"
      // Existing leads with "1234" last-4: 111... (+17035551234) and 333... (+12145551234)
      const result = findLeadDuplicates("+11235551234", existing);
      expect(result.hasMatches).toBe(true);
      expect(result.exactMatches).toHaveLength(0);
      expect(result.weakMatches).toHaveLength(2);
      const weakIds = result.weakMatches.map((m) => m.id).sort();
      expect(weakIds).toContain("11111111-1111-4111-8111-111111111111");
      expect(weakIds).toContain("33333333-3333-4333-8333-333333333333");
    });

    it("does NOT include exact match in weak matches (different lists)", () => {
      const result = findLeadDuplicates("+17035551234", existing);
      // Exact match: 111...; weak matches for "1234" would include 333... but NOT 111...
      const weakIds = result.weakMatches.map((m) => m.id);
      expect(weakIds).not.toContain("11111111-1111-4111-8111-111111111111");
    });

    it("no weak matches when last-4 differ", () => {
      const result = findLeadDuplicates("+17035559999", existing);
      expect(result.hasMatches).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("returns no matches for empty list", () => {
      const result = findLeadDuplicates("+17035551234", []);
      expect(result.hasMatches).toBe(false);
      expect(result.exactMatches).toHaveLength(0);
      expect(result.weakMatches).toHaveLength(0);
    });

    it("handles phone with same last-4 only once in list", () => {
      const single: LeadDuplicateCandidate[] = [
        { id: "44444444-4444-4444-8444-444444444444", phoneE164: "+19995559234", fullName: null },
      ];
      // "+17035559234" last-4 = "9234", same as single entry — weak match
      const result = findLeadDuplicates("+17035559234", single);
      // But "+17035559234" !== "+19995559234" → no exact; same last-4 → weak
      expect(result.hasMatches).toBe(true);
      expect(result.exactMatches).toHaveLength(0);
      expect(result.weakMatches).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// isLeadPhoneShapeValid — E.164 shape
// ---------------------------------------------------------------------------

describe("isLeadPhoneShapeValid", () => {
  it("accepts valid E.164 US number", () => {
    expect(isLeadPhoneShapeValid("+17035551234")).toBe(true);
  });

  it("accepts valid E.164 international number", () => {
    expect(isLeadPhoneShapeValid("+523001234567")).toBe(true);
  });

  it("rejects number without leading +", () => {
    expect(isLeadPhoneShapeValid("17035551234")).toBe(false);
  });

  it("rejects number with spaces", () => {
    expect(isLeadPhoneShapeValid("+1 703 555 1234")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isLeadPhoneShapeValid("")).toBe(false);
  });

  it("rejects too short number", () => {
    expect(isLeadPhoneShapeValid("+1234567")).toBe(false);
  });

  it("rejects non-string", () => {
    expect(isLeadPhoneShapeValid(null as unknown as string)).toBe(false);
  });

  it("accepts minimum-length E.164 (8 chars)", () => {
    // +1234567 = 8 chars but 7 digits after + — that's below min (8 digits required)
    // +12345678 = 9 chars, 8 digits → valid
    expect(isLeadPhoneShapeValid("+12345678")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Column validation
// ---------------------------------------------------------------------------

describe("isColumnLabelValid", () => {
  it("accepts non-empty string", () => {
    expect(isColumnLabelValid("Nuevo")).toBe(true);
  });

  it("accepts string with spaces inside", () => {
    expect(isColumnLabelValid("En progreso")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isColumnLabelValid("")).toBe(false);
  });

  it("rejects whitespace-only string", () => {
    expect(isColumnLabelValid("   ")).toBe(false);
  });
});

describe("isColumnColorValid", () => {
  it("accepts all design tokens", () => {
    const tokens = ["accent", "gold", "green", "red", "navy", "purple"];
    for (const t of tokens) {
      expect(isColumnColorValid(t)).toBe(true);
    }
  });

  it("rejects unknown color", () => {
    expect(isColumnColorValid("pink")).toBe(false);
    expect(isColumnColorValid("blue")).toBe(false);
    expect(isColumnColorValid("")).toBe(false);
  });
});

describe("columnTerminalFlagsValid", () => {
  it("accepts won=true, lost=false", () => {
    expect(columnTerminalFlagsValid(true, false)).toBe(true);
  });

  it("accepts won=false, lost=true", () => {
    expect(columnTerminalFlagsValid(false, true)).toBe(true);
  });

  it("accepts won=false, lost=false", () => {
    expect(columnTerminalFlagsValid(false, false)).toBe(true);
  });

  it("rejects won=true, lost=true (mutually exclusive)", () => {
    expect(columnTerminalFlagsValid(true, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validRefTypeForKind / moduleKeyForKind
// ---------------------------------------------------------------------------

describe("validRefTypeForKind", () => {
  it("leads → lead", () => {
    expect(validRefTypeForKind("leads")).toBe("lead");
  });

  it("cases → case", () => {
    expect(validRefTypeForKind("cases")).toBe("case");
  });

  it("collections → case", () => {
    expect(validRefTypeForKind("collections")).toBe("case");
  });
});

describe("moduleKeyForKind", () => {
  it("leads → leads", () => {
    expect(moduleKeyForKind("leads")).toBe("leads");
  });

  it("cases → cases", () => {
    expect(moduleKeyForKind("cases")).toBe("cases");
  });

  it("collections → collections", () => {
    expect(moduleKeyForKind("collections")).toBe("collections");
  });
});
