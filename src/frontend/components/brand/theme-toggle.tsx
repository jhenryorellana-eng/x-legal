"use client";

import * as React from "react";
import { Icon } from "./icon";
import {
  applyTextScale,
  applyTheme,
  getStoredTextScale,
  getStoredTheme,
  type TextScale,
  type Theme,
} from "@/frontend/lib/theme";

const SCALE_OPTIONS: { value: TextScale; label: string }[] = [
  { value: "sm", label: "A−" },
  { value: "md", label: "A" },
  { value: "lg", label: "A+" },
];

/**
 * Theme + text-scale control (DOC-01 §4, §8.5).
 * Reads the current values from the DOM/localStorage after mount to stay in
 * sync with the no-flash bootstrap script.
 */
export function ThemeToggle() {
  const [theme, setTheme] = React.useState<Theme>("light");
  const [scale, setScale] = React.useState<TextScale>("md");

  React.useEffect(() => {
    setTheme(getStoredTheme());
    setScale(getStoredTextScale());
  }, []);

  function onTheme(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }
  function onScale(next: TextScale) {
    applyTextScale(next);
    setScale(next);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {/* Text scale */}
      <div
        role="group"
        aria-label="Tamaño de texto"
        style={{
          display: "inline-flex",
          background: "var(--card-alt)",
          borderRadius: 999,
          padding: 3,
          gap: 2,
        }}
      >
        {SCALE_OPTIONS.map((opt) => {
          const active = scale === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onScale(opt.value)}
              aria-pressed={active}
              style={{
                minWidth: 34,
                height: 30,
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                background: active ? "var(--accent)" : "transparent",
                color: active ? "var(--on-accent)" : "var(--ink-2)",
                fontFamily: "var(--font-title)",
                fontWeight: 800,
                fontSize: 13,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Theme switch */}
      <button
        type="button"
        onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
        aria-pressed={theme === "dark"}
        aria-label={theme === "dark" ? "Activar tema claro" : "Activar tema oscuro"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 40,
          padding: "0 14px",
          borderRadius: 999,
          border: "1px solid var(--line)",
          background: "var(--card)",
          color: "var(--ink)",
          cursor: "pointer",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 14,
        }}
      >
        <Icon
          name={theme === "dark" ? "sun" : "moon"}
          size={20}
          color="var(--accent)"
        />
        {theme === "dark" ? "Claro" : "Oscuro"}
      </button>
    </div>
  );
}
