import { describe, expect, it } from "vitest";
import { isLocale, resolveI18n } from "@/shared/i18n";

describe("resolveI18n (DOC-23 §3.1 fallback chain)", () => {
  it("returns the requested locale when present", () => {
    expect(resolveI18n({ es: "Hola", en: "Hello" }, "en")).toBe("Hello");
    expect(resolveI18n({ es: "Hola", en: "Hello" }, "es")).toBe("Hola");
  });

  it("falls back locale → es → en", () => {
    expect(resolveI18n({ es: "Hola" }, "en")).toBe("Hola");
    expect(resolveI18n({ en: "Hello" }, "es")).toBe("Hello");
  });

  it("falls back to the first non-empty value (draft data)", () => {
    expect(resolveI18n({ pt: "Olá" }, "es")).toBe("Olá");
  });

  it("returns '' for null, undefined and non-i18n values", () => {
    expect(resolveI18n(null, "es")).toBe("");
    expect(resolveI18n(undefined, "es")).toBe("");
    expect(resolveI18n("plain string", "es")).toBe("");
    expect(resolveI18n(42, "es")).toBe("");
    expect(resolveI18n(["es"], "es")).toBe("");
    expect(resolveI18n({ es: 7 }, "es")).toBe("");
  });

  it("treats null jsonb values as missing", () => {
    expect(resolveI18n({ es: null as unknown as string, en: "Hi" }, "es")).toBe(
      "Hi",
    );
  });

  it("treats empty strings as missing (partial translation degrades to the available language)", () => {
    expect(resolveI18n({ es: "Agendar cita 2", en: "" }, "en")).toBe(
      "Agendar cita 2",
    );
    expect(resolveI18n({ es: "", en: "Only EN" }, "es")).toBe("Only EN");
    expect(resolveI18n({ es: "", en: "" }, "en")).toBe("");
  });
});

describe("isLocale", () => {
  it("accepts only 'es' and 'en'", () => {
    expect(isLocale("es")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("pt")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
