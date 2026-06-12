"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Icon } from "@/frontend/components/brand/icon";

/**
 * SidePanel — right-docked detail panel (DOC-01 §5.3).
 *
 * Fixed 400px panel that slides in from the right for contextual detail
 * (an appointment, a document, an audit entry) without leaving the list view
 * (DOC-53 §0.6). Built on Radix Dialog for focus trap + Escape + ARIA; the
 * panel itself is full-height with its own scroll region.
 */

export interface SidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  width?: number;
  children: React.ReactNode;
  /** Pinned footer (actions). */
  footer?: React.ReactNode;
}

export function SidePanel({
  open,
  onOpenChange,
  title,
  subtitle,
  width = 400,
  children,
  footer,
}: SidePanelProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(7,17,33,0.42)",
          }}
          className="anim-fade-in"
        />
        <DialogPrimitive.Content
          className="side-panel-content"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 61,
            width: "min(calc(100vw - 24px), " + width + "px)",
            display: "flex",
            flexDirection: "column",
            background: "var(--panel, var(--card))",
            boxShadow: "var(--shadow-lg)",
            borderLeft: "1px solid var(--line)",
            outline: "none",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "18px 20px",
              borderBottom: "1px solid var(--line-2, var(--line))",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <DialogPrimitive.Title
                style={{
                  margin: 0,
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 16,
                  color: "var(--ink)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {title}
              </DialogPrimitive.Title>
              {subtitle && (
                <DialogPrimitive.Description
                  style={{
                    margin: "3px 0 0",
                    fontSize: 13,
                    color: "var(--ink-2)",
                  }}
                >
                  {subtitle}
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

          {/* Scrollable body */}
          <div style={{ flex: 1, overflow: "auto", padding: "18px 20px" }}>
            {children}
          </div>

          {/* Pinned footer */}
          {footer && (
            <div
              style={{
                display: "flex",
                gap: 10,
                padding: "14px 20px",
                borderTop: "1px solid var(--line-2, var(--line))",
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
