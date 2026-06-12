/**
 * Legal stub — /legal (F0)
 */
import { redirect } from "next/navigation";
import { getActor, can } from "@/backend/modules/identity";

export default async function LegalPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");
  try { can(actor, "cases", "view"); } catch { redirect("/admin"); }

  return (
    <div style={{ padding: "54px 32px" }}>
      <h1 style={{ fontSize: 24, color: "var(--navy)" }}>Legal — próximamente</h1>
    </div>
  );
}
