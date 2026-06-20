"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";

/**
 * FABs de la app cliente (DOC-01 §5.2). Ported from the prototype
 * `V2/UI Cliente/app/ui.jsx → MessagingLauncher / LexFab`.
 *
 * - `MessagingLauncher`: pill flotante abajo-izquierda (left 16 / bottom 104),
 *   gradiente `accent→accent-deep`, icono `chat` en disco translúcido, etiqueta
 *   "Tu equipo", badge rojo = no leídos. NO es IA (RF-CLI-013).
 * - `LexFab`: FAB 64px circular abajo-derecha (right 16 / bottom 104), fondo
 *   card, Lex 52px, anillo dorado `ringPulse 2.6s`.
 *
 * Both can position absolutely inside a phone frame (`absolute`) or fixed to the
 * viewport (default), and respect the 430px content cap when fixed.
 */

interface FabPositioning {
  /** Position absolutely inside the phone frame instead of fixed to viewport. */
  absolute?: boolean;
}

export interface MessagingLauncherProps extends FabPositioning {
  /** Label, e.g. "Tu equipo" / "Your team". */
  label: string;
  /** Unread message count → red badge. 0/undefined hides it. */
  badge?: number;
  onClick?: () => void;
}

function fixedAnchor(side: "left" | "right", absolute: boolean) {
  // When fixed, anchor to the 430px content column edges; when absolute,
  // anchor to the phone frame edges.
  if (absolute) return { [side]: 16 } as React.CSSProperties;
  return {
    [side]: "max(16px, calc(50vw - 215px + 16px))",
  } as React.CSSProperties;
}

export function MessagingLauncher({
  label,
  badge = 0,
  onClick,
  absolute = false,
}: MessagingLauncherProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: absolute ? "absolute" : "fixed",
        ...fixedAnchor("left", absolute),
        bottom: "calc(104px + var(--safe-bottom))",
        zIndex: 32,
        height: 56,
        padding: "0 16px 0 6px",
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        background: "linear-gradient(120deg, var(--accent), var(--accent-deep))",
        boxShadow:
          "0 12px 28px color-mix(in srgb, var(--accent) 33%, transparent), 0 2px 6px rgba(0,0,0,0.2)",
        display: "flex",
        alignItems: "center",
        gap: 9,
      }}
    >
      <span
        style={{
          position: "relative",
          width: 44,
          height: 44,
          borderRadius: 999,
          background: "rgba(255,255,255,0.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="chat" size={24} color="#fff" stroke={2.3} />
        {badge > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              minWidth: 20,
              height: 20,
              padding: "0 5px",
              borderRadius: 999,
              background: "var(--red)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 0 2.5px rgba(255,255,255,0.95)",
            }}
          >
            {badge}
          </span>
        )}
      </span>
      <span
        style={{
          color: "#fff",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 14.5,
          paddingRight: 2,
        }}
      >
        {label}
      </span>
    </button>
  );
}

export interface LexFabProps extends FabPositioning {
  /** Accessible label, e.g. "Ayuda de Lex" / "Lex help". */
  label: string;
  onClick?: () => void;
}

export function LexFab({ label, onClick, absolute = false }: LexFabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        position: absolute ? "absolute" : "fixed",
        ...fixedAnchor("right", absolute),
        bottom: "calc(104px + var(--safe-bottom))",
        zIndex: 32,
        width: 64,
        height: 64,
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        padding: 0,
        background: "var(--card)",
        boxShadow:
          "0 12px 28px rgba(0,0,0,0.28), 0 0 0 4px rgba(255,198,41,0.20)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "visible",
      }}
    >
      <span
        aria-hidden="true"
        className="anim-ring-pulse"
        style={{
          position: "absolute",
          inset: -3,
          borderRadius: 999,
        }}
      />
      <picture>
        <source srcSet="/assets/lex.webp" type="image/webp" />
        <img
          src="/assets/lex.gif"
          alt=""
          style={{ width: 52, height: 52, objectFit: "contain" }}
        />
      </picture>
    </button>
  );
}
