"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

/**
 * Switch — staff toggle (DOC-01 §5.3).
 *
 * The desktop spec differs from the shadcn default: 44×25px track, white 21px
 * dot, ON = brand green, ~.18s animation. Built on Radix for keyboard + ARIA
 * correctness; the brand visuals come from inline token styles so it stays in
 * sync with light/dark/staff without fighting the shadcn theme.
 */

export interface DesktopSwitchProps
  extends Omit<
    React.ComponentProps<typeof SwitchPrimitive.Root>,
    "style" | "className"
  > {
  /** Accessible label (required when there is no adjacent <label>). */
  "aria-label"?: string;
}

export function Switch({
  checked,
  defaultChecked,
  ...props
}: DesktopSwitchProps) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      defaultChecked={defaultChecked}
      data-slot="staff-switch"
      style={
        {
          // 44×25 track (DOC-01 §5.3)
          width: 44,
          height: 25,
          flexShrink: 0,
          borderRadius: 999,
          border: "none",
          padding: 0,
          position: "relative",
          cursor: "pointer",
          transition: "background-color 0.18s var(--ease)",
          // off = neutral line, on = brand green
          backgroundColor: "var(--line)",
          outline: "none",
        } as React.CSSProperties
      }
      className="staff-switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        style={{
          display: "block",
          width: 21,
          height: 21,
          borderRadius: 999,
          background: "#fff",
          boxShadow: "0 1px 3px rgba(11,27,51,0.28)",
          transform: "translateX(2px)",
          transition: "transform 0.18s var(--ease)",
          willChange: "transform",
        }}
        className="staff-switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}
