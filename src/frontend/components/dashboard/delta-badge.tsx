import type { Delta } from "./format";

/**
 * DeltaBadge — standalone ↑/↓ period-over-period pill (green up / red down).
 * For places that show a delta outside a full KpiCard (table cells, section
 * headers). `invert` is already baked into the Delta's `dir` by `delta()`.
 */
export function DeltaBadge({ delta }: { delta?: Delta }) {
  if (!delta) return null;
  const up = delta.dir === "up";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 12,
        fontWeight: 800,
        padding: "2px 7px",
        borderRadius: 999,
        color: up ? "var(--green)" : "var(--red)",
        background: up
          ? "color-mix(in srgb, var(--green) 12%, transparent)"
          : "color-mix(in srgb, var(--red) 12%, transparent)",
      }}
    >
      {up ? "↑" : "↓"} {delta.label}
    </span>
  );
}
