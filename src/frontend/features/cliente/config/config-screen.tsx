"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/frontend/components/brand/icon";
import { IconTile } from "@/frontend/components/brand/icon-tile";
import { Card } from "@/frontend/components/brand/card";
import {
  applyTheme,
  applyTextScale,
  getStoredTheme,
  getStoredTextScale,
  type TextScale,
  type Theme,
} from "@/frontend/lib/theme";
import { usePushNotifications } from "@/frontend/features/notifications/use-push-notifications";
import type { BrowserPushSubscription } from "@/frontend/features/notifications/push-helpers";

type AR = { success: true } | { success: false; error: { code: string; message: string } };

export interface ConfigPrefs {
  messages: boolean;
  appointment_reminders: boolean;
  payment_reminders: boolean;
  case_updates: boolean;
}

export interface ConfigPushProps {
  vapidPublicKey: string | undefined;
  registerAction: (input: BrowserPushSubscription & { platform?: string }) => Promise<AR>;
  removeAction: (endpoint: string) => Promise<AR>;
}

/**
 * ConfigScreen — `/config` · nivel CUENTA (DOC-51 §11, prototype `screens4.jsx →
 * SettingsScreen`).
 *
 * Theme + text-scale persist via the theme lib (localStorage + <html> attrs, the
 * no-flash bootstrap). Language sets the `ulp-locale` cookie and reloads so SSR
 * re-renders in the new language (next-intl "without routing"). Notification
 * switches are UI-only in F2 (the preferences action arrives with PS-2/API-NOT-05).
 */

export interface ConfigLabels {
  backCases: string;
  title: string;
  appearance: string;
  darkMode: string;
  on: string;
  off: string;
  textSize: string;
  language: string;
  notifications: string;
  notifMessages: string;
  notifMeetings: string;
  notifPayments: string;
  notifUpdates: string;
  notifPush: string;
  notifPushAlert: string;
  notifPushUnsupported: string;
  notifPushDenied: string;
  myAccount: string;
  myDetails: string;
  myDetailsSub: string;
  help: string;
  helpSub: string;
  signOut: string;
  soon: string;
}

const TEXT_SIZES: { value: TextScale; label: string; size: number }[] = [
  { value: "sm", label: "A", size: 15 },
  { value: "md", label: "A", size: 18 },
  { value: "lg", label: "A", size: 22 },
];

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="mp-tap"
      style={{
        width: 54,
        height: 31,
        borderRadius: 999,
        background: on ? "var(--accent)" : "var(--line)",
        position: "relative",
        transition: "background 0.25s",
        flexShrink: 0,
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 26 : 3,
          width: 25,
          height: 25,
          borderRadius: 999,
          background: "#fff",
          boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
          transition: "left 0.25s",
        }}
      />
    </button>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 800,
        color: "var(--ink-3)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        margin: "4px 4px 10px",
      }}
    >
      {children}
    </div>
  );
}

export function ConfigScreen({
  initialLocale,
  signOut,
  labels,
  initialPrefs,
  updatePrefs,
  push,
  setLocale,
}: {
  initialLocale: "es" | "en";
  signOut: () => Promise<void>;
  labels: ConfigLabels;
  initialPrefs: ConfigPrefs;
  /** Persists a single category toggle (DOC-47 §5.3 updatePreferences). */
  updatePrefs: (patch: Partial<ConfigPrefs>) => Promise<void>;
  push: ConfigPushProps;
  /** Persists the UI language to users.locale + ulp-locale cookie (DOC-24 i18n). */
  setLocale: (locale: "es" | "en") => Promise<{ ok: boolean }>;
}) {
  const [theme, setTheme] = React.useState<Theme>("light");
  const [scale, setScale] = React.useState<TextScale>("md");
  const [lang, setLang] = React.useState<"es" | "en">(initialLocale);
  const [notif, setNotif] = React.useState({
    msg: initialPrefs.messages,
    cita: initialPrefs.appointment_reminders,
    pago: initialPrefs.payment_reminders,
    avance: initialPrefs.case_updates,
  });
  const dark = theme === "dark";

  // Web Push device subscription (DOC-24). The toggle requests permission +
  // subscribes; logout unsubscribes (handled in handleSignOut below).
  const pushState = usePushNotifications({
    vapidPublicKey: push.vapidPublicKey,
    registerAction: push.registerAction,
    removeAction: push.removeAction,
  });

  // Map a category toggle → its preference key + persist.
  const PREF_KEY: Record<"msg" | "cita" | "pago" | "avance", keyof ConfigPrefs> = {
    msg: "messages",
    cita: "appointment_reminders",
    pago: "payment_reminders",
    avance: "case_updates",
  };
  function toggleNotif(k: "msg" | "cita" | "pago" | "avance") {
    const next = !notif[k];
    setNotif((n) => ({ ...n, [k]: next }));
    void updatePrefs({ [PREF_KEY[k]]: next });
  }

  async function handleSignOut() {
    // Deassociate this device's push subscription before ending the session.
    try { await pushState.unsubscribe(); } catch { /* best-effort */ }
    // DOC-24 §2.7 — purge runtime caches that may hold case data (the static
    // app-shell precache is kept; it carries no session data).
    try {
      if (typeof caches !== "undefined") {
        await Promise.all(["api-v1", "pages"].map((n) => caches.delete(n)));
      }
    } catch { /* best-effort */ }
    await signOut();
  }

  React.useEffect(() => {
    setTheme(getStoredTheme());
    setScale(getStoredTextScale());
  }, []);

  const onTheme = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
  };
  const onScale = (next: TextScale) => {
    applyTextScale(next);
    setScale(next);
  };
  const onLang = async (next: "es" | "en") => {
    if (next === lang) return;
    setLang(next);
    // Persist users.locale (BD, source of truth for emails/push) + the ulp-locale
    // cookie server-side, then reload so SSR re-renders in the new language.
    await setLocale(next);
    window.location.reload();
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 20px var(--screen-pb)",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      <Link
        href="/home"
        className="mp-tap"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--accent)",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 15,
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        <Icon name="chevL" size={18} color="var(--accent)" /> {labels.backCases}
      </Link>
      <h1
        className="t-black"
        style={{ margin: "0 0 18px", fontSize: 28, color: "var(--navy)" }}
      >
        {labels.title}
      </h1>

      {/* Appearance */}
      <Section>{labels.appearance}</Section>
      <Card style={{ padding: 6, marginBottom: 14 }}>
        {/* Row is a div (not a button) so the inner Switch button is not nested
            inside another button — avoids the hydration error. The Switch is the
            single interactive control, matching the notification rows below. */}
        <div
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "14px 12px",
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 13,
              background: dark ? "#1E2A44" : "var(--gold-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon
              name={dark ? "moon" : "sun"}
              size={24}
              color={dark ? "var(--gold)" : "var(--gold-deep)"}
            />
          </div>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div
              className="t-title"
              style={{ fontSize: 17, color: "var(--navy)", fontWeight: 700 }}
            >
              {labels.darkMode}
            </div>
            <div style={{ fontSize: 13.5, color: "var(--ink-2)", fontWeight: 500 }}>
              {dark ? labels.on : labels.off}
            </div>
          </div>
          <Switch on={dark} onClick={() => onTheme(dark ? "light" : "dark")} />
        </div>
      </Card>

      {/* Text size */}
      <Card style={{ padding: 16, marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <Icon name="form" size={22} color="var(--accent)" />
          <span style={{ fontSize: 15, color: "var(--ink-2)", fontWeight: 600 }}>
            {labels.textSize}
          </span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {TEXT_SIZES.map((s) => {
            const on = scale === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => onScale(s.value)}
                className="mp-tap"
                style={{
                  flex: 1,
                  height: 58,
                  borderRadius: 16,
                  cursor: "pointer",
                  border: on ? "2px solid var(--accent)" : "2px solid var(--line)",
                  background: on ? "var(--blue-soft)" : "var(--card)",
                  color: on ? "var(--accent)" : "var(--navy)",
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span style={{ fontSize: s.size }}>{s.label}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Language */}
      <Section>{labels.language}</Section>
      <Card style={{ padding: 14, marginBottom: 22 }}>
        <div style={{ display: "flex", gap: 10 }}>
          {[
            { id: "es" as const, label: "Español", flag: "🇨🇴" },
            { id: "en" as const, label: "English", flag: "🇺🇸" },
          ].map((o) => {
            const on = lang === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onLang(o.id)}
                className="mp-tap"
                style={{
                  flex: 1,
                  height: 60,
                  borderRadius: 16,
                  cursor: "pointer",
                  border: on ? "2px solid var(--accent)" : "2px solid var(--line)",
                  background: on ? "var(--blue-soft)" : "var(--card)",
                  color: on ? "var(--accent)" : "var(--navy)",
                  fontFamily: "var(--font-title)",
                  fontWeight: 700,
                  fontSize: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 9,
                }}
              >
                <span style={{ fontSize: 22 }}>{o.flag}</span>
                {o.label}
                {on && <Icon name="check" size={18} color="var(--accent)" stroke={3} />}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Notifications (UI-only in F2) */}
      <Section>{labels.notifications}</Section>
      <Card style={{ padding: "4px 16px", marginBottom: 22 }}>
        {(
          [
            { k: "msg" as const, label: labels.notifMessages },
            { k: "cita" as const, label: labels.notifMeetings },
            { k: "pago" as const, label: labels.notifPayments },
            { k: "avance" as const, label: labels.notifUpdates },
          ]
        ).map((r, i) => (
          <div
            key={r.k}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 0",
              borderTop: i ? "1px solid var(--line)" : "none",
            }}
          >
            <span style={{ flex: 1, fontSize: 16, color: "var(--navy)", fontWeight: 600 }}>
              {r.label}
            </span>
            <Switch on={notif[r.k]} onClick={() => toggleNotif(r.k)} />
          </div>
        ))}
        {/* Web Push device subscription (DOC-24). */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 0",
            borderTop: "1px solid var(--line)",
          }}
        >
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", fontSize: 16, color: "var(--navy)", fontWeight: 600 }}>
              {labels.notifPush}
            </span>
            <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-2)", marginTop: 1 }}>
              {pushState.status === "unsupported"
                ? labels.notifPushUnsupported
                : pushState.status === "denied"
                ? labels.notifPushDenied
                : labels.notifPushAlert}
            </span>
          </span>
          <Switch
            on={pushState.subscribed}
            onClick={() => {
              if (pushState.busy || pushState.status === "unsupported" || pushState.status === "denied") return;
              if (pushState.subscribed) void pushState.unsubscribe();
              else void pushState.subscribe();
            }}
          />
        </div>
      </Card>

      {/* My account */}
      <Section>{labels.myAccount}</Section>
      <Card style={{ padding: "4px 16px", marginBottom: 18 }}>
        {[
          {
            icon: "user" as const,
            color: "var(--accent)",
            label: labels.myDetails,
            sub: labels.myDetailsSub,
          },
          {
            icon: "help" as const,
            color: "var(--gold-deep)",
            label: labels.help,
            sub: labels.helpSub,
          },
        ].map((r, i) => (
          <div
            key={i}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 13,
              padding: "13px 0",
              borderTop: i ? "1px solid var(--line)" : "none",
              textAlign: "left",
            }}
          >
            <IconTile name={r.icon} color={r.color} size={42} radius={12} iconSize={22} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="t-title"
                style={{ fontSize: 16, color: "var(--navy)", fontWeight: 700 }}
              >
                {r.label}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 500 }}>
                {r.sub}
              </div>
            </div>
            <span
              style={{
                background: "var(--gold-soft)",
                color: "var(--gold-deep)",
                borderRadius: 999,
                padding: "4px 10px",
                fontSize: 11.5,
                fontWeight: 800,
              }}
            >
              {labels.soon}
            </span>
          </div>
        ))}
      </Card>

      <button
        type="button"
        onClick={() => handleSignOut()}
        className="mp-tap"
        style={{
          width: "100%",
          height: 52,
          borderRadius: 999,
          border: "2px solid color-mix(in srgb, var(--red) 20%, transparent)",
          background: "var(--card)",
          color: "var(--red)",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 16,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {labels.signOut}
      </button>
    </div>
  );
}
