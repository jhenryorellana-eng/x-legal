/**
 * Finanzas stub — /finanzas (F0)
 */
import { redirect } from "next/navigation";
import { getActor, can } from "@/backend/modules/identity";

export default async function FinanzasPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");
  try { can(actor, "billing", "view"); } catch { redirect("/admin"); }

  return (
    <div style={{ padding: "54px 32px" }}>
      <h1 style={{ fontSize: 24, color: "var(--navy)" }}>Finanzas — próximamente</h1>
    </div>
  );
}
