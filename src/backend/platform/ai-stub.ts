/**
 * AI stub — deterministic, env-gated fake AI clients for E2E / CI (DOC-81 §4.3/§4.6).
 *
 * WHY: the canonical E2E flows (intake→generation→formulario §4.3 and the
 * catalog "prueba de fuego" §4.6) exercise AI generation and the editor's AI
 * proposal. DOC-81 explicitly sanctions mocking AI in CI ("mockeada con
 * respuesta fija", §4.6.3). Hitting the real Anthropic/Gemini APIs in tests is
 * slow, costly, non-deterministic and would spend budget. This module returns
 * fixed, schema-faithful responses so specs are fast and stable.
 *
 * SAFETY (hard guard): the stub is active ONLY when `AI_E2E_STUB === '1'` AND
 * `NODE_ENV !== 'production'`. If the flag is ever set in production we THROW
 * (fail loud) rather than silently serving fake AI to real clients. It is inert
 * (never instantiated) without the flag.
 *
 * Shapes are mirrored from the real SDK surface that `ai-engine/service.ts`
 * reads (verified against the code, June 2026):
 *   - Anthropic `messages.stream().finalMessage()` → { stop_reason, model, usage, content:[{type:'text',text}] }
 *   - Anthropic `messages.create()` → { content:[{type:'text',text}] }  (T2 editor)
 *   - Gemini `models.generateContent()` → { text, candidates:[{content:{parts:[{text}]}}], usageMetadata }
 */

 

/**
 * True when the deterministic AI stub must be used. Throws (fail loud) if the
 * flag is set in a production build — fake AI must never reach real clients.
 */
export function isAiStubEnabled(): boolean {
  if (process.env.AI_E2E_STUB !== "1") return false;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AI_E2E_STUB is set in a production build. This would serve fake AI responses to real clients. Refusing.",
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Canned content
// ---------------------------------------------------------------------------

/** A short but valid legal memo (T1 generation). Long enough to pass MIN_OUTPUT_CHARS. */
const STUB_LEGAL_MEMO = [
  "# Memorándum legal (generado por el stub de IA para pruebas E2E)",
  "",
  "**Asunto:** Declaración de respaldo para la solicitud del cliente.",
  "",
  "## I. Introducción",
  "Este documento es una salida determinista del stub de IA usado en las pruebas",
  "automatizadas de la Fase F4. No constituye asesoría legal real y solo existe",
  "para validar el flujo extremo a extremo de generación, render y compilación.",
  "",
  "## II. Hechos relevantes",
  "El cliente ha completado el formulario de admisión y aportó la información",
  "requerida. Los datos personales se resuelven localmente y nunca se envían a la IA.",
  "",
  "## III. Análisis",
  "Conforme a la normativa migratoria aplicable, los elementos aportados respaldan",
  "la elegibilidad declarada. La narrativa es coherente, fechada y verificable.",
  "",
  "## IV. Conclusión",
  "Se recomienda proceder con el ensamblado del expediente y la validación posterior.",
].join("\n");

/** A fixed segmentation proposal (T2 proposeFormSegmentation). */
function buildStubSegmentation(firstFieldName: string | null): string {
  const pdfField = firstFieldName ?? "Pt1Line1_FamilyName";
  return JSON.stringify({
    research_summary:
      "Resumen de investigación de prueba (stub IA): el formulario se completa por partes, " +
      "comenzando por la identidad del solicitante.",
    groups: [
      {
        title_i18n: { es: "Datos del solicitante", en: "Applicant information" },
        position: 0,
        questions: [
          {
            question_i18n: { es: "Apellido(s)", en: "Family name(s)" },
            help_i18n: { es: "Tal como aparece en su pasaporte.", en: "As shown on your passport." },
            field_type: "text",
            options: null,
            pdf_field_name: pdfField,
            source: "profile",
            source_ref: { profile_field: "last_name" },
            is_required: true,
            validation: null,
            position: 0,
          },
          {
            question_i18n: { es: "País de nacimiento", en: "Country of birth" },
            help_i18n: null,
            field_type: "text",
            options: null,
            pdf_field_name: null,
            source: "client_answer",
            source_ref: null,
            is_required: true,
            validation: null,
            position: 1,
          },
        ],
      },
      {
        title_i18n: { es: "Antecedentes", en: "Background" },
        position: 1,
        questions: [
          {
            question_i18n: { es: "¿Tiene representación legal?", en: "Do you have legal representation?" },
            help_i18n: null,
            field_type: "select",
            options: [
              { value: "yes", label_i18n: { es: "Sí", en: "Yes" } },
              { value: "no", label_i18n: { es: "No", en: "No" } },
            ],
            pdf_field_name: null,
            source: "client_answer",
            source_ref: null,
            is_required: false,
            validation: null,
            position: 0,
          },
        ],
      },
    ],
  });
}

/** A fixed extraction JSON schema (T2 proposeExtractionSchema). */
const STUB_EXTRACTION_SCHEMA = JSON.stringify({
  schema: {
    type: "object",
    properties: {
      full_name: { type: "string", description: "Full legal name of the document holder." },
      document_number: { type: "string", description: "Official identifier on the document." },
      issue_date: { type: "string", description: "Issue date (ISO 8601)." },
    },
    required: ["full_name"],
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts the first detected AcroForm field name from a user prompt, if present. */
function firstDetectedField(content: unknown): string | null {
  const text = typeof content === "string" ? content : "";
  // Detected fields are rendered as "- {name} ({type}, page {n})".
  const m = text.match(/^- (\S+) \([a-z]+, page \d+\)/m);
  return m ? m[1] : null;
}

function systemText(system: unknown): string {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join(" ");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Anthropic stub
// ---------------------------------------------------------------------------

const STUB_USAGE = {
  input_tokens: 1200,
  output_tokens: 900,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

function makeMessage(text: string, model: string) {
  return {
    id: "msg_stub",
    model,
    stop_reason: "end_turn" as const,
    usage: STUB_USAGE,
    content: [{ type: "text" as const, text }],
  };
}

/** Fake Anthropic client implementing the `messages.{stream,create}` surface ai-engine uses. */
export const stubAnthropicClient = {
  messages: {
    // T1 legal generation — streaming transport, read via finalMessage().
    stream(body: any) {
      const model = body?.model ?? "claude-fable-5";
      return {
        finalMessage: async () => makeMessage(STUB_LEGAL_MEMO, model),
      };
    },
    // T2 editor — proposeFormSegmentation (research + JSON) and proposeExtractionSchema.
    async create(body: any) {
      const model = body?.model ?? "claude-sonnet-4-6";
      const sys = systemText(body?.system);
      // Research step: identified by the web_search tool.
      const hasWebSearch = Array.isArray(body?.tools) && body.tools.some((t: any) => t?.name === "web_search");
      if (hasWebSearch) {
        return makeMessage(
          "Brief de investigación (stub IA): el formulario oficial se completa por partes; " +
            "el solicitante aporta su identidad, antecedentes y narrativa. Valores enumerados acotados.",
          model,
        );
      }
      // Extraction-schema proposal vs form-segmentation proposal.
      if (/JSON Schema/i.test(sys)) {
        return makeMessage(STUB_EXTRACTION_SCHEMA, model);
      }
      const userContent = Array.isArray(body?.messages) ? body.messages[0]?.content : undefined;
      return makeMessage(buildStubSegmentation(firstDetectedField(userContent)), model);
    },
  },
};

// ---------------------------------------------------------------------------
// Gemini stub
// ---------------------------------------------------------------------------

function buildStubGeminiText(config: any): string {
  const schema = config?.responseSchema;
  if (schema && typeof schema === "object") {
    // Extraction (T3): satisfy every required key so the validator passes.
    const out: Record<string, unknown> = {
      raw_text: "Texto extraído de prueba (stub IA) para verificación E2E del pipeline de extracción.",
    };
    const props: Record<string, any> = schema.properties ?? {};
    const required: string[] = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (key in out) continue;
      const type = props[key]?.type;
      out[key] =
        type === "number" || type === "integer"
          ? 0
          : type === "boolean"
            ? false
            : type === "array"
              ? []
              : type === "object"
                ? {}
                : `stub-${key}`;
    }
    return JSON.stringify(out);
  }
  // Translation (T4) or plain text.
  return "Traducción de prueba (stub IA).";
}

/** Fake Gemini `models` namespace implementing `generateContent`. */
export const stubGeminiModels = {
  async generateContent(req: any) {
    const text = buildStubGeminiText(req?.config);
    return {
      text,
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 300 },
    };
  },
};
