/**
 * Etapa D — live probe of Gemini embeddings. Confirms which embedding model is
 * available and the output vector length (drives the vector(N) migration dim).
 * Read-only (no DB writes). Run: npx tsx docs/_evidence/embed-probe.ts
 */
import * as fs from "fs";
import * as path from "path";
import { GoogleGenAI } from "@google/genai";

for (const line of fs.readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const SAMPLE =
  "Matter of Acosta (BIA 1985) — particular social group; immutable characteristic; asylum nexus.";

async function probe(model: string, dim?: number) {
  try {
    const res: any = await genai.models.embedContent({
      model,
      contents: SAMPLE,
      ...(dim ? { config: { outputDimensionality: dim } } : {}),
    });
    const vec =
      res?.embeddings?.[0]?.values ?? res?.embedding?.values ?? res?.embeddings?.values ?? null;
    console.log(
      `OK  model=${model}${dim ? ` dim=${dim}` : ""}  → length=${Array.isArray(vec) ? vec.length : "??"}  sample=[${
        Array.isArray(vec) ? vec.slice(0, 3).map((n: number) => n.toFixed(4)).join(", ") : ""
      }...]`,
    );
  } catch (e: any) {
    console.log(`FAIL model=${model}${dim ? ` dim=${dim}` : ""}  → ${e?.message ?? e}`);
  }
}

(async () => {
  await probe("gemini-embedding-001", 768);
  await probe("gemini-embedding-001"); // default dim
  await probe("text-embedding-004");
})();
