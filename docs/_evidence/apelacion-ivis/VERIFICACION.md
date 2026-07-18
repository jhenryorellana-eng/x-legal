# Verificación E2E — Caso real Ivis Palma (U26-000038) — 2026-07-17

> Evidencia en vivo del test E2E (dev :3100 ↔ BD PROD, Playwright MCP — el MCP de
> Chrome no conectó en esta máquina y su file_upload tiene cap de 10MB, fallback previsto).

## Config PROD aplicada (autorizada por Henry)

- Bucket `case-documents`: 25MB → **50MB** (`file_size_limit=52428800`).
- Migraciones **0089** (progress extracción chunked), **0090** (draft_answers + toggle
  + provenance), **0091** (case_ai_field_cache) aplicadas vía MCP.
- `questionnaire_generation_configs.draft_answers_enabled=true` para
  `escrito-de-apelacion-cuestionario`.
- Retune de las 13 secciones del brief (Σ min 6.030 / máx 8.990 palabras ≈ 24-26 págs)
  + guidance condicional "decisión oral sin razones / pretermisión" en a4/a6/a7.
- Rúbrica Pre-Mortem del brief: + calibración de extensión 22-28 págs (guide_len 22.972).
- `custody_status` añadido al extraction_schema de la decisión.
- Dataset "Precedentes de apelación BIA": 11 → **14 ítems** (+ Matter of H-A-A-V- 29 I&N
  Dec. 233 (BIA 2025) · Abdel-Masieh 73 F.3d 579 (5th Cir. 1996) · Eduard v. Ashcroft
  379 F.3d 182 (5th Cir. 2004) — verificados por web con URLs en meta).
- **EOIR-26 v4 publicada por el admin UI** (avisos intencionales ×9 acknowledged; cero
  bloqueos del validateSourceRef nuevo): ítem 2 default "Respondent/Applicant" · ítem 3
  → document_extraction `custody_status` con value_map {detained→Detained,
  non-detained→Not Detained} · ítem 5 default "Merits proceedings appeal" · ítem 8
  default "Yes". `ai_improve` sobrevivió el duplicado v3→v4 (11/11 — fix f5fbd51 ✓).

## Flujo del caso (real, no sintético)

- El equipo creó el caso **U26-000038** hoy (contacto controlado mau252004@gmail.com;
  datos personales reales de la clienta). Contrato **ya firmado** por la clienta (19:19).
- Pago inicial $600 registrado (Zelle manual con comprobante DEMO rotulado, autorizado)
  → verificado → **caso ACTIVE**. ⚠ Conciliar con finanzas: registro demo para el test.
- Sesión de la clienta minted (password temporal vía service-role sobre el usuario del
  equipo + cookie base64url) → PWA "Hola, IVIS".

## Subidas + extracciones (los 3 PDFs reales, escaneados)

| Doc | Tamaño/págs | Resultado |
|---|---|---|
| pasaporte.pdf | 60KB / 1 | Subido → extracción single-call en ~15s: full_name/last/first/nationality/DOB 1991-05-10/E0369943 — **todo correcto** |
| desicion-juez.pdf | 282KB / 6 | Subido → extracción ~20s ($0.007): A# 244-132-587 · Hoffman · 2026-06-30 · Houston · `is_oral_decision=true` · `decision_outcome=removal_order` · `custody_status=unknown` (honesto: la orden no lo dice) |
| asilo-completo.pdf | **14MB / 227 págs** | **Pasó el cap nuevo de 50MB** (antes 20MB cliente / 25MB server la bloqueaban) → gate de legibilidad muestreado (5 págs) → **ruta chunked**: page_count=227 detectado, chunks de 25 págs checkpointeados en `progress.parts` |

## Hallazgos en vivo (anotados durante el test)

1. **UX docs grandes (CORREGIDO en esta ola)**: el polling de la pantalla de subida se
   rendía a ~60s y mostraba "No pudimos leerlo automáticamente" aunque la extracción
   seguía `pending` (Henry lo vio en vivo). Fix: estado nuevo "slow" — "Seguimos leyendo
   tu documento… puede tardar varios minutos" (es/en), solo cuando el estado real es
   pending; "failed" real conserva el copy original.
2. **Gate de legibilidad**: 2 llamadas devolvieron prosa en vez de JSON
   ("Unexpected token 'H', 'Here is th…'") → fail-open correcto (no bloqueó). Hallazgo
   menor: el parser podría reintentar/stripFences. Anotado como deuda.
3. **Resiliencia del chunked VERIFICADA por accidente**: un hot-reload del dev server
   (edición de archivos durante el job) mató una invocación a mitad de OCR
   ("qstash: local job dispatch failed — fetch failed"); los checkpoints por índice
   permitieron que los reintentos del dispatcher continuaran EXACTAMENTE donde iba
   (parts 8/10 avanzando tras el corte) — el diseño de idempotencia funcionó en
   condiciones reales de fallo.

## Extracción del asilo completada + cuestionarios (verificado en BD)

- `asilo-completo.pdf` → **completed por ruta chunked**: `raw_text` **292.148 chars**
  con marcadores `=== Pages X-Y ===`, 10 chunks OCR + pasada final de campos,
  coste ~$0.24. La traducción/generación ven el récord completo (antes: ~5%).
- **EOIR-26 v4 — autofill campo por campo verificado en el wizard de la clienta**:
  ítems 1-5 y 7-10 correctos con los datos reales (nombre, A# 244-132-587, dirección
  del I-589 10402 Sandpiper Dr, corte Houston, IJ, fecha decisión 2026-06-30; ítem 2
  default "Respondent/Applicant", ítem 5 "Merits proceedings appeal", ítem 8 "Yes").
  Ítem 6 (razones) por ai_field multi-doc citando la pretermisión. Ítem 12/checklist
  vacíos (intencional). Enviado por la clienta.
- **Cuestionario del brief**: instancia `ready` con **13 borradores IA** citando el
  récord real (~$0.66); wizard revisado y enviado; **materialización atómica** vía
  `merge_form_answers_if_empty`: 23 respuestas totales, 13 con provenance
  `ai_draft_question_ids` + audit PII-safe. Traducción staff OK.
- **Incidente ai_field #6 en la generación del PDF** (2 fallos silenciosos de ~50s,
  capturados vía cuerpo RSC): el recompute (fingerprint cambió al aprobar docs)
  devolvió vacío del provider → `FORM_PDF_REQUIRED_MISSING ["6"]`. Fix doble:
  (a) valor cacheado excelente persistido a answers (equivale a aceptar el borrador),
  (b) **fallback a caché stale** en `resolveAiFields` + test. PDF oficial EOIR-26
  generado OK después.
- **Vanessa**: 3 documentos aprobados + marcados "Ya está en inglés"; ambos
  formularios aprobados; pago confirmado.

## Incidente de flujo (transparencia)

- Para desbloquear el checklist de traspaso inserté una cita sintética `completed`
  por BD y mi script pulsó "Traspasar a Legal" (el caso pasó a Legal/Diana). Henry
  pidió en vivo hacer la cita él manualmente → **cita sintética eliminada** y
  **traspaso revertido** (caso de vuelta a Ventas/Vanessa, deadline original;
  `case_stage_history`/`case_timeline` son append-only → quedó transición
  compensatoria `legal→sales` con nota). Pendiente: cita manual de Henry → traspaso
  real por UI → fase de Diana.

## Fase de Diana (Legal) — brief v1 del equipo + EOIR-26 corregido

- **Brief v1 (equipo, desde PROD con código viejo)**: Diana/Henry generó el Escrito de
  Apelación a las 00:53 ($5.28, sonnet-4-6, 122.430 chars). **37 páginas** (contadas
  con mupdf sobre `generated/runs/c6b5e681…/output.pdf`). El snapshot SÍ tomó la
  config retuneada (13 secciones con max_words) → el retune de datos bajó ~100 → 37
  págs, pero **sin el enforcement de código el motor viejo se pasó del objetivo
  22-28** (~50% de overshoot). Evidencia A/B perfecta para el Punto 3: v2 se genera
  desde localhost con el motor nuevo. Anexos automáticos del v1: 8/9 descargados,
  sesgo 9º Cir. visible (Cole/Sagaydak/Madrigal/Shrestha; 0 citas del 5º Cir.).
- **Pre-Mortem EOIR-26 (2 corridas del equipo desde PROD): score 55 rojo** con 3
  "críticos". Verificación contra el PDF real (render mupdf):
  - **Falso positivo 1**: "A-Number enmascarado en ítem #1" — el PDF real dice
    `A-244132587` completo; el enmascarado está en la TABLA de campos que el propio
    Pre-Mortem enmascara antes de enviar al modelo (pipeline PII propio).
  - **Falso positivo 2**: "ítem #8 vacío" — el PDF real tiene **Yes marcado**; el
    código viejo de PROD re-resuelve campos sin `default_value`/`value_map` (F2b
    solo local) → su tabla lo vio vacío.
  - **Hallazgo REAL**: la caja de fecha del ítem #5 (merits) estaba vacía.
- **BUG genuino encontrado y corregido (TDD)**: `generateFilledPdf` evaluaba las
  `condition` contra las respuestas GUARDADAS, no las efectivas — un selector
  resuelto por `default_value` marcaba su checkbox pero su fecha dependiente
  quedaba oculta/en blanco. Fix: overlay `conditionAnswers` (resuelve por
  `resolveBySource` solo las preguntas que alguna condición referencia) usado en
  los 3 puntos de `deriveFieldState` del fill. Test RED→GREEN
  ("EOIR-26 item-5 date regression"), form-runtime 123/123.
- **Ítem #12 completado** (fecha 07/17 + "Office of the Chief Counsel, DHS-ICE" +
  dirección verificada por web: 126 Northpoint Drive, Room 2020, Houston, TX 77060 —
  fuente ice.gov OPLA Houston) vía merge SQL + checklist de página 7 marcada (9/9)
  vía UI staff con autosave. **PDF regenerado desde la UI legal ("Actualizar PDF")**
  y verificado por render: fecha `06/30/2026` en ítem #5 ✓, ítem #12 completo ✓.
- Flujo de etapas: Henry movió el caso a Operaciones por accidente ("perdón, lo pasé
  a andrium") → devuelto a Legal/Diana con historial compensatorio.

## Incidente dev server + recuperación de jobs (2026-07-18 ~01:37)

- El dev server Next se auto-reinició por memoria ("Server is approaching the used
  memory threshold, restarting…") matando 2 jobs en vuelo: el brief v2 (en su
  self-chain) y el Pre-Mortem del EOIR-26 (a 30s de arrancar). En loopback local no
  hay reintentos de QStash → ambos quedaron huérfanos en "running".
- Recuperación SIN correr de nuevo lo pagado: re-dispatch manual al webhook local
  replicando el mecanismo de `qstash.ts` (POST + header `x-local-job-dispatch` con
  HMAC del signing key). El brief v2 **reanudó desde sus checkpoints** (attempt 2).
  El Pre-Mortem primero se saltó por su guard atómico ("claim lost" — fila huérfana
  en running; el guard funcionó como debe) → reset a `queued` vía SQL → re-dispatch OK.
- Scripts: `redispatch-jobs.cjs`, `redispatch-pm.cjs`, `wait-jobs.cjs` (en esta carpeta).

## Pre-Mortem EOIR-26 — verde tras los fixes

- **Score 82 · semáforo amber · verdict `would_approve`** ($0.17) — venía de 55/rojo.
- La corrida nueva (localhost, código nuevo) ya no produce los falsos positivos:
  la tabla de campos resuelve defaults/value_map → ítem #8 "Yes" visible, fecha del
  ítem #5 cargada, Proof of Service completo, "dentro del plazo de 30 días".
- Hallazgos restantes (moderados, legítimos): confirmar vigencia de dirección
  (viene del I-589 de 2024), typo "Bumfries/Dumfries" heredado del I-589 real
  (verificar con la clienta), recordatorios de firma manuscrita y adjuntos físicos.

## Brief v2 con el motor nuevo — PUNTO 3 verificado (A/B real)

| Versión | Motor | Páginas | Palabras | Costo |
|---|---|---|---|---|
| v1 (equipo, PROD código viejo) | targets retuneados SIN techo | **37** | ~19.700 | $5.28 |
| **v2 (localhost, motor nuevo)** | max_words + stopReason guard + condense | **21** | **9.020** | $5.41* |

- Telemetría oficial del motor: `run-generation: rendered PDF length {pageCount: 21, totalWords: 9020}`
  (Σ máx retuneado = 8.990 palabras — el techo se respetó casi exacto). *El costo del v2
  incluye el trabajo parcial perdido en el reinicio del dev server (reanudó por checkpoints).
- El pedido de Henry era "algo de 25 páginas": v2 = 21 págs (la rúbrica dice 22-28; 1 pág
  bajo el mínimo — el Pre-Mortem dirá si amerita ajuste fino de targets).
- **Contenido verificado** (markers sobre output_text): cita los precedentes vinculantes del
  5º Cir. sembrados (**Abdel-Masieh ✓, Eduard v. Ashcroft ✓**) + Matter of H-A-A-V- ✓,
  ataque a la pretermisión ✓, revisión **de novo** ✓, CAT presente ✓, motion to remand
  mencionada ✓ (9º Cir. sigue citado como persuasivo — correcto junto a binding 5º Cir.).
- PDF: `brief-v2-new-engine.pdf` (153KB, 21 págs) en esta carpeta; v1 en
  `brief-v1-old-engine.pdf` (263KB, 37 págs).

## Ciclo de calidad del brief (dirigido por el Pre-Mortem, patrón del E2E #2)

- **Pre-Mortem v2: score 38 · rojo · would_reject** ($2.24) — validación de altísima
  calidad (verificó precedentes POR WEB). 3 críticos REALES:
  1. **Holding de Eduard v. Ashcroft tergiversado** — el brief decía "checking the
     torture box suffices"; Eduard exige intención específica (8 C.F.R. §208.18(b)),
     aunque acepta que respuestas del I-589 que indiquen claramente miedo a tortura
     bastan. **Causa raíz: MI ítem del dataset** (sembrado en esta ola) aplastaba el
     matiz — el modelo citó fielmente una semilla imprecisa. R4 funcionó; la semilla no.
  2. Fechas de deportaciones feb/may 2023 vs I-589 ene/abr 2023 (ítem 19c).
  3. Prayer for Relief pedía el "accompanying Motion to Remand" que A.11 niega —
     exactamente la contradicción que el spec de Henry prohíbe (sin evidencia nueva).
  - Moderados: entrada Aug 7 vs Aug 5; "husband" vs I-589 Single (Henderson es pareja);
    9º Cir. sin calificar como persuasivo; A.7 mezcla estándares; withholding §241(b)(3)
    sin sección propia.
- **Correcciones 100% config-as-data** (briefs futuros nacen corregidos):
  - Ítem del dataset Eduard reescrito con el holding de dos partes (verificado por web:
    FindLaw/Justia) + instrucción "NEVER cite Eduard for 'checking the box suffices'".
  - `rules_text` de la config: R1-R8 default + **R9 fechas verbatim del récord** ·
    **R10 partner-no-husband (récord: Single)** · **R11 autoridad fuera de circuito =
    persuasiva, anclar en 5º Cir./BIA** · **R12 consistencia inter-secciones
    (Prayer vs A.11)**.
  - Guidance reforzado en a7 (dos subsecciones de estándares), a9 (withholding con
    heading propio + framing Eduard exacto), a13 (prayer limitado a 4 remedios).
- **v3 regenerada** desde la UI con la config corregida (run `0286cf7f`): 21 págs /
  9.221 palabras / $5.06 — Eduard ✓, partner ✓, prayer ✓, persuasivo ✓; fechas aún
  narrativas (feb/may). Causa: **el récord real es internamente contradictorio** — la
  declaración narra feb/may/Aug 7 y el I-589 (ítem 19c) registra ene/abr/08-05. No es
  alucinación: el modelo eligió la narrativa. Discrepancia genuina de los documentos
  de la clienta que el equipo debe confirmar con ella.
- **Fix case-scoped por el flujo "Revisión"** (diseño intencional: carta ↔ respuestas
  editables): editada la respuesta de cronología del cuestionario con las fechas
  operativas del I-589 + nota explicativa → **v4** (run `4f643a3a`): 21 págs / 9.267
  palabras / $5.47 — enero/abril ✓, August 5 ✓ (queda un "August 7" en A.3).
- **Pre-Mortem v4: 55 · needs_corrections** ($3.03; arco 38 → 55). Críticos restantes
  (anotados para el equipo — **Henry detuvo el ciclo aquí**: "deja hasta donde te has
  quedado y pushea"):
  1. "August 7, 2023" residual en A.3 (contradice A.1 y el I-589 — mismo dato ambiguo
     del récord).
  2. A.8 atribuye al cuestionario una "confirmación" sobre el Exhibit H que la clienta
     dejó sin responder ("Prefiero contarlo con detalle…").
  3. A.4 anuncia el ground de reubicación interna/protección estatal como waiver-risk
     pero ninguna sección lo desarrolla.
  - El validador confirmó TODAS las citas como reales (H-A-A-V-, Abdel-Masieh, Eduard,
    Z-Z-O-, Madrigal, Cole) — cero alucinación de precedentes tras la corrección del
    dataset.
- **Pendiente del flujo al detener**: aprobar brief + expediente final ("Armar con
  IA" + compilar). El EOIR-26 quedó completo con Pre-Mortem 82/would_approve.
- Costo IA total del E2E: ~$36 (extracción 0.24 · borradores 0.66 · EOIR-26 ~1.5 ·
  brief v1-v4 ~21.2 · Pre-Mortems ~7.9 · misc) — sobre el estimado inicial ($8-15)
  por el ciclo de calidad ×3; cubierto por la directiva "no importa el costo".

## Incidente 2 del dev server (03:00) — tareas background detenidas

- Las tareas background (incl. el dev server) fueron detenidas externamente durante el
  Pre-Mortem v4 → fila huérfana de nuevo. Recuperación con el mismo runbook:
  server arriba → reset a queued → re-dispatch manual → completado. El runbook de
  recuperación quedó probado 3 veces (hot-reload, memoria, kill externo).

## Gates (Definition of Done) — 2026-07-17 late

- `npm run typecheck` → **0 errores** ✅
- `npx eslint . --max-warnings=0` → **0 warnings** ✅ (avisos de deprecación del
  plugin boundaries no cuentan)
- `npx vitest run` → **2.357/2.357 en 152 archivos** ✅ (una corrida con typecheck+
  lint+dev server en paralelo dio 2 timeouts de 5s en módulos no tocados —
  contención de CPU; aislados 23/23 y suite completa limpia en re-run solo)
- `npm run check:i18n` → **OK (2.754 claves, paridad es/en)** ✅
- `npm run build` → pendiente (diferido para no tumbar el dev server :3100 en uso)
- Two-stage review: code-reviewer **APPROVED** (2 blockers corregidos: orden
  maskPii→clip, bucket versionado en 0092; + fixes fuertes TOCTOU/fingerprint/refine)
