"use client";

/**
 * Configuración — sales account & panel prefs (DOC-52 §8, RF-VAN-055).
 *
 * Profile card, appearance (dark mode + accent swatches), Lex bubbles toggle,
 * language ES/EN. Theme/text-scale via the shared theme lib (localStorage,
 * no-flash). Locale change → action (users.locale + cookie + refresh). Accent
 * and Lex bubbles are LOCAL UI prefs (localStorage, no table) per RF-VAN-055.
 */

import * as React from "react";
import { MSym } from "../shared/msym";
import { Chip } from "../shared/ui";
import { Switch } from "@/frontend/components/desktop";
import {
  applyTheme,
  getStoredTheme,
  applyTextScale,
  getStoredTextScale,
  type TextScale,
} from "@/frontend/lib/theme";
import { useLexPrefs } from "../shared/lex-prefs";
import { useToast } from "../shared/toast-bridge";

const ACCENTS = ["#2F6BFF", "#E4002B", "#FFC629", "#1BB673", "#8B5CF6", "#002855"];

export interface ConfigStrings {
  title: string;
  sub: string;
  name: string;
  role: string;
  email: string;
  tzChip: string;
  edit: string;
  appearance: string;
  darkMode: string;
  darkModeSub: string;
  textSize: string;
  accent: string;
  lexTitle: string;
  lexBubbles: string;
  lexBubblesSub: string;
  language: string;
  spanish: string;
  english: string;
  saved: string;
}

export interface ConfigActions {
  setLocale: (locale: "es" | "en") => Promise<{ ok: boolean }>;
}

export interface ConfiguracionViewProps {
  strings: ConfigStrings;
  locale: "es" | "en";
  actions: ConfigActions;
}

export function ConfiguracionView({ strings, locale, actions }: ConfiguracionViewProps) {
  const toast = useToast();
  const [dark, setDark] = React.useState(false);
  const [scale, setScale] = React.useState<TextScale>("md");
  const [accent, setAccent] = React.useState(ACCENTS[0]);
  const { bubbles, setBubbles } = useLexPrefs();

  React.useEffect(() => {
    setDark(getStoredTheme() === "dark");
    setScale(getStoredTextScale());
    try {
      const a = localStorage.getItem("ulp-accent");
      if (a) setAccent(a);
    } catch {
      /* no-op */
    }
  }, []);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    applyTheme(next ? "dark" : "light");
  };

  const pickScale = (s: TextScale) => {
    setScale(s);
    applyTextScale(s);
  };

  const pickAccent = (a: string) => {
    setAccent(a);
    try {
      localStorage.setItem("ulp-accent", a);
    } catch {
      /* no-op */
    }
    document.documentElement.style.setProperty("--accent", a);
  };

  const setLang = async (l: "es" | "en") => {
    if (l === locale) return;
    await actions.setLocale(l);
    window.location.reload();
  };

  return (
    <div className="fade-up" style={{ maxWidth: 760 }}>
      <div className="v-head">
        <div>
          <h1 className="v-title">{strings.title}</h1>
          <div className="v-sub">{strings.sub}</div>
        </div>
      </div>

      {/* Profile */}
      <div className="vcard vcard-pad" style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <div className="client-av" style={{ width: 56, height: 56, background: "linear-gradient(135deg, var(--brand-gold), var(--brand-red))" }}>
          V
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: "var(--ink)" }}>{strings.name}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-2)", marginTop: 2 }}>
            {strings.role} · {strings.email}
          </div>
          <div style={{ marginTop: 8 }}>
            <Chip tone="blue" icon="schedule">{strings.tzChip}</Chip>
          </div>
        </div>
        <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => toast.info(strings.edit)}>
          {strings.edit}
        </button>
      </div>

      {/* Appearance */}
      <div className="vcard vcard-pad" style={{ marginBottom: 16 }}>
        <div className="vcard-title" style={{ marginBottom: 16 }}>
          <MSym name="palette" size={20} />
          {strings.appearance}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 16, borderBottom: "1px solid var(--line-2)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--ink)" }}>{strings.darkMode}</div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 700 }}>{strings.darkModeSub}</div>
          </div>
          <Switch checked={dark} onCheckedChange={toggleDark} aria-label={strings.darkMode} />
        </div>
        <div style={{ paddingTop: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--ink)", marginBottom: 12 }}>{strings.accent}</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {ACCENTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => pickAccent(a)}
                aria-label={`${strings.accent} ${a}`}
                aria-pressed={accent === a}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: a,
                  border: "none",
                  cursor: "pointer",
                  boxShadow: accent === a ? "0 0 0 3px var(--ink)" : "none",
                }}
              />
            ))}
          </div>
        </div>
        <div style={{ paddingTop: 16, marginTop: 16, borderTop: "1px solid var(--line-2)" }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--ink)", marginBottom: 12 }}>{strings.textSize}</div>
          <div style={{ display: "inline-flex", background: "var(--card-alt)", borderRadius: 999, padding: 3, gap: 2 }}>
            {(["sm", "md", "lg"] as const).map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => pickScale(s)}
                aria-pressed={scale === s}
                aria-label={`${strings.textSize} ${["A−", "A", "A+"][i]}`}
                style={{
                  minWidth: 44,
                  height: 32,
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  background: scale === s ? "var(--accent)" : "transparent",
                  color: scale === s ? "var(--on-accent)" : "var(--ink-2)",
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 13,
                }}
              >
                {["A−", "A", "A+"][i]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lex */}
      <div className="vcard vcard-pad" style={{ marginBottom: 16 }}>
        <div className="vcard-title" style={{ marginBottom: 16 }}>
          <MSym name="auto_awesome" size={20} />
          {strings.lexTitle}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: "var(--ink)" }}>{strings.lexBubbles}</div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 700 }}>{strings.lexBubblesSub}</div>
          </div>
          <Switch checked={bubbles} onCheckedChange={setBubbles} aria-label={strings.lexBubbles} />
        </div>
      </div>

      {/* Language */}
      <div className="vcard vcard-pad">
        <div className="vcard-title" style={{ marginBottom: 16 }}>
          <MSym name="translate" size={20} />
          {strings.language}
        </div>
        <div className="seg">
          <button type="button" className={locale === "es" ? "on" : ""} onClick={() => setLang("es")}>
            {strings.spanish}
          </button>
          <button type="button" className={locale === "en" ? "on" : ""} onClick={() => setLang("en")}>
            {strings.english}
          </button>
        </div>
      </div>
    </div>
  );
}
