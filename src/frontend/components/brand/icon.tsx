import * as React from "react";

/**
 * Brand icon set (DOC-01 §6) — ported verbatim from the prototype
 * `V2/UI Cliente/app/ui.jsx` (Material-style, rounded, stroke, `currentColor`).
 * Icons are ALWAYS accompanied by a text label (prototype rule §6).
 *
 * The set covers the canonical names listed in DOC-01 §6 plus the prototype's
 * navigational `arrowL` and media `play` (present in the source of truth).
 */

export const ICON_NAMES = [
  "home",
  "calendar",
  "doc",
  "form",
  "grid",
  "lock",
  "check",
  "camera",
  "mic",
  "video",
  "upload",
  "info",
  "chevR",
  "chevL",
  "chevD",
  "heart",
  "fire",
  "clap",
  "send",
  "globe",
  "whatsapp",
  "phone",
  "mail",
  "edit",
  "trophy",
  "star",
  "arrowL",
  "play",
  "bell",
  "shield",
  "zoom",
  "sparkle",
  "map",
  "user",
  "clock",
  "help",
  "gear",
  "moon",
  "sun",
  "chat",
  "card",
  "wallet",
  "briefcase",
  "search",
  "copy",
  "megaphone",
  "external",
  "x",
  "plus",
  "route",
  "clip",
  "dollar",
  "bolt",
  "family",
  "scale",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  stroke?: number;
  /** Fill for the few glyphs that support it (heart, star, fire, bolt, play, sparkle). */
  fill?: string;
  className?: string;
  /** Accessible label; when omitted the icon is treated as decorative. */
  "aria-label"?: string;
}

export function Icon({
  name,
  size = 24,
  color = "currentColor",
  stroke = 2.2,
  fill,
  className,
  "aria-label": ariaLabel,
}: IconProps) {
  const p = {
    fill: "none",
    stroke: color,
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const paths: Record<IconName, React.ReactNode> = {
    home: (
      <>
        <path d="M4 11.5 12 5l8 6.5" {...p} />
        <path d="M6 10.5V19h12v-8.5" {...p} />
        <path d="M10 19v-4.5h4V19" {...p} />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5.5" width="16" height="15" rx="3.5" {...p} />
        <path d="M8 3.5v4M16 3.5v4M4 10h16" {...p} />
      </>
    ),
    doc: (
      <>
        <path
          d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"
          {...p}
        />
        <path d="M13 3.5V8h4.5M9 13h6M9 16.5h6" {...p} />
      </>
    ),
    form: (
      <>
        <path d="M5 4.5h14v15H5z" {...p} />
        <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" {...p} />
      </>
    ),
    grid: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="2" {...p} />
        <rect x="13" y="4" width="7" height="7" rx="2" {...p} />
        <rect x="4" y="13" width="7" height="7" rx="2" {...p} />
        <rect x="13" y="13" width="7" height="7" rx="2" {...p} />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10.5" width="14" height="9.5" rx="3" {...p} />
        <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...p} />
        <circle cx="12" cy="15" r="1.4" fill={color} stroke="none" />
      </>
    ),
    check: <path d="M5 12.5 10 17.5 19 7" {...p} />,
    camera: (
      <>
        <path
          d="M4 8.5h3l1.6-2.2h6.8L17 8.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z"
          {...p}
        />
        <circle cx="12" cy="13.5" r="3.4" {...p} />
      </>
    ),
    mic: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" {...p} />
        <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" {...p} />
      </>
    ),
    video: (
      <>
        <rect x="3" y="6.5" width="12" height="11" rx="3" {...p} />
        <path d="M15 10.5 21 7v10l-6-3.5" {...p} />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V5M8 9l4-4 4 4" {...p} />
        <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" {...p} />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="8.5" {...p} />
        <path d="M12 11v5.5" {...p} />
        <circle cx="12" cy="7.8" r="1.1" fill={color} stroke="none" />
      </>
    ),
    chevR: <path d="M9 5l7 7-7 7" {...p} />,
    chevL: <path d="M15 5l-7 7 7 7" {...p} />,
    chevD: <path d="M5 9l7 7 7-7" {...p} />,
    heart: (
      <path
        d="M12 20s-7-4.6-7-9.4A3.8 3.8 0 0 1 12 7.5 3.8 3.8 0 0 1 19 10.6C19 15.4 12 20 12 20Z"
        fill={fill || "none"}
        stroke={color}
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
    ),
    fire: (
      <path
        d="M12 3s4 3.5 4 8a4 4 0 0 1-8 0c0-1.5.8-2.8.8-2.8S7 9.5 7 12.5a5 5 0 0 0 10 0C17 7 12 3 12 3Z"
        fill={fill || "none"}
        stroke={color}
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
    ),
    clap: (
      <>
        <path d="M8 11 6 8.5a1.4 1.4 0 0 1 2.2-1.7l2 2.4" {...p} />
        <path d="M10 9 8.3 6.6a1.4 1.4 0 0 1 2.3-1.6L13 8" {...p} />
        <path
          d="M16.5 9.5 13 5.2A1.4 1.4 0 0 1 15.2 3.5l3.5 5c1.5 2.2 1 5.2-1 6.8-2.2 1.8-5 1.4-6.8-.6L7 16"
          {...p}
        />
      </>
    ),
    send: <path d="M5 12 20 5l-4 14-4-6-7-1Z" {...p} />,
    globe: (
      <>
        <circle cx="12" cy="12" r="8.5" {...p} />
        <path
          d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17"
          {...p}
        />
      </>
    ),
    whatsapp: (
      <>
        <path d="M12 4a8 8 0 0 0-6.9 12L4 20l4.2-1.1A8 8 0 1 0 12 4Z" {...p} />
        <path
          d="M9.2 8.8c.2 2.4 2.6 4.8 5 5 .8.1 1.4-.6 1.4-1.3l-1.8-.8-.9.8c-.9-.4-1.7-1.2-2.1-2.1l.8-.9-.8-1.8c-.7 0-1.4.5-1.6 1.3Z"
          fill={color}
          stroke="none"
        />
      </>
    ),
    phone: (
      <path
        d="M6 4h3l1.5 4-2 1.5a11 11 0 0 0 4.5 4.5L15 16l4 1.5V20a1.5 1.5 0 0 1-1.6 1.5C10.5 21 3 13.5 3 6.6 3 5.7 3.7 4 5 4Z"
        {...p}
      />
    ),
    mail: (
      <>
        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" {...p} />
        <path d="m4.5 7.5 7.5 5.5 7.5-5.5" {...p} />
      </>
    ),
    edit: (
      <>
        <path d="M5 19h3l9-9-3-3-9 9v3Z" {...p} />
        <path d="M14 6.5 17.5 10" {...p} />
      </>
    ),
    trophy: (
      <>
        <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" {...p} />
        <path
          d="M7 5H4.5v1.5A2.5 2.5 0 0 0 7 9M17 5h2.5v1.5A2.5 2.5 0 0 1 17 9M9.5 13h5l-.5 4h-4l-.5-4ZM8 20h8"
          {...p}
        />
      </>
    ),
    star: (
      <path
        d="M12 3.5 14.3 9l5.7.5-4.3 3.8 1.3 5.7L12 16l-5 3 1.3-5.7L4 9.5 9.7 9 12 3.5Z"
        fill={fill || "none"}
        stroke={color}
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
    ),
    arrowL: <path d="M19 12H5M11 6l-6 6 6 6" {...p} />,
    play: (
      <path
        d="M8 5.5v13l11-6.5-11-6.5Z"
        fill={fill || color}
        stroke={color}
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
    ),
    bell: (
      <>
        <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5L6 16.5Z" {...p} />
        <path d="M10 19.5a2 2 0 0 0 4 0" {...p} />
      </>
    ),
    shield: (
      <>
        <path
          d="M12 3.5 19 6v5c0 4.5-3 7.8-7 9.5C8 18.8 5 15.5 5 11V6l7-2.5Z"
          {...p}
        />
        <path d="M9 11.5 11 13.5 15 9.5" {...p} />
      </>
    ),
    zoom: (
      <>
        <rect x="3" y="6.5" width="13" height="11" rx="3" {...p} />
        <path d="M16 10.5 21 7v10l-5-3.5" {...p} />
      </>
    ),
    sparkle: (
      <path
        d="M12 3.5c.6 3.8 1.7 4.9 5.5 5.5-3.8.6-4.9 1.7-5.5 5.5-.6-3.8-1.7-4.9-5.5-5.5 3.8-.6 4.9-1.7 5.5-5.5Z"
        fill={fill || color}
        stroke="none"
      />
    ),
    map: (
      <>
        <path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z" {...p} />
        <path d="M9 4v14M15 6v14" {...p} />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8.5" r="3.8" {...p} />
        <path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6" {...p} />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8.5" {...p} />
        <path d="M12 7.5V12l3 2" {...p} />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="8.5" {...p} />
        <path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 1.8-2 3.2" {...p} />
        <circle cx="12" cy="17" r="1.1" fill={color} stroke="none" />
      </>
    ),
    gear: (
      <>
        <circle cx="12" cy="12" r="3.2" {...p} />
        <path
          d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8M18.4 18.4l-1.8-1.8M7.4 7.4 5.6 5.6"
          {...p}
        />
      </>
    ),
    moon: (
      <path
        d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"
        {...p}
      />
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" {...p} />
        <path
          d="M12 2v2.5M12 19.5V22M22 12h-2.5M4.5 12H2M19 5l-1.8 1.8M6.8 17.2 5 19M19 19l-1.8-1.8M6.8 6.8 5 5"
          {...p}
        />
      </>
    ),
    chat: (
      <>
        <path
          d="M4 6.5a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H9l-4 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5v-7Z"
          {...p}
        />
        <path d="M8.5 10h7M8.5 12.8h4" {...p} />
      </>
    ),
    card: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="3" {...p} />
        <path d="M3 10h18M7 14.5h3" {...p} />
      </>
    ),
    wallet: (
      <>
        <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a2 2 0 0 1 2 2v.5" {...p} />
        <path
          d="M4 7.5V17a2.5 2.5 0 0 0 2.5 2.5H18a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H6.5"
          {...p}
        />
        <circle cx="16.5" cy="12.5" r="1.3" fill={color} stroke="none" />
      </>
    ),
    briefcase: (
      <>
        <rect x="3.5" y="7.5" width="17" height="12" rx="3" {...p} />
        <path
          d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 12.5h17"
          {...p}
        />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" {...p} />
        <path d="m20 20-3.6-3.6" {...p} />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="11" height="11" rx="2.5" {...p} />
        <path d="M5 16V6.5A2.5 2.5 0 0 1 7.5 4H15" {...p} />
      </>
    ),
    megaphone: (
      <path
        d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H7l1 4h2l-1-4 8 3.5V6L8 10H5.5A1.5 1.5 0 0 0 4 11.5Z"
        {...p}
      />
    ),
    external: (
      <>
        <path d="M14 5h5v5M19 5l-8 8" {...p} />
        <path
          d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"
          {...p}
        />
      </>
    ),
    x: <path d="M6 6 18 18M18 6 6 18" {...p} />,
    plus: <path d="M12 5v14M5 12h14" {...p} />,
    route: (
      <>
        <circle cx="6" cy="18" r="2.5" {...p} />
        <circle cx="18" cy="6" r="2.5" {...p} />
        <path d="M8.5 18H14a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5" {...p} />
      </>
    ),
    clip: (
      <path
        d="M16 7 9 14a2.5 2.5 0 0 0 3.5 3.5l7-7a4.5 4.5 0 0 0-6.4-6.4l-7 7a6.5 6.5 0 0 0 9.2 9.2L18 18"
        {...p}
      />
    ),
    dollar: (
      <path
        d="M12 3v18M15.5 7.5C15.5 6 14 5 12 5s-3.5 1-3.5 2.7c0 4 7 2.3 7 6.3 0 1.7-1.5 3-3.5 3s-3.5-1.3-3.5-3"
        {...p}
      />
    ),
    bolt: (
      <path
        d="M13 3 5 13h5l-1 8 8-10h-5l1-8Z"
        fill={fill || "none"}
        stroke={color}
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
    ),
    family: (
      <>
        <circle cx="8" cy="8" r="2.8" {...p} />
        <circle cx="16.5" cy="9" r="2.3" {...p} />
        <path
          d="M3.5 19c0-2.8 2-4.8 4.5-4.8s4.5 2 4.5 4.8M14 19c0-2.3 1.3-4 3.2-4S20.5 16.7 20.5 19"
          {...p}
        />
      </>
    ),
    scale: (
      <path
        d="M12 4v16M7 20h10M5 8h14M5 8l-2.5 5a2.5 2.5 0 0 0 5 0L5 8ZM19 8l-2.5 5a2.5 2.5 0 0 0 5 0L19 8ZM12 4a1.4 1.4 0 1 0 0 .01"
        {...p}
      />
    ),
  };

  const decorative = !ariaLabel;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ display: "block", flexShrink: 0 }}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={ariaLabel}
    >
      {paths[name]}
    </svg>
  );
}
