# F1 Admin — Testing Report (DOC-53)

Pantallas admin de la Fase F1 de UsaLatinoPrime V2. Evidencia visual + estado de gates.

## Gates (los 4 obligatorios)

| Gate | Comando | Resultado |
|------|---------|-----------|
| TypeScript | `npx tsc --noEmit` | ✅ 0 errores |
| ESLint | `npx eslint . --max-warnings=0` | ✅ exit 0 (solo avisos de deprecación del plugin boundaries, no son violaciones de regla) |
| i18n parity | `npm run check:i18n` | ✅ OK (391 claves, paridad es/en) |
| Unit tests | `npx vitest run` | ✅ 199/199 (10 archivos) — sin regresión |

## Evidencia Playwright (1440×900 desktop · 390×844 mobile)

Capturada vía la ruta dev `(dev)/admin-preview/[view]` (el panel real es auth-gated; el
hook de claims aún no está activo). La ruta hace `notFound()` en producción y solo es
pública en dev (`/admin-preview` en `PUBLIC_PATH_PREFIXES` del middleware). Mock data en
`mock.ts`; acciones no-op. Harness: `docs/_evidence/f1-admin/shoot.cjs`.

| Vista | Light | Dark | Extra |
|-------|-------|------|-------|
| Dashboard `/admin` | (esqueleto ola 1 + KPIs reales) | — | — |
| Catálogo lista | `catalogo-light.png` | `catalogo-dark.png` | `catalogo-mobile.png` |
| Catálogo wizard | `catalogo-wizard-light.png` | `catalogo-wizard-dark.png` | — |
| Empleados | `empleados-light.png` | `empleados-dark.png` | `empleados-matriz-light.png`, `empleados-nuevo-light.png` |
| Auditoría | `auditoria-light.png` | `auditoria-dark.png` | — |
| Configuración | `configuracion-light.png` | `configuracion-dark.png` | `configuracion-terminos-light.png` |

**Console / page errors:** 0 en las 10 vistas (light + dark). Sin 404 de recursos.

## Verificación visual vs DOC-53 / prompts (muestreo)

- **Catálogo (§4.1, PROMPT-ADM-04):** grid de cards con IconTile por color de marca (navy/blue/gold/green),
  badges de estado (Activo verde, Borrador ámbar, Oculto del cliente ámbar, Archivado), chip dorado
  "Entrada → {padre}", chips categoría/fases/planes, filtros + toggle archivados, GradientBtn "Nuevo servicio". ✅
- **Wizard (§4.2):** Stepper horizontal 6 pasos con paso actual glow; paso 1 con editor i18n ES|EN lado a lado +
  chip "Falta EN" + borde dorado en EN vacío, 3 cards de categoría, grid de iconos, 6 swatches de color
  (incluido púrpura), switch visible, preview móvil en vivo. Paso 5 (Formularios) = stub "Disponible en F4"
  con Lex `señala`. Paso 6 = checklist de publicación con issues exactos del domain. ✅
- **Empleados (§7, PROMPT-ADM-07):** tabla con avatares staff, chips de rol con los 4 colores exactos
  (Ventas azul, Paralegal verde, Finanzas púrpura, Admin dorado), "Invitación pendiente" ámbar
  diferenciado del StatusPill, resumen "{n} de 20 módulos". Modal crear (2 pasos). Matriz 20 módulos × 2
  switches (Ver/Editar) con regla encadenada (Editar→fuerza Ver). ✅
- **Auditoría (§8, PROMPT-ADM-08):** chip "Solo lectura" con candado, filtros (actor/entidad/acción/fechas),
  "Exportar CSV", tabla con chip mono de acción + label humano, chip "Sistema" para actores de sistema,
  enlaces de entidad, IP mono. Diff viewer en SidePanel: 3 columnas (campo · anterior `--red-soft` tachado ·
  nuevo `--green-soft`), i18n desplegado por idioma, toggle "Ver JSON crudo". ✅
- **Configuración (§9, PROMPT-ADM-09):** 3 tabs (General · Carátulas · T&C), form General tipado (sin JSON
  crudo) con teléfonos + zona horaria + nota literal; T&C con versión vigente destacada (chip verde Vigente),
  historial inmutable + publicar, conteo de aceptaciones. ✅

## a11y quick-check

- Switches Radix con `aria-label` por celda; Modales/SidePanel = Radix Dialog (focus trap + Escape + ARIA).
- Tablas con `aria-sort` en columnas ordenables; filas con `tabIndex`/`onKeyDown` cuando son clicables.
- Sin violaciones críticas observadas en el muestreo. Auditoría axe-core completa = trabajo de qa-engineer.
- **Nota:** los pares de marca soft (green-soft, gold-soft, purple-soft) son NORMATIVOS del doc y se
  mitigan con icono+texto (DOC-01 §8.4). No se alteran valores de marca. → flag `<<NEED-A11Y-FIX>>` para el dueño.

## Dark mode

Ambas superficies (light/dark) verificadas en las 5 vistas vía el único switch `[data-theme]` + scope
`.surface-staff`. Los tokens dark (paneles `#101E34`, accent `#5B8CFF`) se aplican sin código extra.
