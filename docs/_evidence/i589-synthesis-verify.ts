/**
 * B6 live proof — the I-589 Partes B/C "ai_field ← memorándum" headline.
 * Replicates synthesizeLetterFields (ai-engine): one Anthropic call over a credible-fear
 * memorandum, answering the actual Part B per-field instructions as JSON. Proves the
 * real synthesis quality (the unit test mocks Anthropic; this hits the real provider).
 * Read-only: does NOT mutate any production data.
 */
import * as fs from "fs";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";

for (const line of fs.readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const anthropic = new Anthropic();

// A representative excerpt of a generated credible-fear memorandum (stands in for a real
// run's output_text — the live engine stores output_text on every completed run).
const MEMO = `MEMORÁNDUM DE MIEDO CREÍBLE — Resumen de los hechos.
El solicitante, ciudadano de Venezuela, fue organizador del partido opositor en su
municipio. Tras coordinar una protesta en marzo de 2023, agentes del SEBIN allanaron su
vivienda, lo detuvieron por 11 días en condiciones de incomunicación y lo sometieron a
golpizas y amenazas de muerte por su militancia política. Un colectivo armado afín al
gobierno incendió su negocio y advirtió a su familia que "el próximo sería su cadáver".
Su hermano, también militante, permanece desaparecido desde 2022. El solicitante huyó por
Colombia y Panamá (Tapón del Darién) y se presentó en la frontera sur de EE. UU. expresando
miedo a regresar. No existe reubicación interna segura: el SEBIN y los colectivos operan a
nivel nacional con aquiescencia estatal y el poder judicial carece de independencia.
La persecución se funda en su OPINIÓN POLÍTICA (imputada y real) y en su pertenencia al
grupo social de "organizadores opositores señalados".`;

const FIELDS = [
  { id: "grupo_social", instruction: "Redacta una definición precisa del grupo social particular del solicitante y la característica inmutable que comparten sus miembros." },
  { id: "persecucion_pasada", instruction: "Redacta el relato detallado de la persecución pasada: quién, cuándo, dónde, cómo y por qué." },
  { id: "miedo_futuro", instruction: "Redacta por qué el solicitante teme persecución futura si regresa a su país." },
  { id: "no_reubicacion", instruction: "Redacta por qué el solicitante no puede reubicarse de forma segura dentro de su país." },
  { id: "cat", instruction: "Redacta el fundamento del temor a tortura (CAT): maltrato sufrido o amenazas del gobierno o vinculados a él." },
];

async function main() {
  const system =
    "Eres un asistente legal experto en asilo en EE. UU. A partir del MEMORÁNDUM provisto, " +
    "redacta el texto pedido para cada campo de un formulario oficial (USCIS I-589). Usa SOLO " +
    "hechos presentes en el memorándum; no inventes. Sé conciso, preciso y formal. Devuelve cadena " +
    "vacía para un id no sustentado.";
  const list = FIELDS.map((f, i) => `${i + 1}. id="${f.id}": ${f.instruction}`).join("\n");
  const user = `MEMORÁNDUM:\n${MEMO}\n\n---\nCampos a redactar:\n${list}\n\nResponde ÚNICAMENTE en JSON: {"answers":[{"id":"<id>","value":"<texto>"}]}.`;

  const t0 = Date.now();
  const stream = anthropic.messages.stream(
    { model: "claude-opus-4-7", max_tokens: 6000, system, messages: [{ role: "user", content: user }] },
    { maxRetries: 1 },
  );
  const msg = await stream.finalMessage();
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  const parsed = JSON.parse(text.slice(start, end + 1)) as { answers: Array<{ id: string; value: string }> };

  console.log(`\n=== I-589 Partes B/C — síntesis desde el memorándum (Anthropic, ${((Date.now() - t0) / 1000).toFixed(1)}s) ===\n`);
  for (const f of FIELDS) {
    const a = parsed.answers.find((x) => x.id === f.id);
    console.log(`### ${f.id}\n${a?.value || "(vacío)"}\n`);
  }
  console.log(`VERIFICACIÓN: ${parsed.answers.filter((a) => a.value?.trim()).length}/${FIELDS.length} campos redactados.`);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
