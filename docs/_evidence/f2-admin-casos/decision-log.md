# F2-W2-b — Firma pública + Panel de casos admin · decision-log

> ui-master · 2026-06-12 · UsaLatinoPrime V2 (`usalatino-v2/`)

## Phase 0 — Research Summary
- **Queries ejecutadas:** Next.js 15 App Router public route group `params` Promise (confirmado: `params` es Promise, hay que `await`; el repo ya lo usa). El resto de la investigación fue *in-repo*: lectura exhaustiva de los SoT normativos (DOC-51 §27, DOC-53 §2/§3, DOC-22 §4, DOC-50 §4) y de las firmas exactas de los módulos `contracts`, `cases`, `billing`, `identity`, `catalog`, `org` + `platform/storage`, `platform/authz`, `middleware`.
- **Patrones nuevos descubiertos / confirmados:**
  - El `contracts` bucket SOLO acepta `pdf` (`ALLOWED_EXTENSIONS.contracts=["pdf"]`) y `signContract` valida magic-bytes PDF del objeto subido → la firma PNG del `SignaturePad` debe envolverse en un **PDF mínimo** server-side (cero deps nuevas; `pdf-lib` NO instalado y está prohibido añadir libs de UI).
  - `signContract(token, { signatureUploadRef, ip })` exige el objeto **ya subido** al bucket (no acepta dataURL). Flujo real = upload-url → PUT → `signContract`.
  - `cases` NO exporta `createCaseFromContract`, `approveDocument`, `rejectDocument`, `getCaseDocuments` (nombres del brief). Lo real: `getCaseOverview`, `getCaseRequirements`, `getCasesForClient`, `reviewDocument(verdict)` (aprobar/rechazar combinados), `getTimeline`, `onDownpaymentConfirmed`.
  - `billing.recordManualPayment` NO existe; lo real es `registerZellePayment(actor, { installmentId, ... })` que al confirmar el `is_downpayment` emite `downpayment.confirmed` → `onDownpaymentConfirmed` activa el caso (gate de negocio).
- **Memoria consultada:** sí — `agent-memory/ui-master/MEMORY.md` (F0 design-system, F1 shell+componentes desktop, F1 admin screens, F2 componentes móviles, harness Playwright admin-preview/design). Reutilicé el patrón inject-actions, el harness `(dev)` sin login y el patrón merge i18n bilingüe.
- **Decisiones informadas por la investigación:**
  - Firma pública usa tokens **móviles** (default `[data-theme]`, sin `.surface-staff`); admin usa **desktop staff** (`.surface-staff`).
  - 404 uniforme de firma = page que renderiza la pantalla "enlace vencido" con HTTP 200 (no `notFound()`), para que el firmante legítimo y el atacante vean lo mismo.

## 1.1 Business Profile
- **Industria:** servicios migratorios/legales para la comunidad latina en EE. UU.
- **Tono:** serio, cálido, máxima confianza (firma = paso legal más sensible).
- **Paleta (normativa DOC-01):** navy `#002855`, acción `#2F6BFF`, dorado `#FFC629`, verde `#1BB673`, rojo `#E4002B`, tintes soft.
- **Tipografía:** Plus Jakarta Sans (display + body) — ya cargada vía `next/font`.
- **Dirección estética:** móvil-first cálido (firma), desktop denso Vanessa (admin). Sin AI-slop.

## 1.2 Stack Selection
- **Adaptado al proyecto existente:** Next.js 15.5.19 (App Router, Turbopack), React 19.1, Tailwind v4, TS strict, next-intl v4, Radix UI, sonner, zod v4, Supabase. **Cero dependencias nuevas.**
- Componentes: `brand/*` + `mobile/*` (firma) y `brand/*` + `desktop/*` (admin), todos ya construidos en F0/F1/F2.

## 1.3 Feature Selection
- ✅ Firma pública móvil: resumen del contrato (servicio+plan, partes, plan de pagos con cuota inicial destacada), contrato con **scroll-gate propio**, `SignaturePad`, checkbox, `GradientBtn` deshabilitado hasta scroll+firma+checkbox.
- ✅ Estados firma: default · enlace vencido (uniforme, cero datos) · éxito · ya firmado · error de mutación (banner ámbar, conserva firma).
- ✅ Firma→PDF mínimo server-side (sin libs).
- ✅ Admin casos: DataTable con filtros en URL, StatusPill por estado, mini ProgressBar de fase, "Cargar más" cursor, empty/loading/error.
- ✅ Modal "Nuevo caso" 2 pasos (datos cliente E.164 → servicio+plan+partes → createContract → signing link copiable).
- ✅ Caso detalle = primer `shared-case` real: header + tabs data-driven Resumen | Documentos | Partes (resto preparadas).
- ✅ Resumen: overview + timeline + registro pago manual Zelle (gate → active) + reenviar link de firma.
- ✅ Documentos: cola de revisión + visor (signed URL) + Aprobar/Rechazar con motivo bilingüe.
- ✅ Partes: lista de `case_parties`.
- ❌ Generaciones/Citas/Expediente/Validación/Pagos-tab/Contrato-tab/Mensajes/Bitácora completas → fases futuras (tabs estructuradas pero stub con Lex).
- ❌ Stripe checkout (F5), dictado, drag&drop expediente → fuera de alcance.

## 1.4 Section / Component Structure
**Firma pública** (`/firma/[token]`):
- `page.tsx` (RSC) — lookup por token + IP rate limit, decide vista (vencido vs firmable).
- `signing-view.tsx` (client) — resumen + scroll-gate + SignaturePad + submit.
- `link-unavailable.tsx` — pantalla uniforme con contactos.
- `signing-success.tsx` — check verde + siguiente paso.

**Admin casos** (`/admin/casos`):
- `page.tsx` (RSC) — lista + filtros URL + enriquecimiento servicio/cliente.
- `casos-list-view.tsx` (client) — DataTable + filtros + Modal nuevo caso.
- `[caseId]/page.tsx` (RSC) — overview + parties + plan + contract + timeline.
- `shared-case/*` — `shared-case-view`, `build-tabs`, `tabs/{resumen,documentos,partes}`.
