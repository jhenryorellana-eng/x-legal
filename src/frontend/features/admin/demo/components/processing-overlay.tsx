"use client";

import * as React from "react";

/** ProcessingOverlay — full-screen spinner over the phone (e.g. payment processing). */
export function ProcessingOverlay({ label }: { label: string }) {
  return (
    <div
      className="demo-overlay"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        background: "color-mix(in srgb, var(--brand-navy) 48%, transparent)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
      }}
    >
      <div
        style={{
          width: 62,
          height: 62,
          borderRadius: 999,
          border: "5px solid rgba(255,255,255,0.32)",
          borderTopColor: "#fff",
          animation: "demo-spin 0.8s linear infinite",
        }}
      />
      <span style={{ color: "#fff", fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 16 }}>
        {label}
      </span>
    </div>
  );
}
