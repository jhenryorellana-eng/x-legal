# Pre-Mortem — prueba en vivo del pipeline (Anthropic real) — 2026-06-29

`docs/_evidence/premortem-live-verify.cjs` reproduce `assessPreMortemRisk` end-to-end contra datos
reales de prod (caso ULP-2026-0011, run `memorandum-de-miedo-creible`):
descarga el memo PDF → lo transcribe (Gemini) → embebe + recupera precedentes (RPC `match_dataset_items`)
→ corre el crítico (Anthropic real) → reporte estructurado.

## Resultado
- **Retrieval** (RAG semántico): top-6 precedentes relevantes — Immigration Equality / Human Rights First
  (modelos de declaración), **Matter of Mogharrabi**, CLINIC Toolkit, **Navas v. INS**, **Cardoza-Fonseca**
  (sim 0.54–0.59). El retrieval funciona aun con un query pobre.
- **Crítico Anthropic**: salida JSON estructurada válida → `overallRisk: "high"`, summary + **8 motivos**
  mapeados a la taxonomía (`CREDIBILITY` 0.97, `NEXUS_FAIL` 0.95, `CORROBORATION` 0.93, `NOT_PERSECUTION`
  0.88, `WFF_OBJECTIVE` 0.85, `STATE_ACTION` 0.80, `RELOCATION` 0.72, `ONE_YEAR_BAR` 0.60), cada uno con
  `rationale` (citando INA/8 CFR/REAL ID + los precedentes recuperados) y `correction` accionable.
  Tokens: in≈994 / out≈1807.

## Hallazgo importante (honesto)
- El **memo PDF real está casi vacío** (transcribe a **27 chars** — generación stub del 2026-06-27, sin
  narrativa). El crítico lo detectó correctamente ("blank/near-blank template header") y marcó riesgo alto
  por ausencia de todos los elementos. **El mecanismo es correcto**; para un demo rico hace falta un memo
  con contenido real (generar uno nuevo).
- **Confirma para el in-app**: el memo se guarda como **PDF (`ai_generation_runs.output_path`)**, no
  `output_text`. Por tanto `assessPreMortemRisk` debe **caer a extraer texto del PDF** (`extractRawTextFromStorage`,
  bucket `generated`) cuando `output_text` es null — implementado como robustez (no parche).

## Verificación E2E in-app (Playwright, dev :3100, Henry admin) — 2026-06-29
1. **Flag admin**: en el form-editor del ai_letter `memorandum-de-miedo-creible`, el toggle
   **"Pre-Mortem (análisis de riesgo)"** renderiza; activado + "Guardar configuración" → persistió
   `ai_generation_configs.pre_mortem_enabled=true` (vía el server action de la app, NO SQL). ✔
2. **Gating del tab**: en el caso ULP-2026-0011 (admin) apareció el tab **"Pre-Mortem"** (gating por
   `isPreMortemEnabledForCase`); en empty state mostró el CTA "Analizar caso". ✔
3. **Run end-to-end**: "Analizar caso" → `runPreMortemAction` → `assessPreMortemRisk` → **fallback de PDF**
   (extrajo el memo del PDF vía Gemini) → embed → retrieve → **crítico Anthropic (claude-opus-4-7)** →
   reporte renderizado: **"Riesgo general: Alto"** + resumen + **10 motivos** con label localizado
   (Credibilidad 85% · Falta de corroboración 80% · Falta de nexo 75% · …), cada uno con "Por qué"/"Corrección"
   citando precedentes (Mogharrabi, Navas, S-M-J-, Cardoza-Fonseca, REAL ID Act). ✔
4. **Persistencia + coste**: 1 fila en `case_pre_mortem_assessments` (overall_risk=high, 10 motivos,
   model claude-opus-4-7, in=2387/out=2031 tokens, **cost_usd=$0.1881**, created_by=Henry). ✔
   Screenshot: `premortem-tab-inapp.png`.

## Conclusión
El Pre-Mortem está **verificado end-to-end in-app** (flag admin → gating del tab → run con Anthropic real +
fallback de PDF + RAG → reporte localizado → persistencia con coste). Todo el wiring que los unit tests
mockean quedó probado en vivo.
