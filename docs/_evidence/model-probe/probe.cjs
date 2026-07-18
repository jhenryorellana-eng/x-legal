/* Model validity probe — one tiny real call per candidate model ID.
 * Resolves whether the deprecated IDs in ai_generation_configs (claude-opus-4-7,
 * claude-sonnet-4-6) are still valid at runtime, and which current IDs to migrate to.
 * Reads keys from .env.local. Run: node docs/_evidence/model-probe/probe.cjs
 */
const fs = require("fs");
const path = require("path");
const NM = path.join(__dirname, "../../../node_modules");

const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim() : null;
};
const ANTHROPIC = get("ANTHROPIC_API_KEY");
const GEMINI = get("GEMINI_API_KEY");

// Candidates: the two currently-configured (at-risk) + the current-tier alternatives.
const ANTHROPIC_MODELS = [
  "claude-sonnet-4-6", // drafting model in prod configs
  "claude-opus-4-7", // research_model in prod configs (flagged possibly-invalid)
  "claude-opus-4-8", // current premium
  "claude-sonnet-5", // current mid-tier
  "claude-haiku-4-5-20251001", // current lightweight
  "claude-fable-5", // SoT T1 default
];
const GEMINI_MODELS = ["gemini-2.5-flash"];

(async () => {
  const Anthropic = require(path.join(NM, "@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: ANTHROPIC });
  console.log("== Anthropic model probe ==");
  for (const model of ANTHROPIC_MODELS) {
    try {
      const r = await client.messages.create({
        model,
        max_tokens: 8,
        messages: [{ role: "user", content: "Reply with exactly: PONG" }],
      });
      const text = (r.content?.[0]?.text ?? "").trim();
      console.log(`[OK]   ${model} · reply="${text}" · echoed_model="${r.model}" · in=${r.usage?.input_tokens} out=${r.usage?.output_tokens}`);
    } catch (e) {
      const status = e?.status ?? "?";
      console.log(`[FAIL] ${model} · HTTP ${status} · ${String(e?.message || e).slice(0, 180)}`);
    }
  }

  console.log("\n== Gemini model probe ==");
  const { GoogleGenAI } = require(path.join(NM, "@google/genai"));
  const ai = new GoogleGenAI({ apiKey: GEMINI });
  for (const model of GEMINI_MODELS) {
    try {
      const r = await ai.models.generateContent({ model, contents: "Reply with exactly: PONG" });
      const text = (r.text ?? r.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
      console.log(`[OK]   ${model} · reply="${text}"`);
    } catch (e) {
      console.log(`[FAIL] ${model} · ${String(e?.message || e).slice(0, 180)}`);
    }
  }
})();
