
# Implementar `/xlegal`: variante integrada con x-legal (sin pago, 1 intento, entrega por webhook)

## 1. Rol y contexto

Eres un ingeniero senior trabajando en **este repositorio (Juez)**: Next.js 16.2.9 (App Router) + React 19 + TypeScript strict + Tailwind v3 + Framer Motion + Zustand. No hay base de datos: la persistencia es **Vercel Blob usado como store JSON** (patrón `put`/`list`+`fetch`). IA: Gemini (`lib/gemini.ts`); PDF: `@react-pdf/renderer` (`lib/informe-pdf.tsx`). Idioma: **copy de UI en español; código, identificadores y comentarios en inglés** (el código existente tiene comentarios en español — al tocar código existente respeta su estilo).

Mapa del código que vas a reutilizar (léelo antes de escribir nada):

- `app/pro/page.tsx` — flujo premium: pasos `intro → datos → docs`, sube archivos a Blob con `upload()` de `@vercel/blob/client` apuntando a `handleUploadUrl: "/api/upload"`, luego `POST /api/checkout` (Stripe).
- `app/pro/resultado/page.tsx` — `POST /api/pro/run` y polling `GET /api/pro/run?id=` cada 5 s (`POLL_MS`, `POLL_MAX`). Tres vistas internas: `Procesando` (líneas ~154–255, pantalla animada con `FASES`), `Listo` y `ErrorView`.
- `app/api/pro/run/route.ts` — `GET` (poll), `POST` (verifica pago y arranca el job con `after()`), `processProJob` (líneas ~111–156: descarga docs del Blob → `prepareDoc` → `generateInforme` → `renderInformePdf` → guarda resultado → borra docs del cliente), helpers `resolveUrl`/`readJson` (~160–175) y `formatFechaEs` (~177–183). Exporta `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 300`.
- `app/api/upload/route.ts` — `handleUpload` de `@vercel/blob/client`, whitelist PDF/docx/txt, `maximumSizeInBytes: MAX_FILE_BYTES`, rate limit 40/min. **Se reutiliza tal cual, sin cambios.**
- `app/api/checkout/route.ts` — validación de URLs de Blob (líneas ~61–71); la replicarás.
- `lib/gemini.ts` — `generateInforme(docs, cliente)` y tipo `PreparedDoc`. `lib/docs.ts` — `prepareDoc(name, buffer)`. `lib/informe-pdf.tsx` — `renderInformePdf(cliente, informe, fecha)`. `lib/types.ts` — `ClienteInfo`, `Informe`, `ProJob`, `ProResult`. `lib/ratelimit.ts` — `rateLimit(key, max, windowMs?)`, `getClientIp`. `lib/analysis.ts` — `MAX_FILES`, `MAX_FILE_BYTES`, `ACCEPTED_EXTENSIONS`. `components/FilePicker.tsx` — selector compartido. `components/Brand.tsx` — `Wordmark`, `BrandMark`. `lib/brand.ts` — marca.
- `next.config.mjs` — `Content-Security-Policy: frame-ancestors 'self' https://x-legal.usalatinoprime.com` **ya permite** el iframe desde x-legal. No la toques.
- Scripts: `npm run typecheck` (`tsc --noEmit`), `npm run lint` (`next lint`), `npm run build`. No hay suite de tests.

## 2. Objetivo

Construir la ruta **`/xlegal?t=<token>`**: variante de `/pro` **sin pago (nada de Stripe) y sin formulario de datos personales**, embebida en un **iframe** dentro del panel de x-legal (`https://x-legal.usalatinoprime.com`). x-legal es la fuente de verdad: emite el token, conoce al cliente, decide los intentos y almacena el PDF final. Juez es **stateless respecto a intentos y PDF entregado**: genera el informe, lo entrega a x-legal por webhook firmado, y borra sus copias.

Reglas de oro:
1. El token `t` es un **bearer opaco** de x-legal. Se valida contra x-legal en **cada operación server-side**. Juez nunca decide intentos por su cuenta.
2. La API key y el webhook secret **jamás llegan al cliente** (ni props serializadas, ni `NEXT_PUBLIC_*`, ni logs).
3. `/` y `/pro` siguen funcionando exactamente igual. Único cambio permitido sobre código existente: **extraer helpers compartidos a `lib/`** (detallado abajo) y actualizar imports.

## 3. Contrato de API con x-legal — v1 (EXACTO, no lo cambies)

Base URL: env `XLEGAL_API_URL`. Auth Juez→x-legal: header `x-api-key: <XLEGAL_API_KEY>` en cada request. Todo `fetch` con `cache: "no-store"`.

### 3.1 `GET {XLEGAL_API_URL}/api/juez/sessions/{token}`

Respuesta `200`:
```json
{
  "cliente": { "nombre": "María González", "email": "maria@example.com", "pais": "Venezuela" },
  "attemptsAllowed": 1,
  "attemptsUsed": 0,
  "status": "active",
  "pdf": { "available": false }
}
```
Cuando ya se entregó:
```json
{
  "cliente": { "nombre": "María González", "email": "maria@example.com", "pais": "Venezuela" },
  "attemptsAllowed": 1,
  "attemptsUsed": 1,
  "status": "delivered",
  "pdf": { "available": true, "downloadUrl": "https://…supabase.co/storage/v1/object/sign/…" }
}
```
- `status` ∈ `"active" | "delivered" | "expired"`. **Sé defensivo**: deriva la UI de `pdf.available` y `attemptsRemaining = attemptsAllowed - attemptsUsed`; trata cualquier `status` desconocido como `"active"`.
- `pdf.downloadUrl` es una URL firmada de x-legal con TTL corto (≤10 min) — pídela fresca en cada carga; el PDF final vive en x-legal, no en Juez.
- `404` → token inexistente/expirado (pantalla de error amable). `401/403` → API key mal configurada (pantalla de error + `console.error` sin token).

### 3.2 `POST {XLEGAL_API_URL}/api/juez/sessions/{token}/consume`

Body: `{ "jobId": "<uuid v4 generado por Juez>" }`.
- `200` → `{ "ok": true, "attemptsRemaining": 0 }`. **Idempotente por `jobId`**: reenviar el mismo `jobId` devuelve `200` sin consumir otro intento.
- `409` → `{ "error": "NO_ATTEMPTS_LEFT" }` — sin intentos; error claro al cliente, NO generar.
- `404` → token inválido.

### 3.3 `POST {XLEGAL_API_URL}/api/webhooks/juez` (Juez → x-legal, al terminar)

Headers: `content-type: application/json` y `x-juez-signature: <firma>`.

**Firma** — HMAC-SHA256 hex sobre el **raw body exacto** enviado (firma el string y envía ESE string, nunca re-serialices):
```ts
import { createHmac } from "node:crypto";

const raw = JSON.stringify(payload);
const signature = createHmac("sha256", process.env.XLEGAL_WEBHOOK_SECRET!)
  .update(raw, "utf8")
  .digest("hex");
await fetch(`${apiUrl}/api/webhooks/juez`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-juez-signature": signature },
  body: raw,
  cache: "no-store",
});
```

Body de éxito:
```json
{
  "event": "evaluation.completed",
  "token": "<token de la sesión>",
  "jobId": "<uuid>",
  "completedAt": "2026-07-23T18:30:00.000Z",
  "result": {
    "pdfUrl": "https://…blob.vercel-storage.com/xlegal/informes/informe-<jobId>.pdf",
    "score": 62,
    "nivel": "moderado",
    "headline": "Caso con base sólida, pero…"
  }
}
```
`nivel` = campo `level` del `Informe` (`"bajo" | "moderado" | "alto"`, ver `lib/types.ts`). `pdfUrl` es copia **temporal** en el Blob de Juez: x-legal la descarga y la guarda en su storage **antes** de responder `200`.

Body de fallo (x-legal devuelve el intento):
```json
{ "event": "evaluation.failed", "token": "…", "jobId": "…", "error": "GENERATION_FAILED" }
```

**Reintentos**: ante ≠2xx o error de red, backoff con esperas de 2 s, 8 s, 30 s (4 envíos en total). Si todos fallan: resultado queda `webhookDelivered: false` en Blob y **no borres el PDF** — la reconciliación (3.4) es la red de seguridad.

**Limpieza tras `200`**: borrar del Blob de Juez (a) los documentos del cliente y (b) el PDF (x-legal ya lo tiene). El JSON de resultado se conserva (sin PDF) para reconciliación y reanudación de UI.

### 3.4 `GET /api/xlegal/status?jobId=<uuid>` (endpoint NUEVO en Juez — polling de respaldo de x-legal)

Protegido con header `x-api-key`, validado contra **la misma `XLEGAL_API_KEY`** (decisión v1: un solo secreto compartido en ambas direcciones; documéntalo en README). Comparación con `crypto.timingSafeEqual`. Respuestas:
- Sin resultado → `202` `{ "status": "pending" }`
- Terminado → `200`:
```json
{
  "status": "done",
  "completedAt": "…",
  "webhookDelivered": false,
  "result": { "pdfUrl": "…", "score": 62, "nivel": "moderado", "headline": "…" }
}
```
- Falló generación → `200` `{ "status": "error", "error": "GENERATION_FAILED" }`
- API key inválida → `401`. `jobId` malformado → `400`. Rate limit 30/min por IP.

## 4. Diseño interno en Juez

Layout del Blob (espejo del patrón `pro/*` de `app/api/pro/run/route.ts` y `app/api/checkout/route.ts`):
- `xlegal/jobs/<jobId>.json` — `XlegalJob { status: "pending" | "processing", tokenHash, cliente, files, createdAt }`. `tokenHash = sha256hex(token)` — **nunca guardes el token en claro** en el Blob ni lo uses en paths.
- `xlegal/results/<jobId>.json` — `XlegalResult` (`done` con `{ informe, pdfUrl, cliente, completedAt, webhookDelivered }` | `error`).
- `xlegal/informes/informe-<jobId>.pdf` — PDF temporal (se borra tras webhook `200`).
- `xlegal/tokens/<tokenHash>.json` — `{ "jobId": "…" }`: mapeo para que una recarga de página reanude el polling sin que el cliente conserve el `jobId`. Se escribe justo después de que `consume` devuelva `200`.

Flujo de `POST /api/xlegal/run` (body `{ token, files: [{ url, name }] }`):
1. Rate limit: `rateLimit("xlegal-run:" + getClientIp(request), 5)` y además `rateLimit("xlegal-run:" + tokenHash, 3)`.
2. Valida el token con `/^[A-Za-z0-9_-]{20,128}$/` y las `files` igual que `app/api/checkout/route.ts:61-71` (hostname `.blob.vercel-storage.com`, 1..`MAX_FILES`).
3. `fetchXlegalSession(token)` server-side. Si `pdf.available` → `200 { alreadyDelivered: true }` (la UI recarga y muestra el PDF). Si no quedan intentos → `409`.
4. Si el mapeo `xlegal/tokens/<tokenHash>.json` ya existe y su resultado no es `error` → devuelve ese `jobId` (reanudación; no consumas otro intento).
5. `jobId = crypto.randomUUID()`, guarda job (`pending`), llama a `consume` con `{ jobId }`. `409` → responde `409` con error claro. `200` → escribe mapeo, marca job `processing`, `after(() => processXlegalJob(jobId, job, token))`.
6. Responde `202 { jobId }`.

`GET /api/xlegal/run?id=<jobId>&t=<token>`: poll del cliente (mismo patrón que `GET` de `app/api/pro/run/route.ts:21-31`) pero **autenticado**: recalcula `sha256(t)` y compáralo con `job.tokenHash`; si no coincide → `404`. Sin resultado → `202 { status: "pending" }`. Nunca incluyas el token en logs. Rate limit 40/min por IP.

`processXlegalJob(jobId, job, token)`: pipeline extraído (sección 5) → sube PDF a `xlegal/informes/` → guarda `xlegal/results/<jobId>.json` → entrega webhook (3.3) con reintentos → si `200`: `del()` de docs del cliente y del PDF, y actualiza resultado con `webhookDelivered: true`. Si la generación falla: guarda resultado `error`, envía `evaluation.failed`, y borra los docs del cliente igualmente (privacidad).

`app/api/xlegal/run/route.ts` declara `export const runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 300` (igual que `app/api/pro/run/route.ts:12-14`).

## 5. Cambios archivo por archivo

**Refactor (tocar código existente SOLO para extraer — conducta de `/pro` sin cambios):**
1. **NUEVO `lib/blob-store.ts`** — mueve `resolveUrl` y `readJson` desde `app/api/pro/run/route.ts:160-175`, expórtalos y actualiza los imports del pro route.
2. **NUEVO `lib/informe-pipeline.ts`** — extrae de `processProJob` (`app/api/pro/run/route.ts:111-131`) el núcleo descarga→genera→renderiza como:
```ts
export interface FileRef { url: string; name: string }
export async function buildInformeFromFiles(
  files: FileRef[],
  cliente: ClienteInfo,
): Promise<{ informe: Informe; pdf: Buffer }>
```
(descarga cada `FileRef` con `fetch` + límite `MAX_FILE_BYTES`, `prepareDoc` de `lib/docs.ts`, `generateInforme` de `lib/gemini.ts`, `renderInformePdf` de `lib/informe-pdf.tsx`). Mueve también `formatFechaEs` (líneas 177–183) aquí. `processProJob` pasa a llamar a `buildInformeFromFiles` conservando su persistencia/limpieza actual.
3. **NUEVO `components/AnalyzingPanel.tsx`** — extrae la vista `Procesando` de `app/pro/resultado/page.tsx:154-255` como componente con props `{ fases: string[]; fase: number; pct: number; fileNames?: string[]; badge?: string }`. `/pro/resultado` la usa con sus `FASES` actuales; `/xlegal` con fases sin la de pago: `["Abriendo tu expediente", "Leyendo cada página", "Auditando elemento por elemento", "Redactando tu informe", "Generando tu PDF"]`.

**Código nuevo:**
4. **`lib/xlegal.ts`** (server-only): `xlegalConfigured()` (patrón `stripeConfigured()` de `lib/stripe.ts:9-11`), `hashToken(token)` (sha256 hex), `fetchXlegalSession(token)`, `consumeXlegalAttempt(token, jobId)`, `deliverXlegalWebhook(payload)` (HMAC + reintentos 2/8/30 s), `isValidToken(token)`. Si faltan envs → endpoints responden `501` con mensaje claro (patrón `app/api/upload/route.ts:23-31`).
5. **`lib/types.ts`** — añade `XlegalSession`, `XlegalJob`, `XlegalResult` (sección 4).
6. **`app/api/xlegal/run/route.ts`** — `POST` + `GET` (sección 4).
7. **`app/api/xlegal/status/route.ts`** — reconciliación (sección 3.4).
8. **`app/xlegal/page.tsx`** — **Server Component**: lee `searchParams.t`, llama `fetchXlegalSession` en el servidor y decide la rama (sección 6). Pasa al cliente **solo** datos no sensibles: `nombre`, `attemptsRemaining`, `downloadUrl` (si existe), `jobId` de reanudación (si existe) y el propio token (ya está en la URL del cliente; jamás la API key).
9. **`components/xlegal/XlegalFlow.tsx`** (client) — upload (reutiliza `FilePicker` y el patrón `upload()` de `app/pro/page.tsx:60-69`, prefijo de path `xlegal/docs/`) + confirmación + `POST /api/xlegal/run` + polling con `AnalyzingPanel` (mismos `POLL_MS`/`POLL_MAX` que `/pro/resultado`) + estados de éxito/error. Divide en subcomponentes si queda más claro.
10. **`.env.local.example`** — añade las tres variables (sección 7) con comentarios en el estilo del archivo.
11. **`README.md`** — sección "Integración /xlegal": contrato v1 resumido, envs, decisión de API key compartida, cómo probar con el mock (sección 10).
12. **`scripts/mock-xlegal.mjs`** — mock standalone de x-legal (sección 10).

## 6. UI/UX de `/xlegal` — estados y copys (español, exactos)

Reglas iframe: responsive mobile-first (contenedor `max-w-xl` como `/pro`), **ninguna navegación fuera del iframe**: no renderices `components/Header.tsx` (depende del store del demo `useJuez` y resetea al flujo `/`), no renderices `components/ServicesCTA.tsx` (enlaza a usalatinoprime.com), no enlaces a `/` ni `/pro`. Header propio mínimo: `Wordmark` de `components/Brand.tsx` sin enlace. **Única excepción de `target="_blank"`**: el anchor de descarga del PDF (`rel="noopener noreferrer"`) — un PDF cross-origin no puede abrirse dentro del iframe. Mantén `Background` y las clases `glass`/`btn-lg` para coherencia visual.

1. **Token ausente/inválido/expirado (o error de config)** — card de error. Título: `Este enlace no es válido`. Texto: `El enlace de tu evaluación no es válido o ya venció. Vuelve a tu panel de x-legal y ábrelo de nuevo desde ahí.`
2. **Con intentos** (`attemptsRemaining > 0`, sin PDF) — pantalla de subida:
   - Saludo: `Hola, {primerNombre}` (helper como `app/pro/resultado/page.tsx:357-359`). No se piden datos: vienen de x-legal.
   - **Aviso prominente** (banner destacado, no letra pequeña): si `attemptsRemaining === 1`: `Tienes 1 solo intento para generar tu evaluación.` · si `> 1`: `Tienes {n} intentos para generar tu evaluación.` · siempre debajo: `Sube TODOS los documentos de tu caso antes de generar. Cuando uses tu intento, no podrás volver a subir documentos ni generar el informe de nuevo.`
   - `FilePicker` + botón primario: `Generar mi evaluación`.
   - Al pulsarlo, **confirmación inline** (no `window.confirm`; panel propio en la card): `¿Ya subiste todos tus documentos? Esta acción usará tu intento y no podrás repetirla.` Botones: `Sí, generar mi evaluación` / `Todavía no, quiero revisar`.
3. **Generando** — `AnalyzingPanel` con las 5 fases (sección 5) y `Esto puede tardar unos minutos. No cierres esta página.` Una recarga durante la generación vuelve aquí (reanudación vía `xlegal/tokens/<tokenHash>.json`) y sigue el polling.
4. **Entregado** (`pdf.available === true`, o resultado `done` local si el webhook aún no llegó) — card de éxito. Título: `Tu evaluación está lista`. Muestra `ScoreRing` (`components/ui/ScoreRing.tsx`) + `headline` si tienes el `informe` local; si solo tienes el `downloadUrl` de x-legal, card con botón de descarga y `Tu informe quedó guardado. Puedes descargarlo cuando quieras.` Botón: `Descargar mi informe (PDF)` → `downloadUrl` de x-legal (o `pdfUrl` local en el caso puente). Recargar siempre re-muestra esta pantalla.
5. **Sin intentos y sin PDF** (edge) — card de soporte. Título: `No encontramos tu informe`. Texto: `Ya usaste tus intentos disponibles y no pudimos encontrar tu informe. Escríbenos desde tu panel de x-legal para ayudarte a resolverlo.`
6. **Errores** — card estilo `ErrorView` (`app/pro/resultado/page.tsx:337-355`): `No pudimos completar tu evaluación. Tu intento no se perdió: recarga esta página para volver a intentarlo.` (cierto: x-legal devuelve el intento al recibir `evaluation.failed`). Si `POST /api/xlegal/run` dio `409`: `Ya no te quedan intentos disponibles. Si crees que es un error, contáctanos desde tu panel de x-legal.`

## 7. Variables de entorno (añadir a `.env.local.example`)

```bash
# --- Integración con x-legal (variante /xlegal) ---
# URL base del sistema x-legal (sin barra final).
XLEGAL_API_URL=
# API key compartida: Juez la envía a x-legal (x-api-key) y x-legal la usa
# para llamar a GET /api/xlegal/status en Juez.
XLEGAL_API_KEY=
# Secreto HMAC-SHA256 para firmar el webhook evaluation.completed/failed.
XLEGAL_WEBHOOK_SECRET=
```
Stripe **no** participa en `/xlegal`. `GEMINI_API_KEY` y `BLOB_READ_WRITE_TOKEN` siguen siendo necesarias.

## 8. Restricciones duras

- **No rompas `/` ni `/pro`**: cero cambios de conducta; solo las extracciones de la sección 5 con imports actualizados.
- **No toques** `next.config.mjs`, `app/api/checkout/route.ts`, `lib/stripe.ts`, `app/api/evaluate/route.ts`.
- Secretos solo server-side. Nada de `NEXT_PUBLIC_*` nuevo. No loggees token, API key ni secret (para correlacionar, loggea a lo sumo `tokenHash.slice(0, 8)`).
- Sin dependencias nuevas (`node:crypto` cubre HMAC/sha256/timingSafeEqual). El mock tampoco necesita dependencias.
- Rate limit con `lib/ratelimit.ts` en **todos** los endpoints nuevos.
- El control del intento único vive en x-legal (`consume`); Juez nunca decide por su cuenta ni confía en el cliente.

## 9. Criterios de aceptación

1. `npm run typecheck` → 0 errores; `npm run lint` → limpio; `npm run build` → verde.
2. `git diff` sobre archivos preexistentes limitado a: `app/api/pro/run/route.ts` (imports + helpers extraídos), `app/pro/resultado/page.tsx` (uso de `AnalyzingPanel`), `lib/types.ts`, `.env.local.example`, `README.md`.
3. QA manual completo con el mock (sección 10), incluidos: token inválido; flujo feliz; `409` sin intentos; recarga durante generación (reanuda polling); recarga tras entrega (re-muestra PDF); fallo de webhook (resultado queda `webhookDelivered:false`, el PDF NO se borra y `/api/xlegal/status` lo reporta); `/api/xlegal/status` con API key mala → `401`.
4. El mock verifica la firma HMAC del webhook y la reporta como válida.
5. Tras webhook `200`: los blobs `xlegal/docs/*` del job y el PDF quedan borrados (verifícalo listando el Blob o por logs del job).
6. `/` y `/pro` verificados manualmente en dev tras el refactor (demo gratis y flujo pro con `dev_job` sin Stripe siguen funcionando).
7. Ningún secreto ni token completo aparece en logs ni en el bundle del cliente (revisa con `next build` + grep en `.next/static`).

## 10. Cómo probar sin un x-legal real

Crea `scripts/mock-xlegal.mjs` (Node puro, sin deps, `node scripts/mock-xlegal.mjs`, puerto 4545) que implemente en memoria:
- `GET /api/juez/sessions/:token` — valida `x-api-key === (process.env.MOCK_API_KEY ?? "dev-key")`; sesión sembrada: token `dev-token-maria-0001-abcdef`, cliente `{ nombre: "María González", email: "maria@example.com", pais: "Venezuela" }`, `attemptsAllowed: 1`, `attemptsUsed: 0`, `status: "active"`, `pdf: { available: false }`.
- `POST /api/juez/sessions/:token/consume` — idempotente por `jobId`; `409` sin intentos; al recibir `evaluation.failed` devuelve el intento.
- `POST /api/webhooks/juez` — recalcula el HMAC con `dev-secret` sobre el raw body, `401` si no coincide; si es `evaluation.completed`, descarga `result.pdfUrl` a un archivo temporal (simulando que x-legal guarda el PDF), marca la sesión `delivered` con `pdf.available: true` y `downloadUrl` apuntando a un `GET /files/:token.pdf` que sirve ese archivo; responde `200`.
- Flag por query para simular fallos: `?failWebhook=1` (responde 500 a los primeros N webhooks) para probar reintentos y reconciliación.

En `.env.local`: `XLEGAL_API_URL=http://localhost:4545`, `XLEGAL_API_KEY=dev-key`, `XLEGAL_WEBHOOK_SECRET=dev-secret`, más `GEMINI_API_KEY` y `BLOB_READ_WRITE_TOKEN` reales. Para no gastar IA, prueba con **un único `.txt` pequeño** (>40 caracteres — `prepareDoc` en `lib/docs.ts` rechaza menos); no existe stub de `generateInforme`, no inventes uno. Flujo: `npm run dev` + mock corriendo → `http://localhost:3000/xlegal?t=dev-token-maria-0001-abcdef` → recorre el QA de 9.3. Para ver la forma de un `Informe` de ejemplo sin llamar a la IA: `app/api/dev/informe-pdf/route.ts` (solo dev).

Al terminar, entrega un resumen con: archivos creados/modificados, salida de los tres gates, evidencia del QA manual (respuestas del mock incluida la verificación de firma) y cualquier desviación del contrato con su justificación.
