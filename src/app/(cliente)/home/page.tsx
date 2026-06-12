/**
 * Home — /home (F0 stub — DOC-51-UI-CLIENTE §home, F0 minimal)
 *
 * Authenticated, client only. Guard in middleware.
 * F0: saludo con nombre + lista de casos (stub).
 * The full dashboard arrives in F2.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { Icon } from "@/frontend/components/brand/icon";

export default async function HomePage() {
  const t = await getTranslations("cliente.home");
  const actor = await getActor();

  if (!actor || actor.kind !== "client") {
    redirect("/welcome");
  }

  // F0 stub: full case list and profile queries arrive in F2.
  const displayName = "Cliente";

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 20px 120px",
        background: "var(--bg)",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1
          className="t-black"
          style={{ fontSize: 26, color: "var(--navy)", marginBottom: 4 }}
        >
          {t("greeting").replace("{name}", displayName)}
        </h1>
        <p style={{ fontSize: 15, color: "var(--ink-3)" }}>{t("subtitle")}</p>
      </div>

      {/* F0 stub — no cases rendered yet */}
      <div
        style={{
          padding: "24px 20px",
          background: "var(--card)",
          borderRadius: 20,
          textAlign: "center",
          color: "var(--ink-3)",
          fontSize: 15,
        }}
      >
        <Icon name="briefcase" size={36} color="var(--ink-3)" />
        <p style={{ marginTop: 12 }}>{t("noCases")}</p>
      </div>
    </div>
  );
}
