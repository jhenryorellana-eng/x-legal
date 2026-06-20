"use client";

/**
 * PWA install banner (DOC-24 §2.6). Captures `beforeinstallprompt` (Android/
 * Chromium) and offers a one-tap install; on iOS (no such event) it shows the
 * "Compartir → Añadir a pantalla de inicio" mini-guide instead. Rendered only by
 * AccountChrome (account routes, post-login) — never on welcome/login/NO_CHROME.
 * Suppressed when already installed (standalone) or running inside Capacitor, and
 * remembers a dismissal so it is not nagging.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/frontend/components/brand/icon";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "ulp-pwa-install-dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    typeof (window as unknown as { Capacitor?: unknown }).Capacitor !== "undefined"
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

export function PwaInstallPrompt() {
  const t = useTranslations("pwa.install");
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [showIOS, setShowIOS] = React.useState(false);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    if (isIOS()) {
      setShowIOS(true);
      setVisible(true);
      return;
    }

    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    return () => window.removeEventListener("beforeinstallprompt", onBIP);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
    setDeferred(null);
    setShowIOS(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    dismiss();
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label={t("title")}
      style={{
        position: "fixed",
        bottom: "calc(96px + var(--safe-bottom))",
        left: "50%",
        transform: "translateX(-50%)",
        width: "calc(100% - 28px)",
        maxWidth: 402,
        zIndex: 33,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        background: "var(--card)",
        borderRadius: 18,
        border: "1px solid var(--line)",
        boxShadow: "0 18px 44px rgba(11,27,51,0.20)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 42,
          height: 42,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, var(--navy), var(--accent))",
        }}
      >
        <Icon name="sparkle" size={20} color="#fff" fill="#fff" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 14.5, color: "var(--navy)" }}>
          {t("title")}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.35, marginTop: 1 }}>
          {showIOS ? t("iosGuide") : t("body")}
        </div>
      </div>
      {!showIOS && (
        <button
          type="button"
          onClick={install}
          style={{
            flexShrink: 0,
            height: 38,
            padding: "0 16px",
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            color: "#fff",
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 13,
            background: "linear-gradient(120deg, var(--accent), var(--accent-deep))",
          }}
        >
          {t("install")}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("later")}
        style={{
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
          background: "var(--blue-soft)",
          color: "var(--ink-3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="x" size={16} color="var(--ink-3)" />
      </button>
    </div>
  );
}
