/**
 * composeLexBubble — i18n composition + XSS guard.
 *
 * The composed `html` is rendered via dangerouslySetInnerHTML, and string params
 * can be staff-editable free text (a lead's name). These tests pin that every
 * string param is HTML-escaped before interpolation, while numbers (needed for
 * ICU plural selection) pass through untouched.
 */
import { describe, it, expect } from "vitest";
import { composeLexBubble, type LexTranslators } from "../compose";
import type { LexInsight } from "../types";

/** Spy translator: records the values handed to `markup`, echoes labels. */
function spyTranslators(): { tr: LexTranslators; seen: Record<string, unknown> } {
  const seen: Record<string, unknown> = {};
  const tr: LexTranslators = {
    t: (key, values) => `${key}:${JSON.stringify(values ?? {})}`,
    markup: (key, values) => {
      Object.assign(seen, values);
      return `markup:${key}`;
    },
  };
  return { tr, seen };
}

describe("composeLexBubble", () => {
  it("returns null when there is no insight", () => {
    expect(composeLexBubble(spyTranslators().tr, null)).toBeNull();
  });

  it("HTML-escapes string params (XSS guard) but passes numbers through", () => {
    const { tr, seen } = spyTranslators();
    const insight: LexInsight = {
      id: "sales:priority",
      tone: "warn",
      messageKey: "sales.priority",
      params: { n: 3, name: '<img src=x onerror=alert(1)>' },
      actions: [],
    };
    const vm = composeLexBubble(tr, insight);
    expect(vm).not.toBeNull();
    // The dangerous name is escaped before it can reach dangerouslySetInnerHTML…
    expect(seen.name).toBe("&lt;img src=x onerror=alert(1)&gt;");
    // …and the numeric param is untouched (ICU plural needs a real number).
    expect(seen.n).toBe(3);
    // The `b` markup tag is the only raw-HTML producer.
    expect(typeof seen.b).toBe("function");
  });

  it("escapes ampersands and quotes too", () => {
    const { tr, seen } = spyTranslators();
    composeLexBubble(tr, {
      id: "x",
      tone: "info",
      messageKey: "k",
      params: { amount: 'A&B "C" \'D\'' },
      actions: [],
    });
    expect(seen.amount).toBe("A&amp;B &quot;C&quot; &#39;D&#39;");
  });

  it("maps actions to localized, serialisable VM entries", () => {
    const { tr } = spyTranslators();
    const vm = composeLexBubble(tr, {
      id: "finance:overdue",
      tone: "danger",
      messageKey: "finance.overdue",
      params: { n: 2, amount: "$100" },
      actions: [{ id: "viewOverdue", labelKey: "actions.viewOverdue", href: "/finanzas/pagos", icon: "warning" }],
    })!;
    expect(vm.actions).toHaveLength(1);
    expect(vm.actions[0]).toMatchObject({ id: "viewOverdue", href: "/finanzas/pagos", icon: "warning" });
  });
});
