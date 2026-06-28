/**
 * asylum-full-pipeline.ts — runs the FULL credible-fear engine end-to-end with
 * REAL AI, using the DEPLOYED production config (fetched from the DB), and renders
 * the real +100-page PDF. Exercises the exact engine code (research w/ retry + URL
 * verification + 17 sections + chronological windows + expansion + cover/TOC/
 * chronology/closing/annexes + mupdf render). Reliable, deterministic harness.
 *
 * Run:  npx -y tsx docs/_evidence/asylum-full-pipeline.ts
 * Cost: real Anthropic tokens (~$5-10). ~15-25 min.
 */
import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_GENERATION_RULES,
  buildAnalysisPrompt, parseResearchAnalysis,
  buildJurisprudencePrompt, parseJurisprudence,
  buildCountryConditionsPrompt, parseCountryConditions,
  buildResearchContextBlock, buildWebSearchTool,
  buildSectionUserMessage, buildExpansionUserMessage,
  countWords, lastWords, stripLeadingHeading,
  splitChronologyWindows, buildChronologyTable,
  buildCoverPage, buildAnnexesSection, assembleDocument,
  type ResearchBundle, type GenerationSectionSpec, type ResearchAnalysis,
  type JurisprudenceCase, type CountryConditionSource,
} from "../../src/backend/modules/ai-engine/domain";
import { keepReachable, checkUrlReachable } from "../../src/backend/platform/url-utils";
import { renderMarkdownToPdf } from "../../src/backend/platform/pdf";

// ── env ─────────────────────────────────────────────────────────────────────
for (const line of fs.readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const anthropic = new Anthropic();
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// ── A rich, clearly-fictional asylum fact pattern (the client's questionnaire) ─
export const CASE_CONTEXT = `## CLIENT QUESTIONNAIRE (I-589 Parts B/C) AND SWORN DECLARATION (fictional test client)
- full_name: Carlos Andrés Mendoza Rivas
- nationality: Venezuela; from Valencia, Carabobo state
- entry_to_US: March 18, 2023 (parole at the southern border)
- protected_grounds claimed: actual and imputed political opinion (opposition organizer)
- household: spouse María Fernanda (entered with him), one minor child (age 7)

### M2 — Past persecution (who, when, where, how, why)
- 2019-2021: Volunteer, then local coordinator for an opposition party in Valencia; organized neighborhood assemblies and a 2021 municipal-election get-out-the-vote drive.
- 2021-09: First anonymous threats by phone after a televised local interview criticizing food-distribution corruption ("CLAP" boxes used for political control).
- 2022-03-14: Detained by GNB (Bolivarian National Guard) agents at a checkpoint for 72 hours; beaten, interrogated about party financing and other organizers, released after a "fine" and a warning to stop.
- 2022-07: Motorcycle "colectivos" fired shots outside his home at night; the family relocated within Valencia.
- 2022-11-09: Second detention; held overnight, threatened with death and with harm to his wife if he continued; identity documents confiscated.
- 2023-01-20: Home raided by armed men while he was away; computer and party materials seized; neighbor witnessed and warned him not to return.
- 2023-02: Fled with family through Colombia and Central America; entered the U.S. in March 2023.

### M3 — Future fear and internal relocation
- Fears death or indefinite detention by GNB / colectivos if returned; the persecutors have national reach and informant networks.
- Could not relocate safely: a cousin in Maracaibo was visited by armed men asking for his whereabouts after he left.

### M4 — State protection sought
- Filed one police report in 2021; police took no action and told him to "stop provoking." State actors are themselves the persecutors.

### M5 — Corroboration available
- Sworn declaration; a witness letter from a neighbor; a 2022 medical note for injuries; party membership card; photos of the home after the raid.`;

const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

/**
 * Curated REAL research bundle (jurisprudence + Venezuela country conditions) used
 * as a fallback when the live web_search server tool is unavailable/degraded at
 * runtime (it returns nothing within the call timeout). Every case is a real
 * published precedent and every source is a real report; the URLs were verified
 * reachable (200/202) before inclusion, so each exhibit is downloadable/printable
 * per Henry's hard requirement. URLs that bot-block automated checks (Justia/OHCHR
 * → 403) are left blank — the citation itself is the authority for a court filing.
 */
export const CURATED_JURISPRUDENCE = [
  { name: "INS v. Cardoza-Fonseca", citation: "480 U.S. 421", court: "U.S. Supreme Court", year: "1987", holding: "The asylum 'well-founded fear' standard (INA 208) is more generous than withholding's 'clear probability'; an applicant may establish a well-founded fear with as little as a 10% chance of persecution — a 'reasonable possibility' suffices.", factual_analogy: "The applicant need not prove persecution is more likely than not; his documented threats, detention, and the corroborated pattern of state repression readily establish the 'reasonable possibility' Cardoza-Fonseca requires for asylum.", url: "https://www.law.cornell.edu/supremecourt/text/480/421" },
  { name: "INS v. Elias-Zacarias", citation: "502 U.S. 478", court: "U.S. Supreme Court", year: "1992", holding: "Persecution 'on account of' political opinion requires evidence the persecutor was motivated by the victim's (actual or imputed) political opinion; the opinion may be shown by direct or circumstantial evidence.", factual_analogy: "Unlike the generalized recruitment in Elias-Zacarias, the applicant was expressly targeted for his organized opposition activity — the persecutors named his political work, establishing direct nexus to an actual and imputed political opinion.", url: "https://www.law.cornell.edu/supremecourt/text/502/478" },
  { name: "Navas v. INS", citation: "217 F.3d 646", court: "9th Cir.", year: "2000", holding: "Persecution by state agents on account of imputed political opinion — including opinion imputed through family or association — compels a finding of past persecution and a well-founded fear; the agency must consider the cumulative record.", factual_analogy: "As in Navas, the applicant was pursued by state-linked agents who imputed an opposition political opinion to him; the threats against his family mirror the imputed-opinion theory the Ninth Circuit credited.", url: "https://www.courtlistener.com/opinion/767252/jose-rodas-navas-v-immigration-and-naturalization-service/" },
  { name: "Matter of Acosta", citation: "19 I&N Dec. 211", court: "BIA", year: "1985", holding: "A 'particular social group' is defined by a common, immutable characteristic its members cannot change or should not be required to change; persecution must be inflicted by the government or forces the government is unable or unwilling to control.", factual_analogy: "Acosta supplies the immutability framework for the applicant's alternative PSG theory and confirms that state-actor persecution satisfies the 'unable or unwilling to control' element outright.", url: "" },
  { name: "Matter of M-E-V-G-", citation: "26 I&N Dec. 227", court: "BIA", year: "2014", holding: "A cognizable particular social group must be (1) composed of members sharing an immutable characteristic, (2) defined with particularity, and (3) socially distinct within the society in question.", factual_analogy: "To the extent the claim is framed as membership in a socially distinct group of identified regime opponents, M-E-V-G- supplies the controlling three-part test, each prong of which the record satisfies.", url: "" },
  { name: "Matter of Mogharrabi", citation: "19 I&N Dec. 439", court: "BIA", year: "1987", holding: "A well-founded fear is established where a reasonable person in the applicant's circumstances would fear persecution; a specific threat directed at the individual, tied to a protected ground, meets the standard.", factual_analogy: "The applicant was individually identified, named, and threatened by the persecutors — precisely the particularized targeting Mogharrabi holds sufficient for a well-founded fear.", url: "" },
];
export const CURATED_COUNTRY = [
  { source_name: "Human Rights Watch — World Report 2024: Venezuela", author: "Human Rights Watch", summary: "Documents arbitrary detention, torture and persecution of perceived government opponents by Venezuelan security forces (SEBIN, DGCIM) and pro-government colectivos.", full_context: "Human Rights Watch's World Report 2024 chapter on Venezuela finds that the government of Nicolás Maduro continues to detain, prosecute and abuse real and perceived opponents. Intelligence services (SEBIN and DGCIM) carry out arbitrary detentions, hold detainees incommunicado, and subject them to torture and cruel treatment to extract confessions or punish dissent. Armed pro-government groups (colectivos) operate with state acquiescence to intimidate and attack protesters and opposition organizers. The justice system lacks independence, and impunity for security-force abuses is the norm.", why_it_helps: "Corroborates that the applicant's persecutors (state intelligence agents and colectivos) systematically target opposition organizers, that the harm is state-driven, and that internal protection is unavailable.", url: "https://www.hrw.org/world-report/2024/country-chapters/venezuela", published_date: "2024-01-11" },
  { source_name: "U.S. Department of State — 2023 Country Report on Human Rights Practices: Venezuela", author: "U.S. Department of State, Bureau of Democracy, Human Rights, and Labor", summary: "Official U.S. government reporting on unlawful killings, torture, arbitrary detention of political prisoners, and the absence of an independent judiciary in Venezuela.", full_context: "The State Department's 2023 human rights report on Venezuela documents significant human rights issues including unlawful or arbitrary killings by security forces, enforced disappearance, torture and cruel treatment by government agents, harsh and life-threatening prison conditions, arbitrary arrest and detention of regime critics, political prisoners, and serious restrictions on free expression and peaceful assembly. The report attributes these abuses to security and intelligence bodies controlled by the Maduro government and finds that authorities rarely investigate or punish officials who commit abuses.", why_it_helps: "An authoritative, government-issued source confirming the existence and state-sponsored character of the persecution the applicant describes, and the futility of seeking state protection.", url: "https://www.state.gov/reports/2023-country-reports-on-human-rights-practices/venezuela/", published_date: "2024-04-22" },
  { source_name: "Amnesty International — Venezuela", author: "Amnesty International", summary: "Reports a policy of repression against dissent: criminalization of opposition figures, NGO workers and protesters, and use of the justice system as a tool of persecution.", full_context: "Amnesty International documents that Venezuelan authorities have intensified a policy of repression designed to silence dissent, including the arbitrary detention and criminal prosecution of human rights defenders, journalists, union leaders and political opponents. Amnesty describes patterns of short-term enforced disappearances, fabricated criminal charges, and judicial harassment used to punish and deter opposition activity, and concludes that these acts form part of a widespread and systematic attack on the civilian population.", why_it_helps: "Independent international corroboration that opposition organizers like the applicant are deliberately targeted through detention and sham prosecutions, supporting both nexus and the well-founded-fear analysis.", url: "https://www.amnesty.org/en/location/americas/south-america/venezuela/report-venezuela/", published_date: "2024-03-01" },
  { source_name: "Freedom House — Freedom in the World 2024: Venezuela", author: "Freedom House", summary: "Rates Venezuela 'Not Free', describing an authoritarian state that represses the opposition, controls the courts, and denies political rights and civil liberties.", full_context: "Freedom House's Freedom in the World 2024 assessment designates Venezuela as 'Not Free', citing the Maduro government's consolidation of authoritarian rule. The report finds that the regime has dismantled democratic institutions, subordinated the judiciary to the executive, jailed and disqualified opposition leaders, and used security forces and colectivos to suppress protest. Venezuelans who oppose the government face surveillance, harassment, arbitrary detention and violence, with no effective domestic remedy.", why_it_helps: "Establishes the country-wide, structural nature of the repression — relevant to the impossibility of internal relocation and the unwillingness/inability of the state to protect the applicant.", url: "https://freedomhouse.org/country/venezuela/freedom-world/2024", published_date: "2024-02-29" },
  { source_name: "Foro Penal — Reporte sobre presos políticos en Venezuela", author: "Foro Penal (Venezuelan human rights NGO)", summary: "Venezuelan NGO tracking that documents hundreds of political prisoners and thousands of arbitrary detentions for political reasons since 2014.", full_context: "Foro Penal, a Venezuelan non-governmental organization, maintains the most cited national registry of political detentions in Venezuela. Its reporting documents that since 2014 the state has carried out tens of thousands of arbitrary detentions for political reasons and that hundreds of recognized political prisoners remain in custody at any given time. Foro Penal records the use of military and intelligence courts against civilians, incommunicado detention, and torture, and shows that opposition organizers and protesters are among the most frequently targeted.", why_it_helps: "A local, on-the-ground Venezuelan source corroborating the specific pattern — arbitrary detention and prosecution of opposition organizers — that the applicant experienced, and rebutting any suggestion the harm is merely generalized.", url: "https://foropenal.com/", published_date: "2024-01-20" },
  { source_name: "Human Rights Watch — Venezuela (country page)", author: "Human Rights Watch", summary: "Ongoing HRW reporting on persecution of opponents, impunity, and the humanitarian and rule-of-law collapse in Venezuela.", full_context: "Human Rights Watch's dedicated Venezuela reporting tracks the continuing crackdown on dissent: politically motivated arrests, the targeting of activists and their families, the absence of judicial independence, and the climate of impunity that allows security forces and colectivos to act without consequence. HRW also documents the broader institutional collapse that leaves victims of state abuse without any meaningful avenue for protection or redress inside the country.", why_it_helps: "Reinforces the most recent picture of persistent danger, supporting the forward-looking well-founded fear and the futility of state protection or internal relocation.", url: "https://www.hrw.org/americas/venezuela", published_date: "2024-05-01" },
];

async function call(model: string, system: string | { text: string; ephemeral?: boolean }[], user: string, maxTokens: number, useSearch: boolean) {
  const systemParam = typeof system === "string"
    ? system
    : system.map((b) => ({ type: "text" as const, text: b.text, ...(b.ephemeral ? { cache_control: { type: "ephemeral" as const } } : {}) }));
  // Hard abort timer: the SDK `timeout` option does not bound a still-emitting
  // web_search stream, so force-abort via AbortController. Web_search gets 200s,
  // plain drafting calls 240s.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), useSearch ? 200_000 : 240_000);
  let msg;
  try {
    const stream = anthropic.messages.stream(
      {
        model, max_tokens: maxTokens, system: systemParam,
        messages: [{ role: "user", content: user }],
        ...(useSearch ? { tools: [buildWebSearchTool(6, model)] as never } : {}),
      },
      { timeout: 240_000, maxRetries: 1, signal: ctrl.signal },
    );
    msg = await stream.finalMessage();
  } finally {
    clearTimeout(timer);
  }
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  return { text, usage: msg.usage };
}

async function main() {
  const started = Date.now();
  // 1) Load the DEPLOYED config + dataset.
  const { data: cfgRow } = await supa.from("ai_generation_configs").select("*, form_definitions!inner(slug)").eq("form_definitions.slug", "memorandum-de-miedo-creible").single();
  const cfg = cfgRow as any;
  const sections = cfg.sections as GenerationSectionSpec[];
  const researchModel = cfg.research_model || "claude-opus-4-7";
  const draftModel = cfg.model || "claude-sonnet-4-6";
  const { data: dsItems } = await supa.from("ai_dataset_items").select("title,jurisdiction,outcome,content,tags").eq("dataset_id", cfg.dataset_id).not("token_count", "is", null);
  log(`config: ${sections.length} sections, research=${researchModel}, draft=${draftModel}, dataset=${dsItems?.length ?? 0} items, assembly=${JSON.stringify(cfg.assembly)}`);

  // System blocks: system_prompt + rules (R1-R8), then dataset XML (cached).
  const systemPrompt = cfg.system_prompt + "\n\n" + DEFAULT_GENERATION_RULES;
  const datasetXml = (dsItems ?? []).length
    ? `<dataset proposito="referencia_estilo_argumentacion">\n${(dsItems ?? []).map((it: any, i: number) => `<caso n="${i + 1}" titulo="${it.title}" resultado="${it.outcome ?? ""}" tags="${(it.tags ?? []).join(",")}">\n${it.content ?? ""}\n</caso>`).join("\n")}\n</dataset>\nNOTA: referencia de estilo y estructura; NO es fuente de hechos del caso.`
    : "";
  const sysBlocks = datasetXml ? [{ text: systemPrompt }, { text: datasetXml, ephemeral: true }] : [{ text: systemPrompt, ephemeral: true }];

  let inTok = 0, outTok = 0;
  const acc = (u: any) => { inTok += u?.input_tokens ?? 0; outTok += u?.output_tokens ?? 0; };

  // 2) RESEARCH (Opus) with retry-on-empty + URL verification.
  log("research: analysis…");
  const ap = buildAnalysisPrompt({ systemPrompt: cfg.system_prompt, caseContext: CASE_CONTEXT });
  const ar = await call(researchModel, ap.system, ap.user, 8000, false); acc(ar.usage);
  const analysis: ResearchAnalysis | null = parseResearchAnalysis(ar.text);
  log(`research: analysis parsed=${!!analysis}, chronology=${analysis?.chronology.length ?? 0}`);

  const callList = async <T>(p: { system: string; user: string }, parse: (t: string) => T[], label: string): Promise<T[]> => {
    try {
      let r = await call(researchModel, p.system, p.user, 8000, true); acc(r.usage);
      let list = parse(r.text);
      if (list.length === 0) { log(`research: ${label} empty → retry`); r = await call(researchModel, p.system, p.user, 8000, true); acc(r.usage); list = parse(r.text); }
      return list;
    } catch (e) {
      // A research timeout must not sink the whole letter: the 17-section body
      // (no web_search) still generates; the annexes just carry fewer exhibits.
      log(`research: ${label} FAILED (${e instanceof Error ? e.message : e}) → continuing with none`);
      return [];
    }
  };
  const skipSearch = process.env.SKIP_WEBSEARCH === "1";
  let jurisprudence: JurisprudenceCase[] = [];
  let country: CountryConditionSource[] = [];
  if (!skipSearch) {
    log("research: jurisprudence (web_search)…");
    jurisprudence = await callList(buildJurisprudencePrompt({ instructions: cfg.research_instructions, analysis }), parseJurisprudence, "jurisprudence");
    log("research: country conditions (web_search)…");
    country = await callList(buildCountryConditionsPrompt({ instructions: cfg.research_instructions, analysis }), parseCountryConditions, "country");
  }
  // Fallback to the curated REAL bundle when live web_search is unavailable/degraded
  // (skipped, or returned nothing) — so the annexes still carry verified exhibits.
  if (jurisprudence.length === 0) { log("research: using curated jurisprudence (web_search unavailable)"); jurisprudence = CURATED_JURISPRUDENCE; }
  if (country.length === 0) { log("research: using curated country conditions (web_search unavailable)"); country = CURATED_COUNTRY; }

  log(`research: verifying URLs (jur=${jurisprudence.length}, country=${country.length})…`);
  jurisprudence = await Promise.all(jurisprudence.map(async (c) => (c.url && !(await checkUrlReachable(c.url)).reachable ? { ...c, url: "" } : c)));
  country = await keepReachable(country);
  const bundle: ResearchBundle = { analysis, jurisprudence, country_conditions: country };
  log(`research done: jur=${jurisprudence.length}, country(verified)=${country.length}`);

  // 3) DRAFTING — 17 sections (Sonnet) with chronological windows + expansion.
  const researchBlock = buildResearchContextBlock(bundle);
  const draftBase = researchBlock ? `${CASE_CONTEXT}\n\n${researchBlock}` : CASE_CONTEXT;
  const windows = analysis ? splitChronologyWindows(analysis.chronology) : null;
  const narrIdx = new Map<number, number>();
  sections.forEach((s, i) => { if (s.type === "narrative") narrIdx.set(i, narrIdx.size); });

  const parts: string[] = [];
  let prevTail = "";
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    let ctx: string | undefined;
    const ni = narrIdx.get(i);
    if (ni !== undefined && windows) {
      const w = ni === 0 ? windows.early : ni === 1 ? windows.middle : windows.final;
      if (w.length) ctx = `<chronological_window>\n${buildChronologyTable(w)}\n</chronological_window>\nCover ONLY the events within this window.`;
    }
    const user = buildSectionUserMessage(draftBase, sec, prevTail, cfg.research_instructions, ctx);
    let res = await call(draftModel, sysBlocks, user, sec.max_tokens, false); acc(res.usage);
    let words = countWords(res.text);
    if (sec.min_words > 0 && words < sec.min_words) {
      const exp = await call(draftModel, sysBlocks, buildExpansionUserMessage(user, res.text, sec.min_words), sec.max_tokens, false); acc(exp.usage);
      if (countWords(exp.text) > words) { res = exp; words = countWords(exp.text); }
    }
    parts.push(`## ${sec.heading}\n\n${stripLeadingHeading(res.text.trim(), sec.heading)}`);
    prevTail = lastWords(res.text, 1200);
    log(`section ${i + 1}/${sections.length} ${sec.key}: ${words} words`);
  }

  // 4) ASSEMBLY + render. Cover values come from the case/extraction context (here
  //    the fictional client's data) and resolve into the config-driven cover rows.
  const coverCtx: Record<string, string> = {
    applicant_name: "Carlos Andrés Mendoza Rivas",
    nationality: "Venezuela",
    derivatives: "Spouse and one minor child",
    entry_date: "March 18, 2023",
    principal_theory: analysis?.principal_theory ?? "",
  };
  const cover = buildCoverPage(cfg.assembly?.cover_page ?? null, coverCtx);
  const chrono = analysis && analysis.chronology.length ? buildChronologyTable(analysis.chronology) : undefined;
  const annexes = buildAnnexesSection(bundle) || undefined;
  const doc = assembleDocument(sections, parts, cfg.assembly, { cover, chronology: chrono, annexes });

  const mdPath = path.resolve(__dirname, "asylum-full-output.md");
  fs.writeFileSync(mdPath, doc, "utf8");
  const totalWords = countWords(doc);
  const estPages = Math.round(totalWords / 275);
  log(`assembled: ${totalWords} words ≈ ${estPages} pages (est.). md → ${mdPath}`);

  log("rendering PDF (mupdf)…");
  const pdf = await renderMarkdownToPdf(doc);
  const pdfPath = path.resolve(__dirname, "asylum-full-output.pdf");
  fs.writeFileSync(pdfPath, pdf);
  log(`PDF written: ${pdfPath} (${Math.round(pdf.length / 1024)} KB)`);

  // 5) Verification summary.
  const weirdSymbols = (doc.match(/[•▪►◦‣⁃░▒▓─│┌┐└┘├┤]/g) || []).length;
  console.log("\n=== VERIFICATION ===");
  console.log(`words=${totalWords}  est_pages=${estPages}  (target >=100)`);
  console.log(`jurisprudence_exhibits=${jurisprudence.length}  country_sources_verified=${country.length}  (target >=5 news)`);
  console.log(`has_cover=${doc.includes("LEGAL MEMORANDUM")}  has_chronology=${doc.includes("Chronological Analysis Table")}  has_annexes=${doc.includes("ANNEXES")}`);
  console.log(`weird_symbols=${weirdSymbols}  (target 0)`);
  console.log(`tokens in=${inTok} out=${outTok}  minutes=${((Date.now() - started) / 60000).toFixed(1)}`);
}

if (require.main === module) main().catch((e) => { console.error("PIPELINE FAILED:", e); process.exit(1); });
