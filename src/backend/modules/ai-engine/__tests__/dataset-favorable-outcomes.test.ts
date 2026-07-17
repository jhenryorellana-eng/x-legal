/**
 * ai-engine domain — favorable-outcome scoring includes `remanded`.
 *
 * Appeal wins are BIA/circuit REMANDS, not "granted" — the appeal dataset's
 * best items carry outcome='remanded' and must rank as favorable in both the
 * dataset selector and the jurisprudence picker (before this, only 'granted'
 * scored and remands lost to recency).
 */

import { describe, it, expect } from "vitest";

import { selectDatasetItems, datasetToJurisprudence, type DatasetItem } from "../domain";

function item(overrides: Partial<DatasetItem>): DatasetItem {
  return {
    id: "i",
    title: "Matter of X-, 28 I&N Dec. 100 (BIA 2020)",
    content: "holding text",
    tags: [],
    outcome: null,
    token_count: 100,
    created_at: "2026-01-01T00:00:00Z",
    jurisdiction: "BIA",
    meta: { kind: "precedent", holding: "holding text" },
    ...overrides,
  };
}

describe("selectDatasetItems — favorable outcomes", () => {
  it("ranks a remanded item above a denied one (outcome beats recency)", () => {
    const remanded = item({ id: "rem", outcome: "remanded", created_at: "2024-01-01T00:00:00Z" });
    const denied = item({ id: "den", outcome: "denied", created_at: "2026-01-01T00:00:00Z" });

    // Budget fits exactly one item — the favorable one must win.
    const { selectedItems } = selectDatasetItems([denied, remanded], {}, 120);

    expect(selectedItems).toHaveLength(1);
    expect(selectedItems[0].id).toBe("rem");
  });

  it("still ranks granted above denied (regression)", () => {
    const granted = item({ id: "gra", outcome: "granted", created_at: "2024-01-01T00:00:00Z" });
    const denied = item({ id: "den", outcome: "denied", created_at: "2026-01-01T00:00:00Z" });

    const { selectedItems } = selectDatasetItems([denied, granted], {}, 120);

    expect(selectedItems[0].id).toBe("gra");
  });
});

describe("datasetToJurisprudence — favorable outcomes", () => {
  it("ranks a remanded precedent above a denied one", () => {
    const remanded = item({
      id: "rem",
      title: "Matter of R-, 27 I&N Dec. 500 (BIA 2019)",
      outcome: "remanded",
      created_at: "2024-01-01T00:00:00Z",
      meta: { kind: "precedent", citation: "27 I&N Dec. 500", holding: "remand holding" },
    });
    const denied = item({
      id: "den",
      title: "Matter of D-, 28 I&N Dec. 900 (BIA 2023)",
      outcome: "denied",
      created_at: "2026-01-01T00:00:00Z",
      meta: { kind: "precedent", citation: "28 I&N Dec. 900", holding: "denial holding" },
    });

    const cases = datasetToJurisprudence([denied, remanded], null);

    expect(cases).toHaveLength(2);
    expect(cases[0].holding).toBe("remand holding");
  });
});
