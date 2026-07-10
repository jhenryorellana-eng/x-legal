import * as React from "react";
import Link from "next/link";
import { Lex, type LexMood } from "@/frontend/components/brand/lex";

/**
 * EmptyCase — friendly empty state for case screens (DOC-51 §0.5 "Empty").
 * Lex + title + body, centered, no harsh language. Server-safe.
 */
export function EmptyCase({
  title,
  body,
  lexMood = "calma",
  action,
}: {
  title: string;
  body?: string;
  lexMood?: LexMood;
  /** Optional call-to-action link (e.g. "Ir a Documentos"). Server-safe <a>. */
  action?: { href: string; label: string };
}) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 26px var(--screen-pb)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 14,
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), var(--bg)",
      }}
    >
      <Lex size={120} mood={lexMood} />
      <h1
        className="t-black"
        style={{ margin: 0, fontSize: 24, color: "var(--navy)", textWrap: "balance" }}
      >
        {title}
      </h1>
      {body && (
        <p
          style={{
            margin: 0,
            fontSize: 16,
            color: "var(--ink-2)",
            fontWeight: 500,
            maxWidth: 300,
            lineHeight: 1.5,
          }}
        >
          {body}
        </p>
      )}
      {action && (
        <Link
          href={action.href}
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 48,
            padding: "0 24px",
            borderRadius: 999,
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 800,
            fontSize: 15,
            textDecoration: "none",
            boxShadow: "0 10px 30px rgba(11,27,51,0.12)",
          }}
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
