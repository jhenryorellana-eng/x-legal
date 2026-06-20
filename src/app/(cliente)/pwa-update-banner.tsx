"use client";

/**
 * PWA "new version available" toast (DOC-24 §2.5). The SW ships with
 * `skipWaiting: false`, so a new worker parks in `waiting` instead of seizing
 * control mid-use. This banner detects that, and on "Actualizar" tells the
 * worker to `SKIP_WAITING` and reloads once it takes control (`controllerchange`).
 */

import * as React from "react";
import { useTranslations } from "next-intl";

export function PwaUpdateBanner() {
  const t = useTranslations("pwa.update");
  const [waiting, setWaiting] = React.useState<ServiceWorker | null>(null);

  React.useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let reloaded = false;

    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            setWaiting(reg.waiting);
          }
        });
      });
    });

    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!waiting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: "calc(12px + var(--safe-top))",
        left: "50%",
        transform: "translateX(-50%)",
        width: "calc(100% - 28px)",
        maxWidth: 402,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        background: "var(--card)",
        borderRadius: 16,
        border: "1px solid var(--line)",
        boxShadow: "0 16px 40px rgba(11,27,51,0.18)",
      }}
    >
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
        {t("message")}
      </span>
      <button
        type="button"
        onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}
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
          fontSize: 13.5,
          background: "linear-gradient(120deg, var(--accent), var(--accent-deep))",
        }}
      >
        {t("action")}
      </button>
    </div>
  );
}
