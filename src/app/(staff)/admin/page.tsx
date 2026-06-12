/**
 * Admin stub — /admin (F0)
 * Requires staff actor. Full admin panel arrives in later phases.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";

export default async function AdminPage() {
  const t = await getTranslations("staff.stub");
  const actor = await getActor();

  if (!actor || actor.kind !== "staff") redirect("/login");

  // F0 stub: full staff profile query arrives in F3
  const name = actor.role ?? "Empleado";

  return (
    <div style={{ padding: "54px 32px", maxWidth: 700, margin: "0 auto" }}>
      <h1 className="t-black" style={{ fontSize: 28, color: "var(--navy)", marginBottom: 8 }}>
        {t("greeting").replace("{name}", name.split(" ")[0])}
      </h1>
      <p style={{ fontSize: 15, color: "var(--ink-3)", marginBottom: 4 }}>
        {t("role").replace("{role}", actor.role ?? "staff")}
      </p>
      <p style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 32 }}>{t("comingSoon")}</p>
    </div>
  );
}
