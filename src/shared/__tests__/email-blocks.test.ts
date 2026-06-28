/**
 * Email blocks — trusted renderer + merge-field interpolation (security-critical).
 */

import { describe, it, expect } from "vitest";
import {
  renderBlocksToHtml,
  interpolateMergeFields,
  emptyBlock,
  BLOCK_TEMPLATES,
  type EmailBlock,
} from "../email-blocks";

describe("renderBlocksToHtml", () => {
  it("escapes user text in headings and paragraphs (no script injection)", () => {
    const blocks: EmailBlock[] = [
      { id: "1", type: "heading", text: "<script>alert(1)</script>" },
      { id: "2", type: "text", text: "Hola <b>mundo</b> & cía" },
    ];
    const html = renderBlocksToHtml(blocks);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; cía");
  });

  it("renders multiline text with <br/>", () => {
    const html = renderBlocksToHtml([{ id: "1", type: "text", text: "línea 1\nlínea 2" }]);
    expect(html).toContain("línea 1<br/>línea 2");
  });

  it("validates button/image URLs — only http(s) survives", () => {
    const html = renderBlocksToHtml([
      { id: "1", type: "button", label: "Click", url: "javascript:alert(1)" },
      { id: "2", type: "image", url: "https://cdn.example.com/x.png", alt: "x" },
    ]);
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
    expect(html).toContain('src="https://cdn.example.com/x.png"');
  });

  it("omits an image block with an empty url", () => {
    const html = renderBlocksToHtml([{ id: "1", type: "image", url: "  ", alt: "x" }]);
    expect(html.trim()).toBe("");
  });

  it("renders divider and spacer", () => {
    const html = renderBlocksToHtml([
      { id: "1", type: "divider" },
      { id: "2", type: "spacer" },
    ]);
    expect(html).toContain("<hr");
    expect(html).toContain("height:24px");
  });
});

describe("interpolateMergeFields", () => {
  it("replaces tokens and escapes the values", () => {
    const out = interpolateMergeFields("Hola {{nombre}} de {{org}}", {
      nombre: "<b>María</b>",
      org: "UsaLatino",
    });
    expect(out).toBe("Hola &lt;b&gt;María&lt;/b&gt; de UsaLatino");
  });

  it("collapses missing values to empty string", () => {
    expect(interpolateMergeFields("Hola {{nombre}}", {})).toBe("Hola ");
  });

  it("is case/space tolerant", () => {
    expect(interpolateMergeFields("{{ NOMBRE }}", { nombre: "Ana" })).toBe("Ana");
  });
});

describe("emptyBlock + templates", () => {
  it("creates each block type with the given id", () => {
    expect(emptyBlock("heading", "a")).toMatchObject({ id: "a", type: "heading" });
    expect(emptyBlock("button", "b")).toMatchObject({ id: "b", type: "button", url: expect.any(String) });
  });

  it("every template renders to non-empty html", () => {
    for (const tpl of BLOCK_TEMPLATES) {
      const blocks = tpl.blocks.map((b, i) => ({ ...b, id: String(i) }) as EmailBlock);
      expect(renderBlocksToHtml(blocks).length).toBeGreaterThan(0);
    }
  });
});
