# PROGRESO — UsaLatinoPrime V2

> Archivo de continuidad entre sesiones (PROMPT-CONSTRUCCION-V2 §4). Actualizar al cierre de cada sesión.
> Biblioteca SoT: `C:\Users\mauri\Documents\Trabajos\USALATINO V2\V2\docs\` · Supabase: **USALATINO V2** `uexxyokexcamyjcknxua`

**Fase actual: F0 — Fundaciones (entregables completos; demo pendiente de credenciales de Henry)**
Última sesión: 2026-06-12

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
