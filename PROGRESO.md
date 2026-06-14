# PROGRESO — UsaLatinoPrime V2

> Archivo de continuidad entre sesiones (PROMPT-CONSTRUCCION-V2 §4). Actualizar al cierre de cada sesión.
> Biblioteca SoT: `C:\Users\mauri\Documents\Trabajos\USALATINO V2\V2\docs\` · Supabase: **USALATINO V2** `uexxyokexcamyjcknxua`

**Fase actual: F3 — Scheduling + Vanessa (3 olas construidas, en verificación E2E) · Parte A auth email ✅ COMPLETA**
Última sesión: 2026-06-13

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

| Gates F3 | typecheck **0** · lint **0/0** · **507 unit tests** · build ✓ (28.6s) · **1128 claves i18n** (paridad) · E2E _en verificación_ |
|---|---|

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
