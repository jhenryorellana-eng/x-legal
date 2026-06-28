/**
 * Re-assembles the already-generated section bodies (docs/_evidence/asylum-full-output.md)
 * through the NEW config-driven assembly (block order + configurable cover) and
 * re-renders the PDF — no AI calls. Lets us verify the structure/format fast. The
 * ASYLUM_ASSEMBLY below is exactly what the prod migration will store on the config.
 */
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import { CURATED_JURISPRUDENCE, CURATED_COUNTRY } from "./asylum-full-pipeline";
import {
  buildCoverPage, buildChronologyTable, buildAnnexesSection, assembleDocument,
  type ResearchBundle, type ChronologyEvent, type GenerationSectionSpec, type ResearchAnalysis, type AssemblyConfig,
} from "../../src/backend/modules/ai-engine/domain";
import { keepReachable, checkUrlReachable } from "../../src/backend/platform/url-utils";
import { renderMarkdownToPdf } from "../../src/backend/platform/pdf";

const PERJURY =
  "I declare under penalty of perjury under the laws of the United States of America that the foregoing is true and correct to the best of my knowledge and belief.\n\nSignature: ______________________________    Date: __________________";

export const ASYLUM_ASSEMBLY: AssemblyConfig = {
  cover: true, toc: true, chronology: true, annexes: true, closing: PERJURY,
  blocks: [
    { type: "cover", enabled: true },
    { type: "toc", enabled: true },
    { type: "body", enabled: true },
    { type: "chronology", enabled: true },
    { type: "conclusions", enabled: true },
    { type: "annexes", enabled: true },
    { type: "closing", enabled: true },
  ],
  cover_page: {
    title: "LEGAL MEMORANDUM AND APPLICANT DECLARATION IN SUPPORT OF ASYLUM",
    rows: [
      { label: "Country of nationality", value: "{{nationality}}" },
      { label: "Court / jurisdiction", value: "{{court}}" },
      { label: "A-Number of principal applicant", value: "{{a_number}}" },
      { label: "Derivative applicant(s) included", value: "{{derivatives}}" },
      { label: "Date of entry into the United States", value: "{{entry_date}}" },
      { label: "Principal theory", value: "{{principal_theory}}" },
    ],
  },
};

(async () => {
  // Pull the DEPLOYED assembly straight from prod so this verifies the migration's
  // stored structure (blocks + cover_page) — not a hardcoded copy.
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: cfgRow } = await supa
    .from("ai_generation_configs")
    .select("assembly, form_definitions!inner(slug)")
    .eq("form_definitions.slug", "memorandum-de-miedo-creible")
    .single();
  const assembly: AssemblyConfig = ((cfgRow as { assembly?: AssemblyConfig } | null)?.assembly) ?? ASYLUM_ASSEMBLY;
  const blockOrder = (assembly.blocks ?? []).map((b) => `${b.type}${b.enabled === false ? "(off)" : ""}`).join(" → ");
  console.log(`deployed assembly: blocks=[${blockOrder || "(legacy default)"}] cover_rows=${assembly.cover_page?.rows?.length ?? 0}`);

  const mdPath = path.resolve(__dirname, "asylum-full-output.md");
  const md = fs.readFileSync(mdPath, "utf8");

  const blocks = md.split(/\n(?=## )/).map((b) => b.trim());
  const parts = blocks.filter((b) => /^## I\.\d/.test(b));
  const sections: GenerationSectionSpec[] = parts.map((p) => {
    const heading = (p.match(/^## (.+)/)?.[1] ?? "").trim();
    return { key: heading.split(" ")[0], heading, min_words: 0, max_tokens: 0, guidance: "", type: "analysis" };
  });

  const chronoSrc = blocks.find((b) => /^## Chronological Analysis Table/.test(b)) ?? "";
  const chronology: ChronologyEvent[] = [];
  for (const line of chronoSrc.split("\n")) {
    const m = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
    if (m) chronology.push({ date: m[1], event: m[2].replace(/\\\|/g, "|"), consequence: m[3].replace(/\\\|/g, "|"), exhibit: m[4] === "—" ? "" : m[4].replace(/\\\|/g, "|") });
  }
  const principal_theory = (md.match(/\|\s*Principal theory\s*\|\s*(.+?)\s*\|/)?.[1] ?? "").trim();
  const analysis: ResearchAnalysis = {
    nationality: "Venezuela", persecution_type: "political opinion", protected_grounds: ["political opinion"],
    perpetrator: "state agents", state_action: "state actor", principal_theory, summary: "", chronology,
  };

  const jur = await Promise.all(CURATED_JURISPRUDENCE.map(async (c) => (c.url && !(await checkUrlReachable(c.url)).reachable ? { ...c, url: "" } : c)));
  const country = await keepReachable(CURATED_COUNTRY);
  const bundle: ResearchBundle = { analysis, jurisprudence: jur, country_conditions: country };

  const ctx: Record<string, string> = {
    applicant_name: "Carlos Andrés Mendoza Rivas", nationality: "Venezuela",
    derivatives: "Spouse and one minor child", entry_date: "March 18, 2023", principal_theory,
  };
  const cover = buildCoverPage(assembly.cover_page ?? null, ctx);
  const chrono = buildChronologyTable(chronology);
  const annexes = buildAnnexesSection(bundle) || undefined;
  const doc = assembleDocument(sections, parts, assembly, { cover, chronology: chrono, annexes });

  fs.writeFileSync(mdPath, doc.replace(/\n*<<<PAGEBREAK>>>\n*/g, "\n\n"), "utf8");
  const pdf = await renderMarkdownToPdf(doc);
  fs.writeFileSync(path.resolve(__dirname, "asylum-full-output.pdf"), pdf);

  const words = doc.split(/\s+/).filter(Boolean).length;
  console.log(`reassembled: sections=${parts.length}, chronology=${chronology.length}, jur=${jur.length}, country=${country.length}`);
  console.log(`words=${words} est_pages=${Math.round(words / 275)} pdf=${Math.round(pdf.length / 1024)}KB pagebreaks=${(doc.match(/<<<PAGEBREAK>>>/g) || []).length}`);
})().catch((e) => { console.error("REASSEMBLE FAILED:", e); process.exit(1); });
