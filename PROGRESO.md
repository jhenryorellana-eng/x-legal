# PROGRESO — UsaLatinoPrime V2

> Archivo de continuidad entre sesiones (PROMPT-CONSTRUCCION-V2 §4). Actualizar al cierre de cada sesión.
> Biblioteca SoT: `C:\Users\mauri\Documents\Trabajos\USALATINO V2\V2\docs\` · Supabase: **USALATINO V2** `uexxyokexcamyjcknxua`

**Fase actual: F6 — Billing + Andrium (por olas). F6-Ola1 ✅ (motor billing Stripe+Zelle+ledger + pantalla Pagos cliente, COBRO REAL VERIFICADO EN VIVO). Siguiente: F6-Ola2 (panel Andrium /finanzas: kanban cobranza + cola impresión + gestión pagos). F0–F5 ✅.**
Última sesión: 2026-06-15

## F6 — Billing + Andrium (por olas; cadencia: ola por ola con OK de Henry)

> Plan: `~/.claude/plans/analiza-mi-proyecto-y-twinkly-reddy.md`. Decisión Henry: Ola-1 = motor billing + Pagos cliente (la demo de DOC-80 §F6 centra el "cobro desde el celular"). Stripe **test real** (claves `sk_test`/`whsec` SOLO en `.env.local`, gitignored). **Cero migraciones de esquema** salvo 1 correctiva autorizada (índice anti doble-cobro). Olas: **Ola-1** motor+Pagos cliente · **Ola-2** panel Andrium (kanban cobranza, cola impresión, pagos/cuotas, morosidad, cron) · **Ola-3** contabilidad + campañas + emails react-email + re-demo F1.

### Ola F6-1 — Motor billing (Stripe + Zelle + ledger) + Pantalla Pagos del cliente ✅ (construido + revisado APPROVED×2 + COBRO REAL VERIFICADO EN VIVO)
SoT: DOC-44 (billing) + DOC-71 (Stripe) + DOC-51 §8/PROMPT-CLI-08 (Pagos cliente) + DOC-48 §3.5 (API-BIL-*). **Cero migraciones de esquema** (verificado por MCP: `installments`/`payments`/`ledger_entries`/`stripe_customers`/`payment_plans` completas; `ledger_entries` ya tenía índice único parcial `(payment_id,kind)`).
- **Backend `billing`** (extiende el slice F2; +97 tests): domain (`reanchorDueDates` regla "mensuales desde la firma", `isOverdue`/`daysLate`, máquina de estados con actor); service (`createCheckoutSessionForInstallment` [monto SIEMPRE de la BD], `handleStripeEvent`, `applyPaymentSuccess`+asiento ledger, `applyPaymentFailure`, `applyRefund`, `submitZelleProof`/`confirmZellePayment`/`rejectZelleProof`, `getAccountStatement`, `onContractSigned` reanclaje service-role); **webhook `/api/webhooks/stripe`** (firma raw-body `constructEvent`, idempotencia canónica `claimWebhookEvent`); actions API-BIL-01/03/04/05/06/07/08/13 + rutas Zelle/payment-status. Eventos `payment.proof_submitted`/`payment.refunded`.
- **Pantalla `/pagos` cliente** (PROMPT-CLI-08): tarjeta resumen navy (próxima cuota + monto + ProgressBar) + plan de cuotas con StatusPills + métodos Zelle (subir comprobante) / Tarjeta (Stripe Checkout). i18n `cliente.pagos.*`.
- **Two-stage review** → NEEDS-REVISION → **APPROVED×2**: code-reviewer (2 BLOCKERs: orden crash-safe del ledger en `applyPaymentSuccess`; doble-cobro TOCTOU → **migración 0019** índice único parcial `payments(installment_id) WHERE pending+stripe`, autorizada y aplicada) + security-auditor (3 HIGH: webhook reintento con `claimWebhookEvent`; IDOR fail-closed si case_id null; rate limits `billingCheckout`/`billingUploadUrl`; MED: orgId del ledger desde BD no metadata). **0 CRITICAL, sin BLOCK-DEPLOY.**
- **🐛 Bug i18n cazado por el smoke en vivo**: `dueDate`/`progressLabel`/`installmentRow` con FORMATTING_ERROR (templates con placeholders resueltos con `t()` en vez de `t.raw()`) — mismo patrón que /legal. Arreglado.
- **COBRO REAL VERIFICADO EN VIVO** (María, Playwright + Stripe CLI `stripe listen` + Supabase MCP): `/pagos` → "Pagar con tarjeta" → **Stripe Checkout real** ("Cuota 2 de 10 — ULP-2026-0001", $500 de la BD) → `4242…` → **webhook real [200]** → cuota 2 `paid`+`paid_at`, pago `succeeded`+`stripe_payment_intent_id`, **asiento `ledger_entries` income/'cuota' $500**, barra del cliente a **"2 de 11"** + próxima cuota = la 3. **Idempotencia**: 5 eventos Stripe → 1 pago, 1 asiento, 5 procesados, 0 firmas inválidas. **0 errores de consola.**
- Gates: **tsc 0 · eslint 0 · vitest 1112/1112** (+~95) · **i18n 1329** (paridad es/en) · **build 0**.

### Pendiente menor / follow-up de F6-1
- Si la API de Stripe hace timeout a mitad del checkout, el row de payment queda huérfano (bloqueo temporal, no doble cobro) → job de limpieza en Ola-2 (TODO en el código).
- Destino Zelle: hoy vía env `NEXT_PUBLIC_ZELLE_DESTINATION` (puente); config en admin settings más adelante.
- Diferido (fiel a DOC-80, "tras propuesta SoT"): recordatorio manual de pago, export CSV ledger, conciliación global → Ola-2/3.

---

> **F4 DoD CERRADA y commiteada** (`8ebb64c`): E2E automatizados (§4.3/§4.6) + QA visual + axe + test presupuesto (RNF-042) + RLS test 4 + seam de IA env-gated. Aclaración de numeración: en DOC-81 §4 los *flujos* E2E se numeran F1–F6 y NO coinciden con las *fases* (el "flujo F4" §4.4 es expediente/Abogados = fase F5).

## F5 — Diana + expediente + Abogados (por olas; cadencia: ola por ola con OK de Henry)

> Plan aprobado: `~/.claude/plans/analiza-mi-proyecto-y-twinkly-reddy.md`. **🔑 El SaaS Abogados REAL está disponible** (código `C:\Users\mauri\Documents\Trabajos\Abogados\Abogado`, Supabase propio `skmxmzwmrtjvslfccgan`, claves reales en su `.env.local`). Decisiones Henry: V2 se conecta al **SaaS real local (:3100)** para el loop E2E + **mejoras seguras del §10** al SaaS ahora (barrido completo después); alcance **core de producción legal** (mensajería/notificaciones → F7). **El modelo de datos de F5 ya existe** (migraciones 0008/0009): cero migraciones de esquema.

### Pre-ola — Migración 0018 ✅
- **0018 (`merge_form_answers` RPC) aplicada y verificada** al remoto. El autosave de formularios ahora usa merge atómico (sin race window).

### Ola F5-1 — Módulo expediente + ensamblador + carátulas ✅ (construido + revisado + VERIFICADO EN VIVO)
- **`platform/pdf`**: `renderCoverPdf` (carátula navy/gold determinista) + `compileExpedientePdf` (merge de N ítems PDF/imagen vía `graftPage` de mupdf + índice TOC two-pass con páginas de inicio). De-risk clave: `DocumentWriter` falla en forms USCIS ("substitute font creation") → `graftPage` lo resuelve; numeración de pie diferida (mupdf WASM no crea fuentes substitutas). Commit `7f92964`.
- **Módulo backend `expediente`** (domain/service/repository/events/index + **73 tests**): carátulas (`generateCover`), ensamblador (`createExpediente` con guard 1-draft + attempt_no, `getExpedienteMaterial`, add/remove/reorder/updateItem con FK lógica + estado editable, archivo externo), `compileExpediente` (descarga de buckets → compileExpedientePdf → sube a `expedientes` → compiled/page_count; compile_failed on error), `createCorrectionAttempt` (clona ítems, attempt_no+1, inmutable). **Review fixes:** quité 2 emits `compiled` erróneos (create/correction) + añadí el guard de prefijo `external/{caseId}/` (path-injection). Commit `d8cc6a1`.
- **UI ensamblador** `/legal/expediente/[caseId]` (server actions + page + `ensamblador-view`): crear expediente, generar carátula, agregar/ordenar/renombrar/TOC material, compilar, ver PDF. Commit `bf3d1d9`.
- **Verificado en vivo como Henry** (caso de asilo de Carlos): crear expediente → generar carátula real → agregar carátula + I-589 llenado → **Compilar** → el `compileExpediente` REAL descargó ambos de storage, los fusionó y subió al bucket `expedientes` → **PDF de 14 páginas válido** (TOC "Índice del expediente" + carátula + I-589 con Ramírez/Houston/Carlos). 0 errores de consola.
- Gates: tsc 0 · eslint 0/0 · **882 tests** (+73).

### Pendiente menor de F5-1
- Títulos de material genéricos ("Automated Form"/"Cover") — usar el label real del form/generación (pulido).
- Numeración de pie de página en el PDF compilado (mupdf WASM no soporta fuentes substitutas — requiere asset de fuente embebida).

### Ola F5-2 — Validación con abogado (V2 ↔ SaaS REAL) + mejoras al SaaS + UI Validaciones ✅ (construido + revisado + VERIFICADO EN VIVO contra el SaaS real). Commits V2 `bc714f2` · SaaS `03e07e1`.
SoT: DOC-70 (contrato, verbatim) + DOC-26 §2.8 (cron) + DOC-54 §6/PROMPT-DIA-06 (UI). **Cero migraciones** (esquema ya existe; verificado por MCP: `legal_validations` con `cancelled`, `ai_generation_runs.output_text`, `webhook_events`).
- **Módulo backend `integrations`** (domain/repository/service/events/index + **54 tests**, TDD): serializadores deterministas (`buildClientLabel`, `serializeAutomatedForm` §2.4.1, `buildAnnexIndex` — **PII jamás sale de V2**, solo texto); `sendToLawyer` (gates with_lawyer+compiled+sin-activa, paquete por `item_type`, `source` explícito, maneja 202/200-dedup/400/401/409/5xx); `applyVerdict` (único punto de efectos, idempotencia compartida webhook+polling vía `webhook_events` `'{validation_id}:{verdict_at}'`); `processVerdictWebhook` (HMAC-SHA256 sobre body crudo, `timingSafeEqual`, 401 firma ausente/inválida + fila forense, source guard); `reconcileFromPolling` (cron `retry-abogados-polling`, DOC-26 §2.8: 6h, sent_at<24h, escalación 72h). Route `/api/webhooks/abogados`. Consumers cableados.
- **UI Diana** (diana/06): `/legal/validaciones` (global, filtros) + `[caseId]` (loop del intento: stepper, semáforo 🟢🟠🔴+IA score, 7 StatusPill, cards de findings por severidad con "Atendido"+atajos, modal "Crear intento de corrección", **"Reenviar intento corregido"**, timeline, CTA "Enviar a Andrium" deshabilitado→Ola-3). Simulador local `scripts/simulate-abogados-webhook.mjs` (DOC-70 §9.2, casos negativos).
- **Mejoras seguras al SaaS** (repo `Abogados\Abogado`, §10, tsc/lint/build verdes): **§10.5 firma OBLIGATORIA** (no envía sin firmar), **§10.2 redelivery con retry/backoff** (3 intentos), **§10.7 409 con `validation_id`**. (§10.4 cancelled omitido: el SaaS no tiene flujo de cancelación.)
- **Two-stage review** (code-reviewer → 3 blockers): #1 consumers no cableados (arreglado), #2 cutoff 24h (intencional, DOC-26 §2.8 manda — DOC-70 §6 le delega), #3 forense silencioso (arreglado: siempre loggea). + HIGH #4 (quitados 3 imports dinámicos `as string`), #8 (polling recupera filas sin external_validation_id), nit limit.
- **🐛 Bug de PRODUCCIÓN cazado por el E2E en vivo**: `applyVerdict` corre en contexto webhook (**sin sesión**); `cases.changeCaseStatus`→`findCaseById` usa `createServerClient` (RLS) → `CASE_NOT_FOUND`. Fix: cambio de estado del caso vía **service-role** (`setCaseStatusSystem`, como expedientes) — también elimina el ruido de audit "system". +tests.
- **VERIFICADO EN VIVO contra el SaaS REAL local (:3100)** (caso de Carlos → `with_lawyer` por UPDATE de 1 fila autorizado): Diana **"Enviar a abogado"** → **POST real → 202** → `queued`+`external_validation_id`+expediente `sent_to_lawyer`+caso `in_validation` → webhook `needs_corrections` (HMAC válida) → `corrections_needed`+findings+semáforo+score (UI renderiza Zona 3 exacta) → **"Crear intento de corrección"** (modal→intento 2 clonado→ensamblador) → **recompilar** (14 pág) → **"Reenviar"** (200-dedup manejado) → webhook `validated` → expediente **`approved`** + caso **`ready_for_delivery`** (UI card verde "Listo para radicar"). **Seguridad**: firma corrupta→401, sin firma→401, source ajeno→200 no-op. **0 errores de consola.**
- Gates: **tsc 0 · eslint 0 · vitest 960/960** (+54) · **i18n 1247** (paridad es/en).

### Pendiente menor de F5-2 / hallazgos
- El loop **completo §5 "nueva validación al re-POST"** requiere que el SaaS REAL emita el veredicto (sesión de abogado); con el simulador el SaaS mantiene su validación activa → el reenvío recibe **200-dedup** (manejado correctamente). Para el §9.1 completo contra el SaaS real, configurar un abogado revisor en el SaaS.
- "Mi Historia" (`cliente/historia`) sigue siendo placeholder (hallazgo de F4).

### Ola F5-3 — Handoff a Andrium (impresión) + kanban de casos de Diana + E2E §4.4 ✅ (construido + revisado APPROVED + VERIFICADO EN VIVO). 🏁 Cierra F5.
SoT: DOC-45 §3.8–3.9 (handoff impresión, verbatim) + DOC-54 §0–1/PROMPT-DIA-01 (kanban Diana) + DOC-47 (motor kanban) + DOC-81 §4.4. **Decisión Henry: fiel a DOC-80 → la UI de impresión de Andrium (`/finanzas/impresion`) llega en F6; en F5 las actions quedan backend-ready.** **Cero migraciones** (columnas de impresión + `board_kind='cases'/'collections'` ya existían).
- **Backend `expediente`** (handoff, TDD): `sendToFinance` (gate `approved` with_lawyer | `compiled` self; bloqueo de reenvío; `requireCaseAccess`), `markPrinted` (RF-AND-025: exige `sent_to_finance`+`compiled_pdf_path`), `markShipped`/`markFiled` (exigen `printed`, sin cambio de estado). Eventos `expediente.sent_to_finance` + `expediente.printed`.
- **Consumers** (cableados en `register-consumers`): `kanban.onExpedienteSentToFinance` → tarjeta idempotente en board `collections` de Andrium, columna **"Por imprimir"**; `cases.onExpedienteSentToFinanceCase` → asegura `ready_for_delivery`; `cases.onExpedientePrintedCase` → `delivered`. **Lección de Ola-2 aplicada**: las transiciones de estado del caso en eventos usan **service-role** (`transitionCaseSystem`/`findCaseByCaseId`), NUNCA `findCaseById` (RLS sin sesión).
- **Kanban de casos de Diana** `/legal` (molde del board de leads de Vanessa): `getBoard{kind:'cases'}`, 5 columnas semilla, tarjeta de caso (icono+`ULP-…`+chip "Con abogado"+cliente+servicio·fase+chips de alerta+TimeBadge+nota), drag&drop optimista, gestión de columnas, i18n `staff.legal.kanban.*`. Reads nuevos en `cases`/`kanban`: `listCasesForParalegal`, `backfillCasesBoard`, `getCaseBoardAlerts` (agregado batch: por revisar / correcciones del abogado / generación fallida / RFE vencida). + `sendToFinanceAction` y botón **"Enviar a Andrium"** habilitado en `validaciones/[caseId]` (con estado idempotente "Enviado a impresión").
- **🐛 2 bugs cazados por el E2E en vivo** (no los veían los unit tests): (1) el seed del **motor kanban** (F3) reventaba al crear un board en runtime — `.upsert(onConflict:'board_id,position')` sobre una constraint **DEFERRABLE** (Postgres la rechaza como árbitro) → 0 columnas; **primera vez** que se crea un board fuera de un seed SQL. Fix: insert plano + swallow 23505 (`seedBoardColumns`) + **self-heal** en `getBoard`/backfill/consumer (si 0 columnas, re-siembra). (2) `backfillCasesBoard` colisionaba `unique(column_id,position)` (varias tarjetas a la misma posición) → posiciones incrementales en memoria. (3) i18n `FORMATTING_ERROR` por `t(key)` sobre templates con `{n}` → `t.raw()`.
- **VERIFICADO EN VIVO** (Diana, navegador MCP + Supabase MCP; caso de Carlos `with_lawyer` validado, reset de 1 fila autorizado por Henry): **"Enviar a Andrium"** → expediente `sent_to_finance` (`by`=Diana) + caso `ready_for_delivery` + **tarjeta automática idempotente** en board `collections`/"Por imprimir" de Andrium (1, sin duplicar) + badge "Enviado a impresión". **`/legal` kanban** renderiza 2 casos (María/Carlos) con alerta real "Correcciones del abogado" + 5 columnas auto-sanadas, **0 errores de consola**. `markPrinted→delivered` cubierto por los 51 unit tests del handoff + el mecanismo de consumer→transición service-role ya probado en vivo (gemelo `ready_for_delivery`).
- **Two-stage review** (code-reviewer → NEEDS-REVISION → **APPROVED**): 2 HIGH cerrados (`requireCaseAccess` en las 4 actions de impresión — gap de aislamiento por org) + STRONG (timestamp único en markShipped/Filed, `card_id` real en broadcast, typo es.json). `console.error`→`logger` descartado (boundaries prohíbe app→platform; va a stdout del server).
- Gates: **tsc 0 · eslint 0 · vitest 1043/1043** (+83) · **i18n 1291** (paridad es/en) · **build 0**.

### Pendiente menor de F5-3 / follow-up
- Perf (no bloqueante): N+1 en `listCasesForParalegal` (mismo patrón pre-existente de `listCasesAdmin`, escala paralegal ~5-20 casos); batch de `findCardByRef` en backfill; constante para la etiqueta "Por imprimir"; double-read en `onExpedientePrintedCase`.
- `markPrinted/Shipped/Filed` quedan **backend-ready sin UI** (la cola de impresión de Andrium `/finanzas/impresion` es F6, decisión DOC-80).

### Siguiente: F6 — Billing completo + Panel Andrium `/finanzas` (kanban cobranza + cola de impresión [ver/descargar PDF + Impreso→Enviado→Radicado] + pagos/cuotas + contabilidad + campañas). DOC-44/55/71/73.

---

## F4 — IA engine + formularios (por olas; cadencia: ola por ola con OK de Henry)

> Decisiones Henry: modelo de generación legal = **Sonnet 4.6 (default) + Opus 4.7 (premium por formulario)**, conservando Fable 5 / Haiku 4.5 para tareas ligeras. Plan: `~/.claude/plans/analiza-mi-proyecto-y-twinkly-reddy.md`.

### Ola F4-0 — Spike AcroForm (de-risk R1) ✅
**Riesgo #1 del proyecto RESUELTO.** Spike contra 3 PDFs gubernamentales reales (I-765/I-360/EOIR-26):
- **Hallazgo**: los formularios modernos de USCIS son **XFA híbridos** con object streams comprimidos → **pdf-lib los lee como 0 campos o crashea**. **mupdf (Artifex wasm, serverless-friendly) los lee completos**: I-765 = **161 widgets**, I-360 = **510 widgets** (name/type/page/rect).
- **Receta confiable de llenado+aplanado** probada (drop XFA → setTextValue → update → bake → valor **visible en el PDF aplanado**, round-trip confirmado).
- **mupdf también hace HTML→PDF** → un solo motor para llenado de forms + render de generaciones (md→html→pdf). DOCX vía lib `docx` (Ola 1).
- EOIR-26 público es print-and-sign (0 campos → ruta de error del editor).
- **Decisión de arquitectura**: `mupdf` es el motor de formularios PDF (desviación documentada del SoT que asumía pdf-lib; evidencia en `docs/_evidence/f4-spike/SPIKE-FINDINGS.md`). pdf-lib/@cantoo removidos.
- Gates: tsc 0 · eslint 0/0 · **525 tests**. Commit `3dd644b`.

### Ola F4-1 — Motor `ai-engine` (backend, TDD) ✅
Módulo `ai-engine` (domain 13 funcs puras, service API-AI-01..10, repository, events) + `platform/pdf.ts` (mupdf: render md→pdf/docx + detect/fill AcroForm) + 5 jobs (run-generation/extract-document/translate-document/ai-budget-aggregation/job-failed) + hook de extracción en `confirmDocumentUpload` + migración aditiva 0017. Whitelist sonnet-4-6 (default) + opus-4-7.
- **Two-stage review aplicado** (code-reviewer → 2 críticos + PII + evento roto + nits). El agente de fixes se estancó → **tomé los fixes directamente**: **C-1** barrier de idempotencia `webhook_events` en la ruta QStash (nuevo `platform/webhook-events.ts` + orgId en payloads; crons exentos); **C-2** guard cross-tenant en cancel/regenerate/retry; **B-3** `completeRun` ahora SÍ emite `generation.completed`; **H-4** `maskPii` recursivo; **H-5** traducción sin fuente → `failed`; **M-8** guard colisión `raw_text`; **L-13/14/15** + tests de regresión. Deferido **M-12** (structured outputs del editor T2) → Ola 2.
- Gates: tsc 0 · eslint 0/0 · **672 tests** · build ✓ (mupdf wasm). Commits `91ab66b` + `d8416bc`.
- **Pendiente externo (Henry, no bloquea Olas 2-3)**: aplicar migración 0017; cargar `ANTHROPIC_API_KEY` + `GEMINI_API_KEY` para los runs reales de la demo.

### Ola F4-2 — Editor de formularios admin ✅
- **Backend** (los 6 stubs `CATALOG_STUB_F4` completados): `createAutomationVersion` (PDF→`detectAcroFields` mupdf→versión draft), `redetectFields`, `aiProposeStructure` (T2→grupos+preguntas ES/EN), `generateTestPdf` (`fillAcroForm`), `proposeExtractionSchema` (T2, schema Gemini-portable), `testGeneration` (→`startGeneration` isTest); datasets CRUD + auto-conteo de tokens; M-12 (structured outputs/retry de T2).
- **UI**: editor `/admin/catalogo/[serviceId]/formularios/[formId]` (modo PDF 4-etapas con **visor pdfjs** + overlays de campos en 3 estados; modo ai_letter config|prueba, **modelo default `claude-sonnet-4-6`**), `/admin/datasets` (CRUD + banner anti-PII), `/admin/ai-costs` (KPIs + barra de presupuesto).
- **Verificación EN VIVO (Henry admin, navegador MCP)**: las 4 pantallas renderizan con datos reales, 0 errores. **2 bugs cazados+arreglados en vivo**: hydration mismatch (token locale en ai_letter) + crash RSC en `/admin/datasets` (arrow-action inline).
- **Two-stage review** (code-reviewer → NEEDS-REVISION): 3 HIGH de seguridad + 5 MEDIUM, TODOS corregidos: **path injection en uploads** (`createAutomationVersion`/datasets validan prefijo de bucket + `validateUploadedObject` magic-bytes), **`raw_text` guard en save-time**, **cross-tenant** en updateDataset/updateDatasetItem/testGeneration, guard de versión en deleteQuestion, orden IA-antes-de-borrar en aiProposeStructure, `listDatasets` con actor real.
- Gates: tsc 0 · eslint 0/0 · **727 tests** (+27) · build ✓. Commits `d931bab`+`19d4367`+`9dfe5c0`.
- **0017 aplicada al remoto** ✓ (vía MCP). **Claves IA cargadas + validadas** (ping real: sonnet-4-6 y gemini-2.5-flash responden).

### Ola F4-3 — Form-wizard runtime + cliente ✅ (construido + revisado + VERIFICADO EN VIVO)
- **Backend runtime** (`cases`, DOC-41 §3.8–3.10): `getFormForClient` (versión+grupos+preguntas+prellenado resuelto), `saveFormDraft` (congela `automation_version_id`, merge JSONB por clave), `submitFormResponse` (validación server-side requeridas+regex/min/max+**select whitelist**), `approveFormResponse` (gate `filled_by`), `generateFilledPdf` (`resolveBySource`→`fillAcroForm` mupdf→bucket `generated`, gates FORM_PDF_BLOCKED/FORM_VERSION_MISMATCH), `getCaseExtractions`. **PII de `profile` se descifra y resuelve LOCALMENTE, nunca a la IA.**
- **Form-wizard cliente** (motor compartido `frontend/features/form-wizard/`, SOT-3 DOC-50 §6): data-driven por grupos, **Zod generado**, **autosave** (debounce + cola IndexedDB + backoff), prellenado **"Ya lo tenemos"**, dictado por voz; pantallas `formulario/[formId]`, lista, **Mi Historia**. **El preview del editor admin (F4-2) ahora usa el MISMO motor** (TODO resuelto). Verificado visual (10 screenshots, 0 errores).
- **Two-stage review** (code-reviewer → NEEDS-REVISION): **2 CRÍTICOS cross-tenant** (approve/generate leían por responseId con service-client sin `requireCaseAccess` → un staff de otra org podía aprobar/generar el PDF con PII de un caso ajeno) + 3 HIGH (select whitelist, validación silenciosa con versión sin preguntas, merge no atómico) + nits — **TODOS corregidos** + tests de regresión cross-tenant. Migración aditiva **0018** (RPC `merge_form_answers` atómica) creada — **pendiente de aplicar** (código funciona vía fallback).
- Gates: tsc 0 · eslint 0/0 · **799 tests** (+72) · build ✓ · i18n 1182. Commits `b0fe2e5`+`2dccfec`+`50c90b6`.

### Ola F4-3 — VERIFICADO EN VIVO (2026-06-14, MCP Playwright) ✅ + IA de propuesta enriquecida
- **Prueba de fuego IA (generación)** ✅: config `ai_letter` (memorándum-asilo) guardada vía editor → generación real Claude `sonnet-4-6` → memo legal de asilo (INA §208), **$0.0329**, PDF 288KB (mupdf). Commit `632cf99`. Evidencia `docs/_evidence/f4-fire/`.
- **Editor pdf_automation con IA grounded** ✅ (pedido de Henry): subí el **I-589 oficial real** (835KB) → mupdf detectó **460 campos** → "Generar propuesta con IA" ahora **investiga en vivo (web_search nativo de Claude)** las instrucciones oficiales + procedimiento del servicio y genera **6 grupos / 51 preguntas coherentes ES+EN**, tipos correctos (Fecha/Desplegable/Checkbox/Número/Párrafo), selects con opciones (incl. los 5 fundamentos INA §208 + CAT), mapeo a `profile` (whitelist) con PII local. Publicado v1. Arquitectura **dos pasos** (research → JSON tool-free) para no truncar en formularios grandes. Commit `47496ac`. Evidencia `docs/_evidence/f4-editor/`.
- **Wizard del cliente recorrido como Carlos** ✅: render data-driven, prellenado **"Ya lo tenemos"** (Ramírez/Carlos/El Salvador/tel desde perfil), selects→radios ES, ayudas, **autosave que persiste en la BD** (verificado), contador "Paso 1 de 6", **0 errores de consola**.
- **4 bugs de PRODUCCIÓN cazados en vivo** (los unit tests los mockeaban) — todos arreglados + tests de regresión:
  1. `mergeFormAnswers` desligaba `supabase.rpc` de su cliente → `this` perdido → **TODO autosave fallaba** en prod. Fix `.bind(supabase)`.
  2. `saveFormDraft` exigía `required` sobre el patch parcial → borrador rechazado. Fix `validateAnswerTypes(..., enforceRequired=false)` para draft.
  3. `z.string().uuid()` (Zod v4 estricto RFC) rechazaba UUIDs válidos en Postgres (ids demo no-v4) en writes. Fix helper `zUuid` laxo (módulo cases).
  4. `resolveWizardLabels` formateaba la plantilla ICU `Paso {n} de {total}` → `FORMATTING_ERROR`. Fix: echo de placeholders.
- Gates: tsc 0 · eslint 0/0 · **806 tests** (+7) · build ✓.

### "Prueba de fuego" CERRADA end-to-end (2026-06-14) ✅
- **Cliente recorrió y ENVIÓ el wizard en vivo**: llené las preguntas del I-589 como Carlos (prefill + autosave) y **envié** (`draft→submitted` en la BD real). El recorrido completo del cliente queda probado.
- **PDF I-589 llenado** ✅: resolví las respuestas enviadas + datos de perfil (`resolveBySource`: client_answer + profile) y llené el AcroForm oficial con la receta mupdf de `platform/pdf` — **23/23 campos**, verificado por texto (Ramírez, Carlos, El Salvador, periodista, El Paso…). Script `docs/_evidence/f4-editor/fill-i589.mjs` (+ `i-589-LLENADO.pdf` gitignored). Commit `9beb44c`.
- **5º bug de prod (submit)**: `submitFormResponse` validaba requeridas contra el `answers` crudo, pero las preguntas `profile`/`extraction`/`generation` se resuelven al render/PDF (su valor NO está en `answers`) → un formulario con nombre/teléfono desde el perfil **nunca podía enviarse**. Fix: resolver fuentes no-cliente antes de validar requeridas (+2 tests). **808 tests verdes.**
- **Hallazgo de calidad IA** (no bug): la IA marcó varios checkboxes sí/no como `is_required` → el wizard los fuerza a "sí". El admin debería volverlos opcionales o `select` (Sí/No). Mejora de prompt para la próxima iteración.

### UI staff de aprobación/generación — CONSTRUIDA y verificada en vivo (2026-06-14) ✅
- **Pantalla `/admin/casos/[caseId]/formularios`** (RF-ADM-010 / DOC-53 §3.4.3): lista las respuestas del caso con su estado y permite **Aprobar** (submitted→approved) y **Generar PDF**. Read nuevo `getCaseFormResponsesForStaff` (responseId+status+label+party+filledBy+pdf) + componente `CaseFormsManager`. Enlace "Formularios →" en el detalle del caso. Commits `3e494df`+`6c5ed7d`.
- **Verificado en vivo como Henry**: Aprobar → `approved`; Generar PDF → el **`generateFilledPdf` REAL** produjo un **I-589 llenado válido (1.85MB, 12 págs, todos los datos incl. la dirección que el cliente sobreescribió)** en el bucket `generated`, URL firmada abierta, UI → Regenerar/Ver PDF.
- **Bugs #6 y #7 cazados al generar el PDF real**: (#6) `generateFilledPdf` ignoraba el override del cliente sobre un prefill `profile` vacío → ahora prefiere `answers`; (#7) **`uploadBytesToStorage` usaba `bytes.buffer`** (todo el backing store wasm) → **corrompía TODO archivo generado** (el 1er PDF salió 27.6MB ilegible) → copia exacta de la vista. +2 tests.
- **Calidad IA mejorada**: el prompt de propuesta ahora prohíbe checkboxes sí/no obligatorios (usar select Sí/No u opcional).

> **F4 COMPLETA**: motor IA + editor con IA grounded + wizard cliente (fill→autosave→submit) + runtime + **UI staff aprobar/generar PDF** — todo verificado en vivo. **7 bugs de producción** cazados por el E2E en vivo (todos arreglados+tests). **809 tests · tsc 0 · eslint 0.**

### F4 — Cierre de DoD (2026-06-15) — gates verdes
Cierre de los 4 entregables de DoD que faltaban (DOC-80 §F4 + §6). 100% infra de test, sin cambios de producto.
- **Seam de test de IA** (`platform/ai-stub.ts`): stub determinista env-gated (`AI_E2E_STUB=1`) para Anthropic (T1 stream/finalMessage, T2 create research/segmentación/schema) y Gemini (T3/T4 generateContent). **Guard anti-prod: LANZA si el flag está en `NODE_ENV=production`** (nunca IA falsa a clientes reales). Cableado en `anthropic.ts`/`gemini.ts`. Fiel a las formas que parsea `ai-engine` (verificado contra el código). **10 tests** (`__tests__/ai-stub.test.ts`).
- **Seam QStash** (`platform/qstash.ts`): bypass de firma SOLO si `isAiStubEnabled()` (imposible en prod) **y** header `x-e2e-qstash-bypass` — deja a Playwright ejecutar handlers de job por la ruta real sin reverse-engineering del JWT Upstash. Entregas reales de QStash en dev (sin header) siguen verificándose. Helper `e2e/helpers/qstash.ts`.
- **Test de presupuesto IA (RNF-042)**: `jobs/__tests__/ai-budget-aggregation.test.ts` — **12 tests** (umbrales 0.79→nada, 0.80→`over_80`, 1.0/1.5→`over_100`, monthly-close, idempotencia por `dedupeKey`, payload inválido).
- **RLS pgTAP "test 4"** (DOC-31 §8.2): `supabase/tests/rls/11_client_ai_pipeline_hidden.sql` — cliente miembro NO ve `ai_generation_runs` ni `document_extractions` (0 filas) + `throws_ok(42501)` al insertar + contraste positivo staff. 5 aserciones. (Ejecución real en CI con `supabase test db`.)
- **E2E Playwright de superficies F4** (render + datos reales + 0 errores de consola; auth setups Diana/Carlos nuevos): `f4-formulario.carlos` (runtime del wizard I-589), `f4-aprobacion.diana` (aprobación + **Regenerar PDF** real → asserta `filled_pdf_path` vía service_role), `f4-admin-surfaces.admin` (catálogo "Nuevo servicio"/prueba-de-fuego + editor pdf_automation de 460 campos + ai-costs + datasets). **Smoke 8/8 verde** (corridos con `--no-deps --workers=2`). Aserciones de BD vía `e2e/helpers/db.ts` (service_role, solo lectura).
- **QA visual + axe** (`e2e/visual/f4-*.visual.spec.ts`): captura light+dark de las pantallas F4 + axe-core (`@axe-core/playwright` instalado). **8/8 verde · 12 baselines generadas** (`e2e/visual/*-snapshots/`, light+dark × 6 pantallas). axe en **modo report-only** (gate con `A11Y_GATE=1`): aflora deuda **preexistente y global** de color-contrast del design system (bottom-nav `#94a2b8/#fefeff`≈2.56:1; chip verde `#1bb673/#e7f7ef`≈2.37:1) — NO es de F4; fix de tokens es transversal y con implicación de fidelidad al prototipo → **`<<NEED-A11Y-FIX>>`** (follow-up).
- **Verificación en vivo (MCP Playwright)**: login cliente (Carlos) y admin (Henry) OK; runtime del formulario cliente, editor de formularios admin (I-589, 460 campos detectados por mupdf), pantalla de aprobación staff, ai-costs, datasets, wizard "Nuevo servicio" — **todo renderiza con datos reales, 0 errores de consola**.
- **Two-stage review (REGLA #3)**: code-reviewer → **`<<APPROVED>>`** (los dos seams security-críticos son **estructuralmente imposibles de activar en prod**: `isAiStubEnabled()` lanza en `NODE_ENV=production` → propaga a `getAnthropicClient`/`getGeminiModels`/`verifyQStashSignature`; service_role key sin prefijo `NEXT_PUBLIC_` → nunca al bundle). Fixes aplicados: +2 tests de caller-path del guard de prod; edge-case rollover día-31 en `getPrevMonthUtc` (job + test). HIGH (passwords demo hardcoded) = convención existente (maria/vanessa, ya en `seeds/01`).
- **Gates: tsc 0 · eslint 0 · vitest 906/906** (+24: 12 presupuesto + 12 stub) · **check:i18n OK** (1182) · **E2E smoke 8/8 · visual 8/8 + baselines**.
- **Hallazgos registrados**: (1) "Mi Historia" (`cliente/historia`) renderiza un **placeholder "Tu historia, muy pronto"** — pantalla cliente del ai_letter aún stub. (2) El I-589 pdf_automation vive en fase `sustentos` (no la actual `reforzar` de Carlos) → la lista de formularios del cliente (phase-scoped) redirige a /historia. (3) Dev server **Turbopack** corrompe su manifest RSC bajo carga sostenida (`/login` 500) → `dev:e2e` cambiado a **Webpack** (estable). (4) Login staff con **rate-limit** persistente (Upstash) limita re-runs E2E seguidos.
- **Nota de alcance**: el *journey mutante completo* de DOC-81 §4.3 (fresh fill→submit→approve) y §4.6 (create→publish→activate) asume **BD efímera de CI** (DOC-81 §6); contra la BD demo persistente (formularios ya enviados/aprobados) los specs cubren el **render + las acciones no destructivas** (Regenerar PDF). El pipeline de generación IA queda probado de forma determinista por el stub (tests unit) + cobertura de render E2E.

### Pendiente menor de F4 (opcional)
- Aplicar migración **0018** (RPC `merge_form_answers` atómica) — opcional, el autosave ya funciona vía fallback (el `.bind` lo desbloqueó).
- Wiring de la pantalla como **tab "Formularios"** dentro de `shared-case` (hoy es página dedicada + enlace) — pulido menor.
- **Datos demo en prod** (vía editor, autorizado): I-589 v1 publicada + respuesta de Carlos aprobada + PDF generado. Útiles como demo.

---

— F3 (cerrada): —

**Fase F3 — Scheduling + Vanessa ✅ COMPLETA y verificada en vivo (3 olas + pendientes de datos cerrados)**

## F3 — Scheduling + Vanessa (por olas)

### Ola 1 — Backend `scheduling` + `kanban`/`leads` (TDD) ✅
- **`scheduling`** (DOC-43): `domain.ts` puro con `materializeSlots` (impl. literal DOC-23 §6.4: días civiles en la TZ de la regla, conversión por instante con date-fns-tz, DST gap/overlap, franjas cruzando medianoche, resta de excepciones/booked con buffer, min_notice/max_advance), `effectivePolicy` (override caso > política fase > default), penalizaciones, `validateRuleSet`, máquina de estados. `service.ts` API-SCH-01..15 (`getAvailableSlots`, `bookAppointment` con EXCLUDE gist anti-solape→SLOT_TAKEN, `cancel`/`reschedule` atómicos con penalización, `complete`/`noShow`, disponibilidad, `getWeekAgenda`). Eventos `appointment.booked/cancelled/rescheduled/completed`.
- **`kanban`+leads** (DOC-47): tableros lazy con columnas semilla exactas (§2.2 por kind), `moveCard` + broadcast Realtime `board:{id}`, leads (`createLead` con aviso duplicado 2-niveles, `markLeadWon/Lost`, `createCaseFromLead`→delega a cases), `expressServiceInterest` API-LEAD-08 (CTA público), `staff_tasks`. Listeners §3.8: `case.assigned`/`contract.signed`/`downpayment.confirmed`.
- **notifications** extendido (matriz F3: appointment.*, lead.created) + **job** `appointment-reminders` (QStash */15, idempotente por `reminder_1d/1h_sent_at`) + `jobs/registry.ts`.

### Ola 2 — Panel Vanessa: 8 vistas ✅
Réplica del prototipo `V2/UI Vanessa/` con los componentes desktop (DOC-52, prompts vanessa/01..08): **Mi día** (KPIs, por-atender-ahora con time-badge, agenda, tareas, embudo, Lex), **Leads** (kanban tarjeta §2.2 + DnD `moveCard`, modales Nuevo lead / Nuevo caso 2 pasos), **Citas** (CalendarGrid semana/día/lista, horas duales con etiqueta ET, SidePanel, modal Nueva cita Cliente/Prospecto), **Disponibilidad** (grid recurrencia, excepciones, settings, levantar bloqueo, migración TZ), **Clientes** (lista casos + shared-case reusado de F2), **Métricas** (embudo/barras/donuts SVG), **Configuración**, **LexDock**. Evidencia: `docs/_evidence/f3-vanessa/*.png`.

### Ola 3 — Cliente agendar/cita + E2E + review ✅ (construido)
- **Pantallas cliente** (`caso/[caseId]/agendar` + `cita/[appointmentId]`, DOC-51 §18-19, prompts cliente/18-19): calendario navegable, slots en **TZ dual** ("2:00 PM" / "12:00 PM en Utah" — reusa `frontend/lib/datetime.ts`), recordatorios 1d/1h, nota, CTA agendar (maneja SLOT_TAKEN→refetch, REBOOKING_BLOCKED→pantalla bloqueo con fecha de desbloqueo); detalle de cita con reagendar/cancelar, estado completada, botón videollamada (deshabilitado "Pronto" — LiveKit es F7), confetti. Actions `getSlots/book/cancel/reschedule`.
- **Two-stage review** (`code-reviewer`): NEEDS-REVISION → 10 hallazgos corregidos (TDD): **C-1** reschedule atómico (insert-primero: cero pérdida silenciosa, invariante documentado), **C-2** `expressServiceInterest` valida pertenencia a org + `no_phone` + limiter por IP, **H-3** orden de `moveCard`, **H-4** reminder mark-antes-de-encolar (anti doble email) + comentario, **H-5** logs PII-safe, **H-6** `LEAD_NOT_FOUND`, **M-7** `getWeekAgenda` DST-safe, **M-8** doc. Migración opcional `0016_scheduling_rpcs.sql` (RPCs atómicas) escrita pero NO aplicada — el reorder es la impl. activa.
- **BUG-LEADS-001** (encontrado por el E2E): `/ventas/leads` y `/ventas/mi-dia` (Server Components) crasheaban al llamar `sourceMeta()` de un módulo `"use client"`. Fix: helpers puros extraídos a `vanessa/shared/source-meta.ts` (sin "use client"); `ui.tsx` re-exporta. Build ✓.
- **E2E flujo F1** (DOC-81 §4.1): specs Playwright vanessa + maria (storageState; login email del cliente sembrado por sesión — el OTP en vivo espera SMTP). _(resultado en verificación — ver línea Gates F3.)_
- **EV-01/EV-02** (`service.published`/`form_version.published`): ya se emiten en `catalog/service.ts` — gap del plan ya cerrado.

| Gates F3 | typecheck **0** · lint **0/0** · **525 unit tests** · build ✓ · **1138 claves i18n** (paridad) · verificación en vivo MCP ✓ (8 vistas Vanessa + home/agendar/cita cliente, datos reales, 0 errores) |
|---|---|

### Verificación EN VIVO con navegador (MCP Playwright, 2026-06-13)
Dev server limpio + sesiones autenticadas reales (login real de Vanessa + sesión inyectada de María). **Las 8 vistas de Vanessa + home/agendar/cita del cliente renderizan con datos reales y 0 errores de consola.** Confirmado el feature núcleo: **hora dual** "10:00 AM (Florida ET) · 8:00 AM en Utah" en la cita real de María; calendario de agendar con días disponibles tappables + aviso de penalización 7 días.

**5 bugs reales encontrados SOLO por el dogfooding en vivo** (ninguno lo veía el build —páginas `force-dynamic`— ni los unit tests —no existía sesión cliente real antes del auth email—):
1. `ventas/mi-dia`: `onScheduleLead={() => {}}` pasado Server→Client (crash RSC, 500). Fix: prop opcional + default por router cliente.
2. `ventas/metricas`: `onPeriodChange={() => {}}` mismo crash RSC (500). Mismo patrón (default empuja `?period=`).
3. `cases.getCasesForClient`: llamaba `can()` (staff-only) → `AuthzError wrong_kind` en el `/home` del cliente (500). Fix: guard de kind cliente (RLS escopa filas) + **test de regresión**.
4-6. `cliente/home` i18n: `t()` sobre `phaseShort`/`greeting`/`documentsLeft` lanzaba FORMATTING_ERROR (mostraba las claves crudas) — son templates crudos sustituidos aguas abajo. Fix: `t.raw()`.

Evidencia: `docs/_evidence/f3-verify/verify.cjs` + screenshots MCP.

### Pendientes menores de datos — CERRADOS (2026-06-14, verificados en vivo)
1. **Nombre del asesor en la cita del cliente** ✅ — `scheduling.getAppointmentAdvisor` (requireCaseAccess + read service-role de solo `{displayName, avatarUrl}`). La cita muestra "Vanessa, tu asesora" + avatar. +6 tests.
2. **`getWeekAgenda` cableado a la vista Citas** ✅ — semana actual real (DST-safe) + cada cita enriquecida con `clientName` (batch client_profiles+leads, sin N+1). El bloque del calendario muestra "María", no el UUID. +5 tests.
3. **Agregados de Métricas reales** ✅ — `kanban.getSalesMetrics` (§6.2: embudo, fuentes, donuts, velocidad, asistencia); em-dash donde el dato es genuinamente desconocido (DOC-50 §5). +4 tests · +10 claves i18n.

Verificado en vivo (login real Vanessa + sesión de María acuñada con signInWithPassword contra el proyecto real): los 3 renderizan datos reales, 0 errores de consola. **Gates: tsc 0 · eslint 0/0 · 525 tests · i18n 1138 paridad.** Queda solo lo externo de Henry (SMTP para login email en vivo del cliente; migración 0016 opcional).

**Pendiente externo (no bloquea la construcción, paso de Henry)**: SMTP en Supabase Auth (Resend) para el login email en vivo del cliente; aplicar migración 0016 si se quiere la atomicidad por RPC (opcional).

---

## Parte A — Auth cliente por EMAIL (cambio al SoT DOC-22 §1) ✅
> Decisión del dueño: el cliente se autentica por **email** (capturado en el alta del caso), NO por OTP de teléfono. El teléfono queda como contacto opcional. Sustituto: **email OTP de 6 dígitos (Supabase nativo, cero Twilio)**.
- Backend refactorizado: `requestClientOtp`/`verifyClientOtp` por email, `provisionClientUser` idempotente por email (`email_confirm:true`, phone opcional), `checkClientEligibilityByEmail`, limiters email. domain `normalizeEmail`/`isValidEmail`/`normalizeEmailStrict`.
- Frontend: `/phone`→`/email`, `/otp` conserva (código por email), welcome CTA, middleware rutas públicas. Modal Nuevo caso: campo Email (identidad) + teléfono opcional.
- i18n `cliente.email.*` (796 claves, paridad). SoT DOC-22 §1 actualizado.
- Gates: typecheck 0 · lint 0/0 · **322 tests** · build OK · /email render verificado.
- **Pendiente externo (no bloquea F3, paso de Henry)**: configurar SMTP en Supabase Auth (Resend) — o un test-OTP en el dashboard — para que el código por email se entregue de verdad. Clientes demo María/Carlos ya tienen email; María tiene caso activo → lista para el demo de login email.

— F2 (cerrada): —

> **Gate del negocio F1 demostrado de punta a punta con navegador real (MCP):** staff crea caso (modal Nuevo caso →
> provisiona usuario cliente H-2 + caso payment_pending + contrato + plan) → cliente firma en /firma/[token] público
> (contrato signed, token anulado single-use) → staff registra pago Zelle → evento downpayment.confirmed → caso
> ACTIVADO (active + opened_at + fase 1 "Documentación inicial" + phase_history). Caso real: **ULP-2026-0003** (Rosa Méndez).
>
> **5 bugs reales encontrados SOLO por el dogfooding en vivo** (ningún test unitario los veía):
>   1. CRÍTICO: el event bus era un const de módulo → instrumentation y la server action tenían instancias
>      distintas (bundles separados de Next.js) → el consumer del gate NUNCA disparaba, el caso no se activaba.
>      Fix: bus respaldado en globalThis + flag de registro en globalThis.
>   2. createCaseFromContract NO existía (la action solo creaba un contrato huérfano) → implementado el orquestador
>      completo (DOC-41 §3.1) + provisionClientUser (H-2) en identity.
>   3. La activación no fijaba current_phase_id (getCatalogFirstPhase "diferido a F3" pero DOC-41 §3.4 lo pide en F2) → añadido.
>   4. El modal dejaba enviar una parte a medio llenar → error duro confuso. Fix: descartar filas de parte incompletas.
>   5. Cosmético: la firma pública mostraba "—" como servicio (plan_snapshot sin serviceLabel) → añadido al snapshot.
>
> Pendientes externos que NO bloquean F3: **Twilio Verify** (OTP SMS real — necesario para que el cliente entre por su
> celular; la demo del lado cliente quedó verificada a nivel de datos: Rosa es elegible por tener caso activo),
> Upstash Redis (rate limit prod), SMTP Resend en Supabase Auth, passwords reales del staff.

## Estado F2 por entregable

| Entregable | Estado |
|---|---|
| Módulos `cases` + `contracts` (máquinas de estado, createCaseFromContract idempotente, firma token, T&C, RFE, timeline) | ✅ |
| Slice `billing` (createPaymentPlan, registerZellePayment → downpayment.confirmed) | ✅ |
| `notifications` mínimo (dispatcher matriz F2) + job `deliver-notification` + webhook qstash + `instrumentation.ts` | ✅ |
| `provisionClientUser` (H-2: alta auth+users+client_profiles sin sesión, idempotente por phone) | ✅ |
| Componentes móviles DOC-01 §5.2 (ScreenHead, BottomNav, BottomSheet, Confetti, Tutorial, SignaturePad, FABs) | ✅ |
| Pantallas cliente (home, servicios, disclaimer+firma, camino, proceso, bitácora, documentos+subir+corregir+éxito, datos, más, config) | ✅ |
| Firma pública `/firma/[token]` (anti-enum, single-use, rate limit, scroll-gate, SignaturePad) | ✅ |
| Admin casos + shared-case (tabs Resumen/Documentos/Partes, RFE aprobar/rechazar, registro pago Zelle, modal Nuevo caso) | ✅ |
| pgTAP test 18 (signing token) | ✅ |
| Two-stage review F2 | ✅ NEEDS-REVISION → C-1/C-2/C-3/H-1/H-2/H-3/M-1..M-4 aplicados → gates verdes |
| Gates F2 | ✅ typecheck 0 · lint 0/0 · **316 unit tests** · build OK · 783 i18n · **E2E 30/30** · gate live verificado |
| Demo F2 a Henry | ✅ LISTA (gate del negocio funciona en vivo; ver ULP-2026-0003) |

— F1 (cerrada): —

## Estado F1 por entregable

| Entregable | Estado |
|---|---|
| Módulo `catalog` (CRUD servicios/planes/fases/hitos/docs, reglas publicación §2.4-2.6, getCaseRequirements, stubs F4) | ✅ |
| Módulo `audit` (writeAudit en toda mutación staff, listado, export CSV) | ✅ |
| `identity.inviteEmployee` + matriz permisos + EV-03 → email staff-invite | ✅ |
| Módulo `org` (nuevo: settings, terms_versions, cover_templates — decisión de cohesión documentada) | ✅ |
| Shell staff: Sidebar por permisos + 11 componentes desktop DOC-01 §5.3 | ✅ |
| Pantallas admin: dashboard, catálogo+wizard 6 pasos, empleados+matriz, auditoría+CSV, configuración | ✅ |
| pgTAP tests 6-9, 12-13 (37 aserciones) + corrección de fixtures F0 (bug de schema detectado) | ✅ / en curso |
| E2E Playwright wizard (17 tests — 16 esperan activación del Auth Hook; corren en CI local) | ✅ escrito |
| Two-stage review F1 | ✅ NEEDS-REVISION → 11 fixes aplicados + fail-closed extra → gates verdes |
| E2E Playwright (auth real, storageState) | ✅ 30/30 — evidencia en docs/_evidence/f1-final/ |
| Demo F1 a Henry | ✅ LISTA — login henry@usalatinoprime.com / changeme-henry! → /admin |

— F0 (cerrada salvo ítems externos): —

---

## Estado F0 por entregable

| Entregable | Estado |
|---|---|
| Repo + árbol DOC-21 + ESLint boundaries (5 reglas) + env Zod | ✅ |
| Migraciones 0001–0015 escritas Y aplicadas al remoto (69 tablas, RLS 100%) | ✅ |
| Seeds 01/02/03 aplicados (13 servicios, 4 staff, 2 clientes demo) | ✅ |
| Tipos generados `database.types.ts` + `check-db-drift.mjs` | ✅ |
| Suite pgTAP RLS (tests 1, 10–12, 14, 17 → 43 aserciones, corren en CI) | ✅ escrita (corre en CI con Docker; sin Docker local) |
| Design system DOC-01 (tokens, fonts, motion, 12 componentes brand, 54 iconos, Lex 0.977MB, showcase `/design`) | ✅ |
| Platform clients (15 archivos) + TDD (61 tests) | ✅ |
| Auth completa: OTP cliente con gate anti-enumeración, staff login/reset/cambiar-password, middleware guards, Actor/can() | ✅ código (demo E2E necesita credenciales ↓) |
| i18n next-intl sin prefijo + paridad es/en (73 claves) | ✅ |
| CI GitHub Actions (quality, rls-tests, db-drift, secret-scan) | ✅ escrito (sin repo GitHub remoto aún) |
| Two-stage review: code-reviewer → NEEDS-REVISION → fixes C-1/C-2/H-1/H-2/M-1/M-2/L-1/L-2 aplicados → gates re-verificados | ✅ |
| Gates: typecheck 0 err · lint 0 warn · 103/103 Vitest · build OK · boundaries-violation test probado y revertido | ✅ |

## Pendientes BLOQUEANTES para la demo F0 (necesitan a Henry)

> Actualizado 2026-06-12 (tarde): Henry entregó service role ✅, Resend ✅ y QStash ✅ — ya cargadas en `.env.local` y verificadas (QStash respondió 200 al event log; Resend es key send-only, válida pero solo verificable con un envío real autorizado).

1. **Ejecutar `supabase/fixes/2026-06-12-remote-repair.sql` en el SQL Editor** (una vez). Repara: (a) los 6 usuarios seed de `auth.users` que hoy hacen 500 "Database error querying schema" en TODA llamada de Auth (columnas token en NULL + teléfonos sin confirmar — bug encontrado por la suite Playwright); (b) el claim `must_change_pw` del hook (fix C-1 del review). Los seeds fuente ya están corregidos para futuros resets.
2. **Activar el Auth Hook** en el dashboard: Authentication → Hooks → Custom Access Token → `public.custom_access_token_hook`. Sin esto, ningún login (staff o cliente) pasa los guards (claims ausentes ⇒ unprovisioned).
3. **Twilio Verify** (Account SID, Auth Token, Verify Service SID) → configurar como SMS provider en Supabase Auth + habilitar proveedor Phone → OTP real por SMS.
4. **Upstash Redis** (REST URL + token) → `.env.local` (mientras tanto el rate limiting usa fallback in-memory SOLO en development). OJO: las credenciales QStash recibidas son del producto QStash (jobs); el Ratelimit necesita un Redis de Upstash, es otro recurso.
5. **SMTP custom de Resend en Supabase Auth** (dashboard) → emails de reset/invitación staff.
6. **Passwords reales de los 4 staff** (placeholders `changeme-*` del seed; resetear tras el fix 1).

## Decisiones tomadas (registro)

- **Repo en carpeta independiente** `C:\Users\mauri\Documents\Trabajos\usalatino-v2\` (decisión de Henry, 2026-06-12).
- **Sin Docker/CLI local**: migraciones aplicadas al remoto vía MCP; pgTAP corre en CI (ubuntu tiene Docker). `supabase db reset` local queda disponible si se instala Docker Desktop.
- **`src/middleware.ts`** en la raíz de src/ (Next.js lo exige; el árbol de DOC-21 lo dibuja dentro de `app/` — propuesta de corrección al SoT abajo).
- **Imports TS sin extensión `.js`** (Turbopack no resuelve `./x.js`→`x.ts`; typecheck/Vitest sí — gate de rutas 200 lo detectó).
- **Rate limiting**: tiers secuenciales (un deny corto no consume cuota de tiers largos — fix C-2); fallback in-memory SOLO en development con warning.
- **`must_change_pw` viaja como claim top-level del JWT** (fix C-1; getClaims() no expone app_metadata).
- **Logger escribe vía `console.*`, no `process.stdout`**: el middleware (Edge Runtime) lo importa y Turbopack rechaza process.stdout en bundles Edge. Mismo JSON estructurado en ambos runtimes.
- **invalid_phone devuelve `{ok:false}`** (M-3 del review): formato inválido es computable client-side, no filtra existencia de cuentas. Si Henry prefiere literalidad absoluta de DOC-22 §1.4 ("la UI transiciona SIEMPRE a OTP"), se cambia en 1 línea.
- **Upload TTL**: Supabase fija las signed upload URLs en 2h (DOC-27 §5 pedía 15 min — no configurable). Mitigación: token single-use + confirmación server-side.

## Propuestas de cambio al SoT (abiertas, esperan decisión de Henry)

| # | Doc | Propuesta |
|---|---|---|
| P-1 | DOC-21 §1 | Mover `middleware.ts` del dibujo `src/app/` a `src/` (requisito de Next.js) |
| P-2 | DOC-01 §2 | Plus Jakarta Sans solo existe hasta peso 800 en Google Fonts (el doc pide 900) — ratificar clamp a 800 |
| P-3 | DOC-01 §3 | `<<NEED-A11Y-FIX>>`: pares de contraste normativos (StatusPill/Chip texto-sobre-tinte: gold-deep/gold-soft 1.93:1, green/green-soft 2.37:1) no pasan WCAG AA — ¿ajustar tokens o aceptar con mitigación icono+texto (§8.4)? |
| P-4 | DOC-30 | La tabla interna `_case_number_counters` (helper de `next_case_number()`) no figura en las 68 — documentarla |
| P-5 | DOC-30 §11 | El bloque notifications dice "4 tablas" pero son 5 (`campaign_recipients`) — corregir conteo |
| P-6 | DOC-32 §4.1 | Seed 01: módulo `community` para finance sembrado como E (la matriz DOC-22 §6 lo confirma) — ratificar |

## Riesgos/recordatorios activos

- R2/F5: pedir **sandbox/staging del SaaS Abogados** con lead time (DOC-70 §10.3) — recordar al iniciar F3-F4.
- R1/F4: spike AcroForm en semana 1 de F4 con I-765/I-360/EOIR-26 reales.
- Advisors Supabase (WARN, no bloquean): extensiones pg_trgm/btree_gist en schema public; Leaked Password Protection desactivada (toggle en dashboard).
- Precios de `service_plans` en 0 (Henry los fija desde el editor Admin en F1+).

## Cómo retomar (sesión nueva)

1. Leer este archivo + `C:\Users\mauri\.claude\plans\analiza-mi-proyecto-y-twinkly-reddy.md` (plan aprobado).
2. Si la demo F0 ya tuvo OK de Henry → arrancar F1 (Catálogo + Admin core): leer DOC-40, DOC-53, DOC-14, DOC-22 §6, DOC-48 §3.1–3.2 y presentar plan corto de fase.
3. Si no → completar pendientes bloqueantes de arriba y hacer la demo (login OTP `+17865550101`, login staff, showcase `/design`).
