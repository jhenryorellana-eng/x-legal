"use client";

import * as React from "react";

/**
 * BottomSheet — modal sheet con drag-to-close (DOC-01 §5.2).
 * Ported from the prototype `V2/UI Cliente/app` glossary/roster sheets
 * (Scrim `rgba(7,17,33,.5)` fadeIn + sheet `slideUp .32s cubic-bezier`,
 * handle pill, top radius 28px) and extended with a real drag-to-close
 * gesture: dragging the handle/header follows the pointer; releasing past
 * ~120px (or with downward velocity) dismisses, otherwise springs back.
 *
 * Accessibility: dialog semantics, Escape to close, scrim click to close,
 * focus moved into the sheet on open and restored on close. Respects
 * `prefers-reduced-motion` (no enter animation, no drag rubber-banding).
 */

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible title (rendered visually unless `hideHeader`). */
  title?: string;
  /** Optional supporting line under the title. */
  subtitle?: string;
  children: React.ReactNode;
  /** Hide the default header row (provide your own inside children). */
  hideHeader?: boolean;
  /** Sheet height; default auto (content), capped at 88vh. */
  height?: number | string;
  /** Scrim opacity (0–1). Default 0.5 per DOC-01 §5.2. */
  scrimOpacity?: number;
  /** Position absolutely inside the phone-frame instead of fixed. */
  absolute?: boolean;
}

const DISMISS_DISTANCE = 120; // px dragged before release dismisses
const DISMISS_VELOCITY = 0.6; // px/ms downward velocity that dismisses

export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  hideHeader = false,
  height,
  scrimOpacity = 0.5,
  absolute = false,
}: BottomSheetProps) {
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const prevFocus = React.useRef<HTMLElement | null>(null);
  const [drag, setDrag] = React.useState(0); // current drag offset (px)
  const dragState = React.useRef<{
    startY: number;
    lastY: number;
    lastT: number;
    velocity: number;
    active: boolean;
  }>({ startY: 0, lastY: 0, lastT: 0, velocity: 0, active: false });

  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Focus management + Escape to close.
  React.useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement as HTMLElement | null;
    const id = window.setTimeout(() => sheetRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("keydown", onKey);
      prevFocus.current?.focus?.();
    };
  }, [open, onClose]);

  // Reset drag whenever we (re)open.
  React.useEffect(() => {
    if (open) setDrag(0);
  }, [open]);

  if (!open) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    dragState.current = {
      startY: e.clientY,
      lastY: e.clientY,
      lastT: performance.now(),
      velocity: 0,
      active: true,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = dragState.current;
    if (!s.active) return;
    const dy = Math.max(0, e.clientY - s.startY); // only downward
    const now = performance.now();
    const dt = now - s.lastT;
    if (dt > 0) s.velocity = (e.clientY - s.lastY) / dt;
    s.lastY = e.clientY;
    s.lastT = now;
    setDrag(dy);
  };

  const onPointerUp = () => {
    const s = dragState.current;
    s.active = false;
    if (drag > DISMISS_DISTANCE || s.velocity > DISMISS_VELOCITY) {
      onClose();
    } else {
      setDrag(0); // spring back
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: absolute ? "absolute" : "fixed",
        inset: 0,
        maxWidth: absolute ? undefined : 430,
        margin: absolute ? undefined : "0 auto",
        zIndex: 45,
        background: `rgba(7,17,33,${scrimOpacity})`,
        animation: reduce ? undefined : "fadeIn 0.25s ease",
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={reduce ? undefined : "anim-slide-up"}
        style={{
          width: "100%",
          maxHeight: "88%",
          height,
          background: "var(--card)",
          borderRadius: "28px 28px 0 0",
          padding: "12px 24px 36px",
          overflowY: "auto",
          boxShadow: "0 -18px 50px rgba(7,17,33,0.28)",
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: dragState.current.active
            ? "none"
            : "transform 0.28s cubic-bezier(.2,.9,.3,1)",
          willChange: "transform",
          outline: "none",
        }}
      >
        {/* Drag handle — captures the close gesture */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            padding: "2px 0 14px",
            margin: "0 -24px",
            touchAction: "none",
            cursor: "grab",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 46,
              height: 5,
              borderRadius: 999,
              background: "var(--line)",
              margin: "0 auto",
            }}
          />
        </div>

        {!hideHeader && title && (
          <div style={{ marginBottom: 14 }}>
            <h3
              className="t-title"
              style={{
                margin: 0,
                fontSize: 20,
                color: "var(--navy)",
                fontWeight: 800,
              }}
            >
              {title}
            </h3>
            {subtitle && (
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: 15,
                  color: "var(--ink-2)",
                  fontWeight: 500,
                  lineHeight: 1.5,
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
