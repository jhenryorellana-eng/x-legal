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

4. **Pre-Mortem del brief** — tras el fix del abort de 240s (`63a2848`): **score 54 · amber ·
   needs_corrections · $2.80** (~7 min de validación). El validador **verificó por web search que
   todas las citas existen** con los holdings atribuidos, confirmó fidelidad total al material
   fuente (sin contradicciones), CAT separado con el estándar correcto, remand bien ubicado con
   §1003.2(c) y cobertura de todos los grounds. Sus 5 críticos son defectos editoriales REALES del
   primer borrador: costura A.5/A.6 (encabezado truncado + bloques solapados — seam del motor de
   secciones), TOC vs numeración interna, placeholders del Certificate of Service, withholding
   poco desarrollado. Moderados de valor: **autoridades del 9º Cir. para un caso de Houston (5º
   Cir.)** — sesgo del dataset a corregir; discrepancia de fecha del testigo; "cannot be
   understated". El gate protege a Diana exactamente como se diseñó (mismo arco que el EOIR-26:
   45→82 tras correcciones).

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

---

# Test E2E #2 — caso NUEVO Valentina U26-000035 (2026-07-17, pedido de Henry: todo por UI, Pre-Mortem >75)

Flujo COMPLETO por la UI del navegador (Playwright MCP) en x-legal.usalatinoprime.com:

1. **Caso nuevo por el modal del admin**: cliente demo Valentina Rojas Medina (San Francisco — corte del 9º Cir. para que el dataset sea autoridad en-circuito) → contrato **firmado en /firma** (scroll-gate + canvas + checkbox) → **pago Zelle demo $200 registrado y confirmado** → caso ACTIVO.
2. **Cliente**: subió los 3 docs requeridos + **3 evidencias sustentatorias** (denuncia Fiscalía Lara post-decisión, carta de la profesora asilada en España, informe médico certificado obtenido tarde) — las 6 extraídas por Gemini en segundos.
3. **EOIR-26 v3 (multi-doc #6)**: wizard del cliente (prefills IA + 5 elecciones simples + ítem 12/checklist), submit, aprobación y PDF. El **#6 citó las 3 evidencias POR NOMBRE**, refutó ambos grounds y anunció el motion to remand. **Pre-Mortem: 88 · Se aprobaría** (solo sugerencias pre-firma).
4. **Cuestionario dinámico** ($0.12): un grupo POR CADA una de las 3 evidencias (citando fiscal, hallazgos médicos), refutación por ground, no-disponibilidad honesta — 25 preguntas respondidas y enviadas.
5. **Brief — el gate forzó calidad real en 4 iteraciones**: v1 72 → v2 74 (cero críticos) → subimos el presupuesto del validador para que leyera TODO el documento → v3 52 (con visión completa cazó truncados por max_tokens y contaminación de méritos) → config v4 (headroom +70%, headings del ensamblador, remand-only en méritos, guardrails §1208/Lozada) → **v4: 79 → re-validado 82 · would_approve · CERO críticos**.

**Fixes de plataforma que este test produjo (todos en main/PROD):**
- `f1520f5` presupuesto DINÁMICO del validador (lee el documento entero; piso 260K, objetivo 700K chars) — un memo real de 500K se valida completo.
- `1390cf7` **veredicto determinista** per rúbrica §5.3 (≥75 sin críticos = aprueba; críticos nunca aprueban; <50 rechaza) + **chip de 3 estados** en la UI (el 79 sin críticos mostraba "No se aprobaría" por el binario viejo).
- `350fa57`/`63a2848` techos de tiempo del validador (700s call / 800s ruta).
- Config del brief endurecida iterativamente (sections.json v4 + system prompt + rúbrica CoS).

**Captura**: `.playwright-mcp/valentina-premortem-aprobado.png` (82 · Se aprobaría en la UI).
**Coste total del test** (≈): cuestionarios $0.25 · briefs v1-v4 $6.0 · validaciones $17 · EOIR-26/extracciones ~$1 → ~$24.
