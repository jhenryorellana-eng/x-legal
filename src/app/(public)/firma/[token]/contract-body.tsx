/**
 * Renders a frozen ContractDocument (DOC-51) as the formal contract body shown
 * inside the signing page's scroll box. Presentational only — the document is
 * assembled + frozen server-side (contracts/contract-document.ts).
 */

import * as React from "react";
import type { ContractBlock, ContractDocument } from "@/backend/modules/contracts";

const h3: React.CSSProperties = {
  margin: "0 0 8px",
  fontFamily: "var(--font-title)",
  fontWeight: 800,
  fontSize: 15.5,
  color: "var(--navy)",
};
const para: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 15,
  lineHeight: 1.65,
  color: "var(--ink-2)",
};

function Block({ block }: { block: ContractBlock }) {
  switch (block.kind) {
    case "paragraph":
      return <p style={para}>{block.text}</p>;
    case "list":
      return (
        <ol style={{ margin: "0 0 8px", paddingLeft: 22, color: "var(--ink-2)" }}>
          {block.items.map((it, i) => (
            <li key={i} style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 4 }}>
              {it}
            </li>
          ))}
        </ol>
      );
    case "fieldGroup":
      return (
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: "0 0 4px", fontSize: 13.5, fontWeight: 800, color: "var(--ink)" }}>
            {block.heading}
          </p>
          {block.rows.map((r, i) => (
            <p key={i} style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
              <span style={{ fontWeight: 700, color: "var(--ink)" }}>{r.label}:</span> {r.value}
            </p>
          ))}
        </div>
      );
    case "scheduleTable":
      return (
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "4px 0 8px", fontSize: 13.5 }}>
          <thead>
            <tr>
              {block.headers.map((hd, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: i === 0 ? "left" : i === 2 ? "right" : "center",
                    padding: "6px 8px",
                    borderBottom: "2px solid var(--line)",
                    color: "var(--ink-3)",
                    fontWeight: 800,
                    fontSize: 12,
                  }}
                >
                  {hd}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i} style={row.emphasis ? { fontWeight: 800, color: "var(--ink)" } : undefined}>
                {row.cells.map((c, j) => (
                  <td
                    key={j}
                    style={{
                      textAlign: j === 0 ? "left" : j === 2 ? "right" : "center",
                      padding: "6px 8px",
                      borderTop: row.emphasis ? "2px solid var(--line)" : "1px solid var(--line)",
                      color: row.emphasis ? "var(--ink)" : "var(--ink-2)",
                    }}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    default:
      return null;
  }
}

export function ContractBody({ document }: { document: ContractDocument }) {
  return (
    <div>
      <div style={{ marginBottom: 16, textAlign: "center" }}>
        <h2 style={{ ...h3, fontSize: 17, margin: "0 0 4px" }}>{document.title}</h2>
        {document.subtitle && (
          <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>
            {document.subtitle}
          </p>
        )}
        {document.dateLabel && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)" }}>{document.dateLabel}</p>
        )}
      </div>

      {document.sections.map((sec) => (
        <div key={sec.key} style={{ marginBottom: 16 }}>
          <h3 style={h3}>{sec.title}</h3>
          {sec.blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </div>
      ))}

      {/* Signatures */}
      <div style={{ display: "flex", gap: 18, marginTop: 24, flexWrap: "wrap" }}>
        {[document.signatures.consultor, document.signatures.client].map((s, i) => (
          <div key={i} style={{ flex: "1 1 180px" }}>
            <div style={{ borderTop: "1px solid var(--ink-2)", paddingTop: 6 }}>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 13.5, color: "var(--ink)" }}>{s.name}</p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>{s.role}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
