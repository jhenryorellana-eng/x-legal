/* Minimal sanity ping for the real AI keys (Anthropic + Gemini).
 * Reads keys from .env.local, makes one tiny call each. node docs/_evidence/f4-keys/ai-ping.cjs
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

(async () => {
  // --- Anthropic (generation model used by F4: claude-sonnet-4-6) ---
  try {
    const Anthropic = require(path.join(NM, "@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: ANTHROPIC });
    const r = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with exactly: PONG" }],
    });
    const text = r.content?.[0]?.text ?? "";
    console.log(`ANTHROPIC (claude-sonnet-4-6): OK · reply="${text.trim()}" · in=${r.usage?.input_tokens} out=${r.usage?.output_tokens}`);
  } catch (e) {
    console.log("ANTHROPIC: FAIL —", String(e?.message || e).slice(0, 160));
  }

  // --- Gemini (extraction/translation model: gemini-2.5-flash) ---
  try {
    const { GoogleGenAI } = require(path.join(NM, "@google/genai"));
    const ai = new GoogleGenAI({ apiKey: GEMINI });
    const r = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "Reply with exactly: PONG",
    });
    const text = r.text ?? r.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log(`GEMINI (gemini-2.5-flash): OK · reply="${String(text).trim()}"`);
  } catch (e) {
    console.log("GEMINI: FAIL —", String(e?.message || e).slice(0, 160));
  }
})();
