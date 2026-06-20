/**
 * Applies the full v1-grade Credible Fear memorandum config (17 configurable
 * sections + adapted system prompt + research instructions) to the asilo-politico
 * memorandum ai_letter, via the Supabase Management API. This is EXACTLY the data
 * the editor's "Guardar configuración" writes — applied in one shot here because
 * the 17-section content is data entry (the round-trip UI persistence is verified
 * live separately). The admin can then view/edit every section in the UI.
 *
 * Usage:  SBTOKEN=<token> node docs/_evidence/asilo-memo-config.cjs <form_definition_id>
 */
const PROJ = "uexxyokexcamyjcknxua";
const FORM_ID = process.argv[2];
if (!FORM_ID) { console.error("missing form_definition_id arg"); process.exit(1); }

// The 17 sections (adapted from v1 credible-fear-prompt-v7.ts — now CONFIG, not code).
const sections = [
  { key: "i1", heading: "I.1 Introduction & Procedural Posture", min_words: 1000, max_tokens: 3000, type: "doctrinal", guidance: "Identify the applicant, the relief sought (asylum INA 208, withholding INA 241(b)(3), CAT), the core of the claim, and a roadmap of the memorandum." },
  { key: "i2", heading: "I.2 Statement of Jurisdiction", min_words: 800, max_tokens: 2500, type: "doctrinal", guidance: "USCIS/EOIR jurisdiction, procedural posture, and statutory bases (INA 208, 241(b)(3), CAT)." },
  { key: "i3", heading: "I.3 Governing Legal Standards: Asylum", min_words: 2600, max_tokens: 7000, type: "doctrinal", guidance: "Refugee definition INA 101(a)(42)(A); well-founded fear (subjective+objective, 'reasonable possibility', Cardoza-Fonseca); past-persecution rebuttable presumption (8 CFR 208.13(b)(1)) and burden shift; 'one central reason' nexus; one-year deadline and exceptions. Doctrinal only; do not narrate client facts." },
  { key: "i4", heading: "I.4 Governing Legal Standards: Withholding & CAT", min_words: 1800, max_tokens: 5500, type: "doctrinal", guidance: "INA 241(b)(3) 'clear probability / more likely than not'; CAT (torture, state action/acquiescence, 8 CFR 1208.16-18); non-discretionary nature." },
  { key: "i5", heading: "I.5 Narrative of Past Persecution — Part A: Background & Onset", min_words: 3400, max_tokens: 9000, type: "narrative", guidance: "Applicant background and protected identity; country context at onset; FIRST incidents in rigorous chronological detail (dates, names, places, threats, impact). Cover only the first third of the timeline. Faithful to the record; never invent facts." },
  { key: "i6", heading: "I.6 Narrative of Past Persecution — Part B: Escalation", min_words: 3400, max_tokens: 9000, type: "narrative", guidance: "Escalating incidents in detail; applicant responses (precautions, internal relocations attempted); persecutor reactions. Continue seamlessly from Part A; cover the middle third of the timeline." },
  { key: "i7", heading: "I.7 Narrative of Past Persecution — Part C: Final Events, Flight & Arrival", min_words: 2800, max_tokens: 8000, type: "narrative", guidance: "Culminating incident(s), decision to flee, journey, entry to the U.S., post-departure threats and current situation. Continue from Part B; cover the final third of the timeline." },
  { key: "i8", heading: "I.8 Country Conditions — Part A: Political & Security Context", min_words: 2800, max_tokens: 8000, type: "analysis", guidance: "Political/security situation; mechanisms of repression/violence; principal actors (state, armed groups, organized crime) relevant to the applicant's profile; documented pattern of persecution. Cite only provided/verified sources." },
  { key: "i9", heading: "I.9 Country Conditions — Part B: Impunity, State Failure & Current Situation", min_words: 2800, max_tokens: 8000, type: "analysis", guidance: "Impunity, justice-system failure, corruption, state complicity; CURRENT situation (recent sources first) showing the danger persists; futility of state protection and internal relocation." },
  { key: "i10", heading: "I.10 The Protected Ground(s): Cognizability & Membership", min_words: 2600, max_tokens: 7500, type: "analysis", guidance: "For PSG: immutability (Acosta), particularity, social distinction (M-E-V-G); articulate the group precisely; analyze each requirement; establish membership. For political opinion/religion/race/nationality: definition, evidence, attribution. Cite verified jurisprudence." },
  { key: "i11", heading: "I.11 Nexus & Application of Controlling Federal Precedent", min_words: 3600, max_tokens: 9500, type: "analysis", guidance: "CORE legal argument. Argue 'on account of' nexus, 'one central reason', mixed-motive. For EACH verified precedent: court, citation, holding, step-by-step reasoning, DIRECT factual analogy to the applicant, why it compels protection. Distinguish adverse framings (generalized violence, private dispute, mere extortion). Include verified URLs inline only." },
  { key: "i12", heading: "I.12 The Harm Rises to Persecution: Severity & Cumulative Effect", min_words: 1800, max_tokens: 5500, type: "analysis", guidance: "Argue the harm crosses the persecution threshold (not mere harassment): severity per category (physical violence, threats to life, existential economic deprivation, psychological terror) and the cumulative effect." },
  { key: "i13", heading: "I.13 Government Inability or Unwillingness to Protect", min_words: 2200, max_tokens: 6500, type: "analysis", guidance: "If non-state actors: government unable/unwilling to control them (use the applicant's attempts to seek help and country-conditions impunity). If state actor: impossibility of protection is direct. No police report required if futile/dangerous." },
  { key: "i14", heading: "I.14 Internal Relocation Is Neither Safe Nor Reasonable", min_words: 1600, max_tokens: 5000, type: "analysis", guidance: "Persecutor reach (networks, informants); relocations already attempted; reasonableness factors (8 CFR 208.13(b)(3)). With past persecution established, the burden shifts to the government to prove safe/reasonable relocation." },
  { key: "i15", heading: "I.15 Credibility & Corroboration", min_words: 1800, max_tokens: 5500, type: "analysis", guidance: "REAL ID Act framework (INA 208(b)(1)(B)(iii)); narrative coherence, verifiable detail, consistency with documented country conditions. Walk exhibit-by-exhibit; explain where corroboration is not reasonably obtainable. Credible testimony alone may carry the burden." },
  { key: "i16", heading: "I.16 Well-Founded Fear of Future Persecution & Alternative Relief", min_words: 2200, max_tokens: 6500, type: "analysis", guidance: "Subjective + objectively reasonable fear; rebuttable presumption from past persecution; current country conditions showing the threat persists. Apply the withholding 'clear probability' and CAT 'more likely than not' standards where the record supports. Do not write the prayer for relief here." },
  { key: "i17", heading: "I.17 Conclusions and Prayer for Relief", min_words: 1200, max_tokens: 4500, type: "analysis", guidance: "Synthesize I.1-I.16 (grounds, membership, persecution, nexus, state role, relocation futility, credibility, future fear) in tight recap paragraphs; firm final position; formal Prayer for Relief: (1) asylum INA 208; (2) in the alternative, withholding INA 241(b)(3); (3) in the alternative, CAT." },
];

const systemPrompt =
  "You are a Senior Federal Immigration Attorney drafting a Credible Fear legal memorandum for a USCIS asylum application (Form I-589), to the standard of an elite corporate immigration firm. Write in ENGLISH, clinical, authoritative and persuasive. The factual record is the client's M1-M11 questionnaire answers and uploaded sworn declaration ONLY — never invent client facts. When web_search is enabled, find REAL favorable federal precedents (Circuit Courts and the BIA) by the applicant's nationality and persecution type, and verified current country-conditions reporting, and apply them. The reference dataset of winning cases is a STYLE and ARGUMENTATION guide only — never a source of facts for the current case. Output the markdown body of the assigned section only.";

const research =
  "Use web_search to find 6-10 REAL, favorable, published federal asylum/withholding precedents (Circuit Courts of Appeals and the BIA) matched to the applicant's nationality and persecution type — search CourtListener, Justia and scholar.google.com. Also find recent, verified country-conditions reporting (reputable news, HRW, U.S. State Department). Never fabricate a citation, holding, statistic or URL; prefer sources with a working link.";

const sql =
  "update public.ai_generation_configs set " +
  "system_prompt = $sp$" + systemPrompt + "$sp$, " +
  "sections = $js$" + JSON.stringify(sections) + "$js$::jsonb, " +
  "research_instructions = $ri$" + research + "$ri$, " +
  "web_search_enabled = true, web_search_max_uses = 6, rules_enabled = true, " +
  "model = 'claude-opus-4-7', max_output_tokens = 16000 " +
  "where form_definition_id = '" + FORM_ID + "';";

(async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.SBTOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  console.log("HTTP", res.status, await res.text());
})();
