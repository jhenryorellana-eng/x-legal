# Go-live runbook — UsaLatinoPrime V2.0 (DOC-82 §8)

Guía paso a paso para lanzar producción. **F0–F8 están construidas y verificadas.**
Lo marcado **✅ CÓDIGO** ya quedó listo en el repo; lo marcado **⬜ HENRY** son acciones
externas (deploy, DNS, cuentas, secretos) que ejecutas tú, guiado por esta lista.

> Dominio objetivo: **`app.usalatinoprime.com`** · Supabase: `uexxyokexcamyjcknxua` ·
> Repo: `usalatino-v2` · F6 staging actual: `https://x-legal-nine.vercel.app`

---

## 0. Artefactos de código listos (esta sesión)
- ✅ `vercel.json` (framework nextjs + región `iad1` — **verifica que coincida con la región de tu proyecto Supabase**; si tu Supabase está en otra región, cámbiala).
- ✅ `.vercelignore` (excluye docs/e2e/tests del build).
- ✅ `scripts/provision-schedules.mjs` (aprovisiona los 6 crons QStash, idempotente).
- ✅ Headers de seguridad + CSP (Report-Only) en `next.config.ts` + `src/middleware.ts`.
- ✅ Gate `check:assets` en CI (`.github/workflows/ci.yml`).
- ✅ RLS pgTAP 30/30 en `supabase/tests/rls/` (corren en el job `rls-tests` del CI).
- ✅ `route.ts` de QStash con `maxDuration = 300` (jobs de IA largos; capado por el plan Vercel).

---

## 1. Variables de entorno en Vercel (scope **Production**)
Crear TODAS en el environment Production (no mezclar con preview). `src/backend/platform/env.ts` valida las core al boot.

**Core (la app no arranca sin ellas):**
```
NEXT_PUBLIC_SUPABASE_URL            https://uexxyokexcamyjcknxua.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY       <anon key prod>
SUPABASE_SERVICE_ROLE_KEY           <service role prod>          (secreto)
NEXT_PUBLIC_APP_URL                 https://app.usalatinoprime.com
ENCRYPTION_KEY                      <AES-256-GCM, 32 bytes base64 — generar nuevo>   (secreto)
```
Generar la key: `openssl rand -base64 32` → guardar en gestor de secretos del dueño + Vercel.

**Proveedores (runtime, lazy):**
```
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET                 (Stripe LIVE)
TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_MESSAGING_SERVICE_SID
QSTASH_TOKEN / QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY
UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
LIVEKIT_API_KEY / LIVEKIT_API_SECRET / NEXT_PUBLIC_LIVEKIT_URL
RESEND_API_KEY / RESEND_WEBHOOK_SECRET
ANTHROPIC_API_KEY · GEMINI_API_KEY
ABOGADOS_API_URL / ABOGADOS_API_KEY / ABOGADOS_WEBHOOK_SECRET / ABOGADOS_CALLBACK_URL
NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY          (Web Push — los de .env.local)
```
> El `build` usa solo dummies (DOC-82: el build no requiere secretos reales).

---

## 2. Base de datos (una sola vez en bootstrap)
1. Aplicar migraciones a prod: `supabase db push` (0001–0015) → `supabase migration list` limpio.
2. Setear `app.environment='production'` (guarda anti-seed-03).
3. **Crear los 4 staff reales en `auth.users`** (con sus emails reales) ANTES de los seeds — vía Admin API de Supabase o el bootstrap de staff. El seed 01 los resuelve por email.
4. Ejecutar **seed 01** (org + 4 staff + permisos + `terms_versions` v1.0 + cover templates + lead categories) y **seed 02** (13 servicios + fases + docs). **NO ejecutar seed 03** (demo).
5. Antes del seed 01: **pegar el texto legal real del disclaimer** (`terms_versions` v1.0). ⬜ HENRY
6. Tras seed 02: **definir los precios reales** del catálogo desde Admin (los seeds traen 0). ⬜ HENRY

---

## 3. QStash schedules
```
QSTASH_TOKEN=... NEXT_PUBLIC_APP_URL=https://app.usalatinoprime.com node scripts/provision-schedules.mjs
```
Crea/recrea los 6 crons (installment/appointment/contract reminders, retry-abogados, ai-budget threshold+monthly-close, purge-retention). Verifica en la consola Upstash. Test manual de `appointment-reminders`.

---

## 4. Webhooks a registrar (en cada proveedor → apuntando a prod)
- **Stripe** (LIVE): `…/api/webhooks/stripe` → `STRIPE_WEBHOOK_SECRET`. Test: pago real $1 + reembolso → asiento.
- **Resend**: `…/api/webhooks/resend` (svix) → `RESEND_WEBHOOK_SECRET`. Test: email transaccional entregado.
- **LiveKit**: webhook del proyecto Cloud prod. Test: llamada entre 2 dispositivos.
- **SaaS Abogados**: intercambiar secretos, `source='usalatinoprime-v2'`, callback `ABOGADOS_CALLBACK_URL`. Test caso `e2e-`.

---

## 5. Seguridad — flip de CSP a enforcing (tras ventana Report-Only)
La CSP va como `Content-Security-Policy-Report-Only` (no bloquea). Tras ~2 semanas con reportes limpios:
1. En `src/middleware.ts`, cambiar `CSP_HEADER` de `"Content-Security-Policy-Report-Only"` → `"Content-Security-Policy"`.
2. Añadir el nonce + `suppressHydrationWarning` al `THEME_INIT_SCRIPT` en `src/app/layout.tsx` (hoy es el único inline sin nonce — en Report-Only solo se reporta).
3. **Henry (dashboard Supabase Auth)**: activar *leaked-password protection* (HaveIBeenPwned) + MFA TOTP para admins.
4. Verificar headers/CSP en prod (devtools).

---

## 6. Dominio + DNS ⬜ HENRY
- Asignar `app.usalatinoprime.com` al proyecto Vercel (CNAME → Vercel, certificado automático).
- DNS de email: MX, SPF, DKIM, DMARC (`p=none`) + verificar dominio en Resend (`mail.usalatinoprime.com`).
- Twilio Verify en vivo (OTP real al teléfono del equipo; quitar números de prueba).
- SMTP Resend en Supabase Auth (email de invitación desde el dominio).

---

## 7. Operación ⬜ HENRY
- Monitor sintético (uptime) con alertas a Henry + dev on-call.
- Ensayar runbooks de DOC-82 §9 (mínimo: rollback + restore PITR).
- Bitácora de incidentes + canal de soporte interno.
- Plan de drenaje del legacy comunicado.
- PITR/backups habilitados.

---

## 8. Checklist DOC-82 §8 (35 ítems) — estado
**Infra/dominio:** 1 dominio ⬜ · 2 DNS email ⬜ · 3 Vercel project ✅(config)/⬜(setup) · 4 env vars ⬜ · 5 sin vars preview ⬜
**BD/Supabase:** 6 migraciones ⬜ · 7 seeds 01/02 ⬜ · 8 `app.environment=production` ⬜ · 9 Auth Hook ⬜ · 10 Twilio Verify ⬜ · 11 SMTP Resend ⬜ · 12 RLS 30/30 ✅(escrito)/⬜(correr en prod) · 13 buckets ⬜ · 14 Realtime ⬜ · 15 PITR ⬜
**Integraciones:** 16 Stripe LIVE ⬜ · 17 QStash schedules ✅(script)/⬜(correr) · 18 LiveKit ⬜ · 19 Resend ⬜ · 20 SaaS Abogados ⬜ · 21 budget IA ⬜ · 22 rate-limit ⬜
**Seguridad:** 23 ENCRYPTION_KEY ⬜ · 24 headers/CSP ✅(código)/⬜(verificar prod) · 25 secret-scan ✅(CI gitleaks) · 26 OWASP ✅(advisors 0 críticos + migración)/⬜(firmar) · 27 terms v1.0 ✅(seed)/⬜(texto real)
**Calidad/PWA:** 28 E2E F1-F6 ⬜(añadir a CI) · 29 Lighthouse install + budgets ✅(budgets cumplidos)/⬜(audit + install real) · 30 axe 0 critical/serious ✅(verificado light+dark)
**Operación:** 31 monitor ⬜ · 32 runbooks ⬜ · 33 staff + MFA ⬜ · 34 bitácora ⬜ · 35 drenaje legacy ⬜

**Adiciones de CI pendientes** (DOC-81 gates 8-11): job de E2E (Playwright), Lighthouse CI (`lhci`), axe-core en E2E. El gate de asset-size ya está; los budgets se cumplen (First-Load-JS 104KB<300KB).

---

## 9. Demo de salida F8 (DOC-80 §F8 §4)
Con prod en vivo: **el dueño instala la PWA en su teléfono desde producción**, recorre un caso real E2E (intake → docs → formularios → cita → validación → pago), y **firma el go-live**.
