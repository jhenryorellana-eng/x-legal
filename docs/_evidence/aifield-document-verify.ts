/**
 * B4 live proof — ai_field ← DOCUMENT resolution against REAL uploaded data.
 * Reproduces exactly what getFormForClient → resolveBySource(ai_field) →
 * resolveAiFields → downloadDocumentBytesBySlug + interpretDocumentFields do on
 * form load: download the real uploaded document from storage and ask Gemini to
 * INTERPRET it (not extract a fixed datum) per a per-field instruction. Uses the
 * real `documento-identidad` of case ASILO-OBJ-DEMO. Read-only.
 */
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

for (const line of fs.readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const CASE_ID = "bc973317-1b6b-42a0-a9e0-33c55ab4545c"; // ASILO-OBJ-DEMO
const DOC_SLUG = "documento-identidad";

// The per-field instructions a questionnaire ai_field ← document would carry.
const FIELDS = [
  { id: "nombre", instruction: "Indica el nombre completo legal del titular, tal como aparece en el documento." },
  { id: "doc_tipo", instruction: "Indica qué tipo de documento de identidad es y el país/autoridad que lo emite." },
  { id: "vigencia", instruction: "Indica si el documento muestra fecha de emisión o vencimiento, y cuáles son (o 'no visible')." },
];

const SCHEMA = {
  type: "object",
  properties: { answers: { type: "array", items: { type: "object", properties: { id: { type: "string" }, value: { type: "string" } }, required: ["id", "value"] } } },
  required: ["answers"],
};

async function main() {
  // 1) downloadDocumentBytesBySlug (real): latest active doc for (case, slug)
  const { data: rows } = await supa
    .from("case_documents")
    .select("storage_path, mime_type, required_document_types!inner(slug)")
    .eq("case_id", CASE_ID)
    .eq("required_document_types.slug", DOC_SLUG)
    .in("status", ["uploaded", "approved"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (!rows?.length) throw new Error("no uploaded document found");
  const doc = rows[0] as unknown as { storage_path: string; mime_type: string };
  const { data: file } = await supa.storage.from("case-documents").download(doc.storage_path);
  if (!file) throw new Error("download failed");
  const fileBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  console.log(`[doc] ${DOC_SLUG} · ${doc.mime_type} · ${(fileBase64.length / 1366).toFixed(0)} KB`);

  // 2) interpretDocumentFields (real prompt/model/schema): one Gemini call, all fields
  const prompt =
    "Eres un asistente legal que INTERPRETA un documento (no extraes un dato literal: lees, " +
    "comprendes y redactas). Para cada campo, produce el texto solicitado basándote ÚNICAMENTE " +
    "en el contenido real del documento. Si el documento no lo respalda, devuelve cadena vacía " +
    "para ese id (NO inventes).\n\nCampos:\n" +
    FIELDS.map((f, i) => `${i + 1}. id="${f.id}": ${f.instruction}`).join("\n") +
    '\n\nResponde en JSON: {"answers":[{"id":"<id>","value":"<texto>"}]}.';
  const t0 = Date.now();
  const res = await genai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: doc.mime_type, data: fileBase64 } }, { text: prompt }] }],
    config: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json", responseSchema: SCHEMA },
  });
  const text = res.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const parsed = JSON.parse(text) as { answers: Array<{ id: string; value: string }> };

  console.log(`\n=== ai_field ← documento-identidad — interpretación (Gemini, ${((Date.now() - t0) / 1000).toFixed(1)}s) ===\n`);
  for (const f of FIELDS) {
    const a = parsed.answers.find((x) => x.id === f.id);
    console.log(`### ${f.id}\n${a?.value || "(vacío)"}\n`);
  }
  console.log(`VERIFICACIÓN: ${parsed.answers.filter((a) => a.value?.trim()).length}/${FIELDS.length} campos interpretados desde el documento real.`);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
