"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Icon } from "@/frontend/components/brand/icon";

/**
 * Modal — centered staff dialog (DOC-01 §5.3).
 *
 * Radius 20px panel, `--shadow-lg`, scrim. Built on Radix Dialog so focus trap,
 * portal, Escape and ARIA come for free (DOC-50 §5 rule 2). Supports stacking
 * (modal over modal) because each instance portals its own overlay — opening a
 * second Modal renders above the first (DOC-53 §0.6 "Modal apilable").
 *
 * Controlled via `open` / `onOpenChange`. Children are the body; pass `footer`
 * for the action row.
 */

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Tints the title accent rail (e.g. var(--red) for destructive flows). */
  tone?: string;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  tone = "var(--accent)",
  width = 520,
  children,
  footer,
}: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(7,17,33,0.5)",
            backdropFilter: "blur(2px)",
          }}
          className="anim-fade-in"
        />
        <DialogPrimitive.Content
          // `surface-staff`: the dialog portals to <body>, escaping the staff
          // shell's `.surface-staff` scope, so its component classes (.vfield,
          // .cat-chip, .vbtn …) would otherwise render unstyled. `anim-modal-pop`
          // keeps the centering transform (plain `anim-bubin` de-centered it).
          className="surface-staff anim-modal-pop"
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            zIndex: 61,
            width: "min(calc(100vw - 32px), " + width + "px)",
            maxHeight: "calc(100vh - 48px)",
            overflow: "auto",
            background: "var(--panel, var(--card))",
            borderRadius: 20,
            boxShadow: "var(--shadow-lg)",
            border: "1px solid var(--line)",
            outline: "none",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 14,
              padding: "22px 22px 0",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 4,
                alignSelf: "stretch",
                minHeight: 30,
                borderRadius: 999,
                background: tone,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <DialogPrimitive.Title
                style={{
                  margin: 0,
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 18,
                  color: "var(--ink)",
                  letterSpacing: "-0.01em",
                }}
              >
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description
                  style={{
                    margin: "6px 0 0",
                    fontSize: 14,
                    lineHeight: 1.5,
                    color: "var(--ink-2)",
                  }}
                >
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Cerrar"
              style={{
                display: "inline-grid",
                placeItems: "center",
                width: 34,
                height: 34,
                borderRadius: 999,
                border: "none",
                background: "var(--chip)",
                color: "var(--ink-2)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <Icon name="x" size={18} color="currentColor" />
            </DialogPrimitive.Close>
          </div>

          {/* Body */}
          <div style={{ padding: "18px 22px 4px" }}>{children}</div>

          {/* Footer */}
          {footer && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                padding: "12px 22px 22px",
              }}
            >
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
