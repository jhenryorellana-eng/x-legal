import * as React from "react";
import { Icon, type IconName } from "./icon";

/**
 * Timeline (DOC-01 §5.1).
 * Left rail: 38–44px dot with a radial gradient per event type + a vertical
 * `--line` connector; right card with an accent-border hover. Items group by
 * day (uppercase `ink-3` label).
 */

export type TimelineEventType = "info" | "success" | "warning" | "call";

const EVENT_HUE: Record<TimelineEventType, string> = {
  info: "var(--accent)",
  success: "var(--green)",
  warning: "var(--gold-deep)",
  call: "var(--gold)",
};

export interface TimelineItem {
  id: string;
  type: TimelineEventType;
  icon: IconName;
  title: string;
  meta?: string;
  body?: React.ReactNode;
}

export interface TimelineGroup {
  /** Day label, e.g. "HOY" / "AYER" / "12 JUN". */
  label: string;
  items: TimelineItem[];
}

export interface TimelineProps {
  groups: TimelineGroup[];
}

export function Timeline({ groups }: TimelineProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {groups.map((group) => (
        <div key={group.label}>
          <div
            style={{
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 11,
              letterSpacing: "0.7px",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              padding: "0 0 8px 2px",
            }}
          >
            {group.label}
          </div>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {group.items.map((item, i) => {
              const hue = EVENT_HUE[item.type];
              const last = i === group.items.length - 1;
              return (
                <li
                  key={item.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    paddingBottom: last ? 0 : 14,
                  }}
                >
                  {/* Rail: dot + connector */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 999,
                        display: "grid",
                        placeItems: "center",
                        background: `radial-gradient(circle at 36% 30%, color-mix(in srgb, ${hue} 22%, transparent), color-mix(in srgb, ${hue} 7%, transparent) 70%)`,
                        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hue} 22%, transparent)`,
                      }}
                    >
                      <Icon name={item.icon} size={20} color={hue} />
                    </span>
                    {!last && (
                      <span
                        aria-hidden="true"
                        style={{
                          flex: 1,
                          width: 2,
                          marginTop: 4,
                          background: "var(--line)",
                          borderRadius: 999,
                        }}
                      />
                    )}
                  </div>
                  {/* Card */}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: "var(--card)",
                      borderRadius: "var(--r-md)",
                      border: "1px solid var(--line)",
                      padding: "12px 14px",
                      transition: "border-color 0.16s var(--ease)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-title)",
                          fontWeight: 800,
                          fontSize: 15,
                          color: "var(--ink)",
                        }}
                      >
                        {item.title}
                      </span>
                      {item.meta && (
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--ink-2)",
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.meta}
                        </span>
                      )}
                    </div>
                    {item.body && (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 14,
                          color: "var(--ink-2)",
                          lineHeight: 1.5,
                        }}
                      >
                        {item.body}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
