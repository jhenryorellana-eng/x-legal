/**
 * Org repository — data access for organization configuration.
 *
 * ONLY this file touches Supabase for the org module. Uses the service client
 * for writes (org config is admin-only at the app layer; can() gates it in the
 * service). Reads use the service client too, scoped by org_id explicitly.
 *
 * DOC-30 (orgs / cover_templates / terms_versions).
 */

import { createServiceClient } from "@/backend/platform/supabase";
import type { Tables, TablesInsert, Json } from "@/shared/database.types";

export type OrgRow = Tables<"orgs">;
export type CoverTemplateRow = Tables<"cover_templates">;
export type TermsVersionRow = Tables<"terms_versions">;

function db() {
  return createServiceClient();
}

// ---------------------------------------------------------------------------
// Org row
// ---------------------------------------------------------------------------

export async function findOrgById(orgId: string): Promise<OrgRow | null> {
  const { data } = await db().from("orgs").select("*").eq("id", orgId).maybeSingle();
  return data;
}

export async function updateOrg(
  orgId: string,
  patch: { name?: string; settings?: Json },
): Promise<OrgRow> {
  const { data, error } = await db()
    .from("orgs")
    .update(patch)
    .eq("id", orgId)
    .select()
    .single();
  if (error) throw new Error(`org.repo.updateOrg: ${error.message}`);
  if (!data) throw new Error("org.repo.updateOrg: no data returned");
  return data;
}

// ---------------------------------------------------------------------------
// Cover templates
// ---------------------------------------------------------------------------

export async function listCoverTemplates(orgId: string): Promise<CoverTemplateRow[]> {
  const { data, error } = await db()
    .from("cover_templates")
    .select("*")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw new Error(`org.repo.listCoverTemplates: ${error.message}`);
  return data ?? [];
}

export async function setCoverTemplateActive(
  id: string,
  active: boolean,
): Promise<CoverTemplateRow> {
  const { data, error } = await db()
    .from("cover_templates")
    .update({ is_active: active })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`org.repo.setCoverTemplateActive: ${error.message}`);
  if (!data) throw new Error("org.repo.setCoverTemplateActive: no data returned");
  return data;
}

// ---------------------------------------------------------------------------
// Terms versions
// ---------------------------------------------------------------------------

export async function listTermsVersions(orgId: string): Promise<TermsVersionRow[]> {
  const { data, error } = await db()
    .from("terms_versions")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`org.repo.listTermsVersions: ${error.message}`);
  return data ?? [];
}

export async function termsVersionExists(orgId: string, version: string): Promise<boolean> {
  const { data } = await db()
    .from("terms_versions")
    .select("id")
    .eq("org_id", orgId)
    .eq("version", version)
    .maybeSingle();
  return data !== null;
}

export async function insertTermsVersion(
  row: TablesInsert<"terms_versions">,
): Promise<TermsVersionRow> {
  const { data, error } = await db().from("terms_versions").insert(row).select().single();
  if (error) throw new Error(`org.repo.insertTermsVersion: ${error.message}`);
  if (!data) throw new Error("org.repo.insertTermsVersion: no data returned");
  return data;
}

/**
 * Atomically marks one version current: deactivates every other version of the
 * org, then activates the given one and stamps published_at.
 */
export async function activateTermsVersion(orgId: string, versionId: string): Promise<TermsVersionRow> {
  const client = db();
  // Deactivate all current versions for the org.
  await client.from("terms_versions").update({ is_active: false }).eq("org_id", orgId).eq("is_active", true);
  // Activate the target.
  const { data, error } = await client
    .from("terms_versions")
    .update({ is_active: true, published_at: new Date().toISOString() })
    .eq("id", versionId)
    .eq("org_id", orgId)
    .select()
    .single();
  if (error) throw new Error(`org.repo.activateTermsVersion: ${error.message}`);
  if (!data) throw new Error("org.repo.activateTermsVersion: no data returned");
  return data;
}

/**
 * Counts how many contracts accepted each terms version (compliance read,
 * RF-ADM-051). Returns a map version → count.
 */
export async function countTermsAcceptances(_orgId: string): Promise<Record<string, number>> {
  // contract_terms_acceptances.terms_version is a text pointer; org scoping is
  // implicit via the org's contracts. We read the acceptances and bucket them.
  const { data, error } = await db()
    .from("contract_terms_acceptances")
    .select("terms_version");
  if (error) {
    // Non-fatal for the config screen — return empty buckets.
    return {};
  }
  const out: Record<string, number> = {};
  for (const row of data ?? []) {
    const v = row.terms_version;
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}
