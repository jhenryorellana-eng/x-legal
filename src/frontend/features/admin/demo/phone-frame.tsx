"use client";

import * as React from "react";

/**
 * PhoneFrame — a premium device mockup that hosts the mobile client replica so
 * the live audience clearly reads it as "what the client sees on their phone".
 *
 * Layering matters: only `children` scrolls. The `footer` (bottom nav) and
 * `overlay` (success / processing / review) are rendered OUTSIDE the scroll
 * viewport, pinned to the screen — an absolutely-positioned element *inside* a
 * scroll container would drift with the content instead of staying put.
 */
export function PhoneFrame({
  children,
  footer,
  overlay,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  overlay?: React.ReactNode;
}) {
  return (
    <div style={{ width: 392, maxWidth: "100%", margin: "0 auto", flexShrink: 0 }}>
      <div
        style={{
          position: "relative",
          borderRadius: 50,
          padding: 12,
          background: "linear-gradient(160deg, #2a3856, #0b1322)",
          boxShadow:
            "0 44px 90px rgba(11,27,51,0.42), 0 10px 24px rgba(11,27,51,0.28), inset 0 1px 0 rgba(255,255,255,0.12)",
        }}
      >
        {/* Screen (positioning context for scroll, footer and overlay) */}
        <div
          style={{
            position: "relative",
            borderRadius: 38,
            overflow: "hidden",
            background:
              "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
            height: "clamp(580px, calc(100vh - 210px), 868px)",
          }}
        >
          {/* Dynamic island */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              width: 116,
              height: 30,
              borderRadius: 999,
              background: "#0b1322",
              zIndex: 50,
            }}
          />
          {/* Status bar — frosted so content scrolling underneath fades out
              cleanly instead of bleeding past the "9:41" row. */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 52,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 26px",
              zIndex: 40,
              background: "linear-gradient(to bottom, color-mix(in srgb, var(--bg) 82%, transparent), transparent)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 14,
              color: "var(--navy)",
            }}
          >
            <span>9:41</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Bars />
              <Wifi />
              <Battery />
            </span>
          </div>

          {/* Scrollable content (stages fill this). Vertical scroll only; each
              stage wrapper clips its own horizontal overflow (Lex's halo) via
              `overflow-x: clip`, so this container never gains a horizontal
              scroll axis that focus-into-view could drift sideways. */}
          <div
            data-demo-scroll
            style={{
              position: "absolute",
              inset: 0,
              paddingTop: 52,
              overflowY: "auto",
              overflowX: "hidden",
              overscrollBehavior: "contain",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {children}
          </div>

          {/* Pinned bottom nav (outside the scroll) */}
          {footer}

          {/* Full-screen overlays (outside the scroll, above everything) */}
          {overlay}
        </div>
      </div>
    </div>
  );
}

function Bars() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden>
      {[2, 6, 10, 14].map((x, i) => (
        <rect key={x} x={x} y={10 - i * 2.6} width="3" height={2 + i * 2.6} rx="1" fill="var(--navy)" />
      ))}
    </svg>
  );
}
function Wifi() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden>
      <path d="M8 10.5a1.3 1.3 0 100-2.6 1.3 1.3 0 000 2.6Z" fill="var(--navy)" />
      <path d="M3.4 5.2a6.6 6.6 0 019.2 0M5.4 7.2a3.8 3.8 0 015.2 0" stroke="var(--navy)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function Battery() {
  return (
    <svg width="24" height="12" viewBox="0 0 24 12" fill="none" aria-hidden>
      <rect x="1" y="1.5" width="19" height="9" rx="2.5" stroke="var(--navy)" strokeWidth="1.2" opacity="0.5" />
      <rect x="2.6" y="3" width="13" height="6" rx="1.4" fill="var(--navy)" />
      <rect x="21" y="4" width="2" height="4" rx="1" fill="var(--navy)" opacity="0.5" />
    </svg>
  );
}
