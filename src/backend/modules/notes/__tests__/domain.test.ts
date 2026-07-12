/**
 * Notes domain — pure-function tests (no I/O, no mocks).
 *
 * Coverage:
 *  - isNoteVisibility: only the 3 levels
 *  - noteBodySchema: trim + 1..4000 bounds
 *  - canEditNote: author or admin
 */

import { describe, it, expect } from "vitest";
import { isNoteVisibility, noteBodySchema, canEditNote } from "../domain";

describe("isNoteVisibility", () => {
  it("accepts the 3 visibility levels", () => {
    expect(isNoteVisibility("general")).toBe(true);
    expect(isNoteVisibility("team")).toBe(true);
    expect(isNoteVisibility("personal")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isNoteVisibility("public")).toBe(false);
    expect(isNoteVisibility("")).toBe(false);
    expect(isNoteVisibility("General")).toBe(false);
  });
});

describe("noteBodySchema", () => {
  it("trims and requires at least 1 char", () => {
    expect(noteBodySchema.safeParse("   ").success).toBe(false);
    const ok = noteBodySchema.safeParse("  hola  ");
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toBe("hola");
  });
  it("rejects bodies over 4000 chars", () => {
    expect(noteBodySchema.safeParse("x".repeat(4001)).success).toBe(false);
    expect(noteBodySchema.safeParse("x".repeat(4000)).success).toBe(true);
  });
});

describe("canEditNote", () => {
  const author = { userId: "u-1", role: "sales" as const };
  const other = { userId: "u-2", role: "paralegal" as const };
  const admin = { userId: "u-3", role: "admin" as const };
  const note = { authorUserId: "u-1" };

  it("lets the author edit their own note", () => {
    expect(canEditNote(author, note)).toBe(true);
  });
  it("blocks a non-author non-admin", () => {
    expect(canEditNote(other, note)).toBe(false);
  });
  it("lets an admin edit anyone's note", () => {
    expect(canEditNote(admin, note)).toBe(true);
  });
});
