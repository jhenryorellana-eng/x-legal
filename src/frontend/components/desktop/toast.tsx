"use client";

import * as React from "react";
import { Toaster as Sonner, toast } from "sonner";
import { getStoredTheme, type Theme } from "@/frontend/lib/theme";

/**
 * Toast — sonner themed with brand tokens (DOC-01 §5.3, DOC-50 SOT-4).
 *
 * Single toaster per shell (DOC-50 §11). Background = `--panel/--card`, success
 * = `--green`, error = `--red`. Position: top-right on desktop (the staff
 * surface is desktop-only). The theme follows our own `data-theme` attribute
 * (this app drives theme by attribute, not next-themes).
 *
 * Re-exports `toast` so callers do `import { toast } from "…/desktop/toast"`.
 */

export { toast };

export function BrandToaster() {
  const [theme, setTheme] = React.useState<Theme>("light");

  React.useEffect(() => {
    setTheme(getStoredTheme());
    // Keep in sync with the ThemeToggle (which mutates <html data-theme>).
    const html = document.documentElement;
    const observer = new MutationObserver(() => {
      const attr = html.getAttribute("data-theme");
      if (attr === "dark" || attr === "light") setTheme(attr);
    });
    observer.observe(html, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      theme={theme}
      position="top-right"
      richColors
      toastOptions={{
        style: {
          background: "var(--panel, var(--card))",
          border: "1px solid var(--line)",
          color: "var(--ink)",
          borderRadius: "var(--r-md)",
          boxShadow: "var(--shadow-md)",
          fontFamily: "var(--font-body)",
        },
      }}
      style={
        {
          "--success-bg": "var(--green-soft)",
          "--success-text": "var(--green)",
          "--success-border": "color-mix(in srgb, var(--green) 30%, transparent)",
          "--error-bg": "var(--red-soft)",
          "--error-text": "var(--red)",
          "--error-border": "color-mix(in srgb, var(--red) 30%, transparent)",
        } as React.CSSProperties
      }
    />
  );
}
