# F2-W2-b — Testing report (Playwright)

> ui-master · 2026-06-12 · `usalatino-v2/` · Next 15.5.19 + Playwright 1.60

## Harness
- `docs/_evidence/f2-admin-casos/shoot.cjs` (playwright local, runs from repo root).
- Dev server started with `ENABLE_ADMIN_PREVIEW=true npm run dev` (port 3001; 3000 was occupied by a stale instance).
- Admin panel is auth-gated → captured via the dev `(dev)/admin-preview/[view]` route (extended with `casos`, `caso-detalle`, `firma` views + `casos-mock.ts`). The "enlace vencido" screen captured via the REAL `/firma/[token]` route with a fake UUID (no auth).

## Results (all HTTP 200, 0 console/page errors filtered)

| File | Surface | HTTP | Console errors |
|---|---|---|---|
| `screenshot-desktop.png` | Admin casos list (light) | 200 | 0 |
| `admin-caso-detalle.png` | shared-case detail (admin, light) | 200 | 0 |
| `admin-casos-dark.png` | Admin casos list (dark) | 200 | 0 |
| `admin-nuevo-caso-modal.png` | "Nuevo caso" modal step 1 | 200 | 0 |
| `screenshot-mobile.png` | Public signing view (mobile, firmable) | 200 | 0 |
| `firma-token-invalido.png` | Public signing — token inválido → "enlace vencido" | 200 | 0 |

**Total console/page errors (filtered `/hydrat|caret-color|extension|DevTools/`): 0.**

## Route gates verified
- `GET /firma/<fake-uuid>` → **HTTP 200** rendering the uniform "Este enlace ya no está disponible" screen with CERO datos del contrato (anti-enumeración, DOC-22 §4 — `notFound()` deliberately NOT used so the status is indistinguishable).
- `GET /admin/casos`, `GET /admin/casos/[caseId]` → **307 → /login** without a staff session (middleware surface guard; confirmed by the existing middleware staff guard for `/admin/*`). The auth-gated views were captured via `/admin-preview/*` which 404s in production.
- `/admin-preview/{casos,caso-detalle,firma}` → 200 only with `ENABLE_ADMIN_PREVIEW=true` + non-prod (dev harness only).

## Visual checks (Phase 3)
- **Admin casos list**: title + "4 casos" chip, Servicio/Estado selects + búsqueda, "Nuevo caso" CTA, DataTable with case number/client, service + plan chip (azul "Sin abogado" / dorado "Con abogado"), mini ProgressBar de fase (x/y), StatusPill mapping exact (En validación legal=gold, Activo=green, Esperando pago inicial=blue-soft, En pausa=amber dot), "hace X" relative. Dark mode tokens resolve cleanly.
- **Caso detalle (shared-case)**: ← Volver, case number + StatusPill, cliente·servicio·plan chip, **barra modo administrador** (gold-soft + shield + microcopy literal), banner payment_pending, tabs data-driven (Resumen activo · Documentos con badge rojo "1" · Partes), **gate de pago manual Zelle** ("Registrar pago de $1,250.00" + "al confirmar… el caso pasa a activo"), **Reenviar link de firma**, parties con avatares gradient + rol, timeline.
- **Nuevo caso modal**: 2-step indicator, paso 1 nombre + teléfono E.164 (hint), Cancelar/Siguiente disabled-until-valid, scrim + blur.
- **Firma pública (mobile)**: BrandBar + eyebrow, resumen (servicio + chip plan navy, partes con rol, plan de pagos con **pill dorada "Pago inicial — $1,250.00"** destacada), caja de contrato con scroll propio, hint "Desliza hasta el final…", botón "Firmar contrato" deshabilitado (zona firma oculta hasta scroll), sello "Tu información está protegida".

## a11y quick-check
- No axe-core run in this pass (full audit = qa-engineer). Manual: `cursor-pointer` on all interactive elements, focus-visible from Radix on Modal/SidePanel, `aria-selected` on tabs, `role="alert"` on the signing error banner, StatusPill always icon+text (never color-only). Inherited token-pair contrast caveats (green/green-soft, gold-deep/gold-soft) are NORMATIVE brand values flagged in F0 memory — mitigated with icon+text.

## Notes
- The `N` badge bottom-left is the Next 15 dev indicator (dev artifact, not UI).
