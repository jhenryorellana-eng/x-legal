import { describe, it, expect } from "vitest";
import { resolveEmptyPolicy, isVerbatimValue } from "@/shared/form-logic/empty-policy";

describe("resolveEmptyPolicy", () => {
  it("auto (legacy): only text/textarea → N/A, dates/selects blank", () => {
    expect(resolveEmptyPolicy({ fieldType: "text" }, "auto")).toEqual({ mode: "fill", placeholder: "N/A" });
    expect(resolveEmptyPolicy({ fieldType: "textarea" }, "auto")).toEqual({ mode: "fill", placeholder: "N/A" });
    expect(resolveEmptyPolicy({ fieldType: "date" }, "auto")).toEqual({ mode: "blank" });
    expect(resolveEmptyPolicy({ fieldType: "select" }, "auto")).toEqual({ mode: "blank" });
  });

  it("na version default fills text-backed widgets including dates", () => {
    expect(resolveEmptyPolicy({ fieldType: "text" }, "na")).toEqual({ mode: "fill", placeholder: "N/A" });
    expect(resolveEmptyPolicy({ fieldType: "date" }, "na")).toEqual({ mode: "fill", placeholder: "N/A" });
    // a checkbox/radio can't hold text → stays blank even under `na`
    expect(resolveEmptyPolicy({ fieldType: "select" }, "na")).toEqual({ mode: "blank" });
    expect(resolveEmptyPolicy({ fieldType: "checkbox" }, "na")).toEqual({ mode: "blank" });
    expect(resolveEmptyPolicy({ fieldType: "number" }, "na")).toEqual({ mode: "blank" });
  });

  it("blank version default leaves every empty field blank", () => {
    expect(resolveEmptyPolicy({ fieldType: "text" }, "blank")).toEqual({ mode: "blank" });
    expect(resolveEmptyPolicy({ fieldType: "textarea" }, "blank")).toEqual({ mode: "blank" });
  });

  it("per-field override wins over the version default", () => {
    // version says na, but this field forces blank
    expect(resolveEmptyPolicy({ fieldType: "text", emptyPolicy: "blank" }, "na")).toEqual({ mode: "blank" });
    // version says blank, but this field forces N/A
    expect(resolveEmptyPolicy({ fieldType: "text", emptyPolicy: "na" }, "blank")).toEqual({
      mode: "fill",
      placeholder: "N/A",
    });
  });

  it("custom placeholder", () => {
    expect(resolveEmptyPolicy({ fieldType: "text", emptyPolicy: "custom", emptyPlaceholder: "None" }, "auto")).toEqual({
      mode: "fill",
      placeholder: "None",
    });
    // custom with an empty string falls back to N/A
    expect(resolveEmptyPolicy({ fieldType: "text", emptyPolicy: "custom", emptyPlaceholder: "  " }, "auto")).toEqual({
      mode: "fill",
      placeholder: "N/A",
    });
  });

  it("inherit defers to the version default", () => {
    expect(resolveEmptyPolicy({ fieldType: "date", emptyPolicy: "inherit" }, "na")).toEqual({
      mode: "fill",
      placeholder: "N/A",
    });
    expect(resolveEmptyPolicy({ fieldType: "date", emptyPolicy: "inherit" }, "auto")).toEqual({ mode: "blank" });
  });
});

describe("isVerbatimValue", () => {
  it("detects A-Numbers (the leak the whole fix targets)", () => {
    expect(isVerbatimValue("A123456789")).toBe(true);
    expect(isVerbatimValue("A-123456789")).toBe(true);
    expect(isVerbatimValue("a12345678")).toBe(true);
  });

  it("detects SSNs, dates, phones and id codes", () => {
    expect(isVerbatimValue("123-45-6789")).toBe(true);
    expect(isVerbatimValue("2012-04-10")).toBe(true);
    expect(isVerbatimValue("04/10/2012")).toBe(true);
    expect(isVerbatimValue("08/2014")).toBe(true);
    expect(isVerbatimValue("(305) 555-1234")).toBe(true);
    expect(isVerbatimValue("P1234567")).toBe(true); // passport
  });

  it("does NOT catch natural-language text (translatable) — names/cities rely on no_translate", () => {
    expect(isVerbatimValue("Caracas, Venezuela")).toBe(false);
    expect(isVerbatimValue("Mateo")).toBe(false);
    expect(isVerbatimValue("Due to my journalistic work I received threats")).toBe(false);
    expect(isVerbatimValue("Parole")).toBe(false);
    expect(isVerbatimValue("")).toBe(false);
  });
});
