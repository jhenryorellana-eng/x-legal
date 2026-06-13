# F2 — Pantallas Cliente · Decision Log (ui-master)

> Réplica pixel del prototipo `V2/UI Cliente/app/*.jsx` (SoT visual) + conexión real al backend
> vía `modules/*/index.ts`. Microcopy ES textual de los prompts; EN del `tt()` del prototipo.

## Phase 0 — Research Summary
- **Queries executed:**
  1. Next.js 15 App Router — server component fetch + pasar server action como prop a client component (2026)
  2. next-intl v4 `getTranslations` / claves dinámicas / app router (2026)
- **New patterns confirmed:** RSC en el tope del árbol leen vía `index.ts`, pasan **solo props serializables** (primitivos, objetos planos, arrays) + **server actions por referencia** a client leaves. `getTranslations(ns)` en RSC; valores dinámicos con `t(key, {name})`; para claves data-driven castear el translator (patrón ya usado en F1 staff).
- **Memory consulted:** sí — `agent-memory/ui-master/MEMORY.md`. Reusados: tokens de marca F0, patrón inject-actions DOC-50 §2, IconTile/IconHalo del prototipo, merge bilingüe i18n con script Node `{leaf:[es,en]}`, harness Playwright `docs/_evidence` (resuelve node_modules local), filtro `/hydrat|caret-color|extension/`.
- **Decisions informed by research:** server pages (RSC) orquestan lecturas + pasan thin `"use server"` action wrappers como props a los client feature components; cero fetch client-side en la carga inicial (skeletons solo para refetch).

## Phase 1 — Stack & Feature Selection

### Stack (ADAPTADO al repo existente)
Next.js 15.5 (App Router, Turbopack) · React 19 · Tailwind v4 · TS strict · next-intl v4 · Supabase.
Superficie móvil cliente (`max-width 430`, `[data-theme]` light/dark). Componentes de marca F0
(`components/brand`) + componentes móviles F2 (`components/mobile`) ya construidos — se reutilizan,
no se duplican. NO se introduce ninguna dependencia nueva (sin react-hook-form, sin framer-motion;
animaciones por keyframes CSS ya en `motion.css`).

### Pantallas vs DOC-51 (cobertura de esta entrega)
| # | Pantalla | Ruta | Tipo | Lectura/Mutación |
|---|---|---|---|---|
| 5 | Home (multi-caso) | `/home` | RSC + client bell | getCasesForClient + enriquecido + getNotifications |
| 6 | Servicios | `/servicios` | RSC + client search | getPublicCatalog |
| 7 | Servicio detalle | `/servicios/[slug]` | RSC + client CTA flag | getServiceDetailBySlug |
| 12 | Disclaimer + firma | `/caso/[id]/disclaimer` | RSC + client | getActiveTermsForCase → acceptTermsInApp + Tutorial |
| 13 | Tu Camino | `/caso/[id]/camino` | RSC + client tutorial | getCaseWorkspace |
| 22 | Mi proceso | `/caso/[id]/proceso` | RSC + client glosario | getCaseMilestones |
| 23 | Bitácora | `/caso/[id]/bitacora` | RSC + client filtros | getTimeline |
| 14 | Documentos | `/caso/[id]/documentos` | RSC + client acordeón | getDocumentsMatrix |
| 15 | Subir | `/caso/[id]/subir` | client | startDocumentUpload → PUT → confirmDocumentUpload |
| 16 | Éxito | `/caso/[id]/exito` | client | Confetti + refetch del progreso |
| 17 | Corregir | `/caso/[id]/corregir` | RSC | getDocumentsMatrix (doc rejected) |
| 24 | Mis datos | `/caso/[id]/datos` | RSC | getCaseWorkspace (partes) |
| 26 | Más (hub) | `/caso/[id]/mas` | RSC | getCaseWorkspace (cabecera + badge) |
| 20 | Historia (nav only) | `/caso/[id]/historia` | placeholder | — (pantalla completa en F4) |
| 11 | Config | `/config` | RSC + client | theme/lang/text-scale + perfil (lectura) |

### Anti-patterns respetados
- **Rechazo de documento en ÁMBAR, jamás rojo** (RF-CLI-028) — `--gold-soft`/`--gold-deep`.
- Solo se anima `transform`/`opacity` (keyframes existentes). Sin `setInterval` para animaciones (Confetti usa rAF).
- `prefers-reduced-motion` respetado por las clases de `motion.css`.
- Sin precios en la app (RF-CLI-069 CA2). CTA "Me interesa" tras feature-flag (H-7).

## Backend reads añadidas al módulo `cases` (read-only, triviales, documentadas)
La instrucción autoriza añadir lecturas read-only simples al `cases` siguiendo su patrón. El DOC-51
referencia DTOs enriquecidos (`CaseWorkspaceDto`, `DocumentsMatrixDto`) que el módulo aún no exponía
(solo devolvía rows crudos). Se añaden como **lecturas puras** (sin mutación, RLS-scoped, `requireCaseAccess`):
- `getCaseWorkspace(actor, caseId)` → caso + servicio (label/icon/color) + fase actual (label/desc/explainer/position) + total de fases + partes (nombre/rol) + progreso de fase (computePhaseProgress, fuente única) + cuenta de documentos pendientes. **API-CASE-02 (CaseWorkspaceDto).**
- `getDocumentsMatrix(actor, caseId)` → requirements activos de la fase actual (vía `catalog.getCaseRequirements` ya existente) expandidos por parte + unidos con `case_documents` (estado visible pendiente/uploaded/approved/rejected + motivo/fecha). **API-CASE-05 (DocumentsMatrixDto).**
- `getCaseMilestones(actor, caseId)` → milestones del servicio (vía detalle de catálogo) con estado derivado (curso/siguiente/bloqueado/completado) + % de la fase en curso. **(pantalla 22).**
- `getClientDisplayName(actor)` → `client_profiles.preferred_name ?? first_name` (saludo del home/celebración/proceso). Trivial.
- `getActiveTermsForCase(actor, caseId)` → reusa `contracts.getActiveTermsVersion` + `findAcceptance` para resolver `{ alreadyAccepted, terms }` (guard del disclaimer §12). **API-CASE-11 (TermsStatusDto, parcial).**

Cada una replica el patrón del repo: `can`/`requireCaseAccess` primero, `createServerClient` (RLS),
sin escrituras, exportadas desde `cases/index.ts`. NO se tocó ninguna mutación existente.

## i18n
Claves nuevas SOLO bajo `cliente.*` (otro agente no toca ese namespace). Paridad es/en obligatoria,
merge con script Node `{leaf:[es,en]}` (escrito como archivo, borrado tras correr). `check:i18n` verde.

## Feature flag
`NEXT_PUBLIC_FEATURE_INTERES` (nota H-7): el CTA "Me interesa, contáctenme" se renderiza presente
pero **deshabilitado** cuando el flag ≠ `"true"` (la action de lead llega en F3, PS-3). Añadido a `.env.example`.
