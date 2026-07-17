# E2E en PROD — Escrito de Apelación (BIA) · caso Diego U26-000034 · 2026-07-17

## Pipeline completo verificado (todo en x-legal.usalatinoprime.com, deploy `7493bfa`)

1. **Evidencias sustentatorias (documento nuevo, opcional/múltiple)** — Diego (sesión de cliente
   real) vio la categoría nueva en su PWA y subió 2 PDFs sintéticos con display_name propio:
   - "Denuncia SEBIN julio 2026" (Constancia MP-2026-088341, 5-jul-2026 — POSTERIOR a la decisión)
   - "Carta de testigo Jose Contreras" (8-jul-2026)
   Gemini los extrajo en segundos con el schema nuevo ("Esto leímos de tu documento": título +
   resumen correctos en ambos).

2. **Cuestionario dinámico híbrido** — instancia generada en PROD: **$0.0961**, 3.876 in / 5.630
   out tokens, 18 preguntas en 5 grupos generados + 2 grupos base (7 preguntas), wizard de 7 pasos.
   - Un grupo POR CADA evidencia, identificada por su nombre (multi-doc de la Ola 1 en el prompt).
   - Preguntas por cada motivo del juez: corroboración, nexo/opinión política, CAT despachado sin
     análisis, reubicación interna.
   - Preguntas de NO-disponibilidad (estándar 8 C.F.R. §1003.2(c)) sin sugerir respuestas.
   - `inputs_snapshot` congeló **4 documentos** (asilo + decisión + 2 evidencias, mismo slug) —
     la capacidad multi-documento funcionando en PROD.
   Diego respondió los 7 pasos (autosave "Guardado") y envió ("¡Lo lograste, Diego!").

3. **Brief real** — run `a17421b3`, camino QStash→Vercel→Anthropic (sectioned engine):
   - **Costo $1.1516** (estimado era $2.5-6; prompt caching: 32.244 cache-read tokens).
   - 134.638 in / 52.299 out tokens · 219.799 chars (~100 págs) · PDF en Storage.
   - **13/13 secciones** (`## A.1`…`## A.13`).
   - **A.10 (tercer país, condicional)**: constata correctamente que la decisión NO usa ningún
     ground de tercer país — no inventa análisis.
   - **A.11 (Motion to Remand, condicional)**: DESARROLLADA — 8 C.F.R. §1003.2(c) + Matter of
     Coelho, las 2 evidencias POR NOMBRE, materialidad + indisponibilidad con la justificación
     honesta del cuestionario (allanamiento del 3-jul posterior a la decisión del 2-jul; testigo
     localizado en julio de 2026).
   - Precedentes del dataset citados: Cole v. Holder, Sagaydak, Matter of Z-Z-O-, Madrigal,
     Matter of S-M-J-, Matter of Coelho (+ Shrestha como marco adverso).
   - Carátula de corte resuelta desde extracciones (respondent, A-number, corte, juez, fecha,
     nacionalidad, grounds) + CERTIFICATE OF SERVICE al cierre.

4. **Pre-Mortem del brief** — (resultado en la sección de abajo cuando complete).

## Hallazgos anotados
- Carátula: el subtítulo muestra `[Applicant]` — `deriveCoverContext` no conoce los alias
  `applicant_full_name`/`respondent_full_name` de los schemas de apelación (fix de 1 línea).
- Copy `qPendingBody` menciona "el formulario I-589" hardcodeado para cualquier cuestionario.
- Respuestas EOIR-26 existentes quedan ancladas a v2 por diseño (invariante de versionado);
  el #6 multi-doc aplica a respuestas nuevas.

## Scripts de esta evidencia
- `seed-ola2.cjs` — siembra idempotente de la Ola 2 (autorizada).
- `make-evidence-fixtures.mjs` — genera los 2 PDFs sintéticos de Diego.
- `drafts/` — contenido fuente de la config (system prompt, secciones, research, cuestionario, dataset).
