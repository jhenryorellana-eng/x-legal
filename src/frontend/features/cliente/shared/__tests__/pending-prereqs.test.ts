import { describe, it, expect } from "vitest";
import { formatPendingPrereqForms } from "@/frontend/features/cliente/shared/pending-prereqs";

const label = (es: string, en: string) => ({ es, en });

describe("formatPendingPrereqForms — the gate names the REAL form, never a hardcoded one", () => {
  it("names the Apelación entry form (EOIR-26), not the Asilo I-589", () => {
    const out = formatPendingPrereqForms(
      {
        forms: ["eoir-26"],
        documents: [],
        formLabels: [label("Formulario EOIR-26 — Notificación de Apelación", "Form EOIR-26 — Notice of Appeal")],
      },
      "es",
    );
    expect(out).toBe("Formulario EOIR-26 — Notificación de Apelación");
    expect(out).not.toContain("I-589");
  });

  it("names the Asilo entry form on an Asilo case (same code path, different config)", () => {
    const out = formatPendingPrereqForms(
      { forms: ["i-589"], documents: [], formLabels: [label("Formulario I-589", "Form I-589")] },
      "es",
    );
    expect(out).toBe("Formulario I-589");
  });

  it("resolves the reader's locale", () => {
    const missing = {
      forms: ["eoir-26"],
      documents: [],
      formLabels: [label("Formulario EOIR-26", "Form EOIR-26")],
    };
    expect(formatPendingPrereqForms(missing, "en")).toBe("Form EOIR-26");
  });

  it("joins several pending forms with a localized conjunction", () => {
    const missing = {
      forms: ["a", "b", "c"],
      documents: [],
      formLabels: [label("Uno", "One"), label("Dos", "Two"), label("Tres", "Three")],
    };
    expect(formatPendingPrereqForms(missing, "es")).toBe("Uno, Dos y Tres");
    expect(formatPendingPrereqForms(missing, "en")).toBe("One, Two and Three");
  });

  it("returns null when nothing can be named, so the caller uses the generic copy", () => {
    // Documents-only prerequisite, unresolvable labels, or no gate at all: the UI
    // must fall back to generic wording rather than invent a form name.
    expect(formatPendingPrereqForms({ forms: [], documents: ["pasaporte"], formLabels: [] }, "es")).toBeNull();
    expect(formatPendingPrereqForms(null, "es")).toBeNull();
    expect(formatPendingPrereqForms(undefined, "es")).toBeNull();
    expect(formatPendingPrereqForms({ forms: ["x"], documents: [], formLabels: [{}] }, "es")).toBeNull();
  });
});
