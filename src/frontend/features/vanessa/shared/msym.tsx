/**
 * MSym — Material Symbols Rounded glyph (DOC-52 §0.1, DOC-01 §6).
 *
 * The Vanessa prototype (`V2/UI Vanessa`) uses Material Symbols Rounded as its
 * icon vocabulary (priority_high, view_kanban, today, checklist, …) which is
 * far richer than the brand Icon set. To stay a faithful replica we render the
 * named glyph via the `material-symbols-rounded` ligature class; the font is
 * loaded once by `<MaterialSymbolsFont />` in the panel/preview layout.
 *
 * Presentational, SSR-safe, no client JS.
 */

import * as React from "react";

export interface MSymProps {
  /** Material Symbols Rounded ligature name (e.g. "priority_high"). */
  name: string;
  size?: number;
  /** Filled glyph (FILL 1) — used for active/selected affordances. */
  fill?: boolean;
  weight?: number;
  color?: string;
  style?: React.CSSProperties;
  className?: string;
  title?: string;
}

export function MSym({
  name,
  size = 20,
  fill = false,
  weight = 500,
  color,
  style,
  className,
  title,
}: MSymProps) {
  return (
    <span
      className={`material-symbols-rounded${className ? ` ${className}` : ""}`}
      aria-hidden={title ? undefined : true}
      title={title}
      role={title ? "img" : undefined}
      aria-label={title}
      style={{
        fontSize: size,
        color,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 24`,
        lineHeight: 1,
        userSelect: "none",
        flex: "none",
        ...style,
      }}
    >
      {name}
    </span>
  );
}

/**
 * Loads the Material Symbols Rounded variable font once. Rendered in the staff
 * panel layout (and the dev preview). Uses the standard Google Fonts CDN link;
 * the variable axes match the prototype's `font-variation-settings`.
 */
export function MaterialSymbolsFont() {
  return (
    // eslint-disable-next-line @next/next/no-page-custom-font -- single staff-panel font, scoped load
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
    />
  );
}
