# Etapa C — UI "Fases anteriores": verificación en vivo (2026-06-29)

Tab read-only "Fases anteriores" en el workspace de casos (shared-case). Backend `getPriorPhaseMaterials`
ya en prod (migración 0054). Esta es la verificación end-to-end del UI.

## Gates (todos verdes)
- `npm run typecheck` → 0 errores
- `npm run check:i18n` → OK (2280 claves, paridad es/en)
- `npx eslint` (archivos modificados) → limpio (solo avisos pre-existentes de deprecación de `boundaries`)
- `npx vitest run` → 1771 passed (103 archivos)
- `npm run build` → compila las 3 rutas (`legal/caso/[caseId]`, `admin/casos/[caseId]`, `ventas/clientes/[caseId]`)

## Dato de prueba (write a prod autorizado por Henry)
- `UPDATE cases SET current_phase_id = '50465402-…' (Reforzar, pos 1) WHERE case_number='ULP-2026-0011'`
  (antes estaba en Sustentos, pos 0). Reversible: el id original de Sustentos es `10218501-fde6-488a-a11a-8b9ed4c41fc6`.
- Tras el avance, `getPriorPhaseMaterials` debe devolver la fase **Sustentos** con **7 docs + 1 form**
  (verificado por SQL espejo de la función).

## Verificación en vivo (Playwright, dev :3100, sesión Henry admin)
Caso ULP-2026-0011 → `/admin/casos/35023394-b5b7-43cc-9111-5fcf865a9e6f`:
1. **Tab presente**: la barra de tabs incluye "Fases anteriores" (tras "Expediente").
   Screenshot: `prior-phase-tab-admin.png`.
2. **Contenido correcto** (read-only): grupo "Sustentos" → subsección "Documentos" con 7 ítems
   (Pasaporte Rosa Esposa · Pasaporte Daiana · Acta Nacimiento Mateo · Acta Nacimiento Sofia ·
   Denuncia Policial Carlos · I-94 Carlos · Pasaporte Carlos Ramirez), cada uno con parte + estado
   (En revisión / Aprobado) + botón "Visualizar"; subsección "Formularios" con 1 ítem
   (I-589 (Parte A) — Información personal · Carlos · Aprobado) + botón "Descargar".
   Coincide exactamente con la BD (7 docs + 1 form en Sustentos).
3. **Preview de documento funciona**: "Visualizar" en "Pasaporte Rosa Esposa" abre el
   `DocumentPreviewModal` con el PDF cargado en `<iframe>` (ruta `/api/v1/cases/.../documents/.../preview`).
   Screenshot: `prior-phase-doc-preview.png`.
4. **Descarga de PDF de formulario funciona**: "Descargar" en el I-589 Parte A abre la URL firmada de
   Storage `…/storage/v1/object/sign/generated/case/35023394-…/forms/i-589-parte-a-informacion-personal-…pdf?token=…`
   (scope=download) — prueba end-to-end de `getFilledPdfUrl` (= `getFormResponsePdfUrlAction`) →
   `getBridge().share.openExternal(url)`, RNF-036-compliant.
5. **Test negativo**: caso ULP-2026-0009 (en Sustentos, pos 0, sin fases anteriores) → la barra de tabs
   **NO** incluye "Fases anteriores" (va Expediente → Traspaso). Confirma el gating por `hasPriorPhases`.

## Notas
- Sin afordancias de escritura en el tab (no subir/aprobar/editar/regenerar) — estrictamente lectura.
- ULP-2026-0011 queda en "Reforzar" (útil para demostrar la feature en prod). Para revertir:
  `UPDATE cases SET current_phase_id='10218501-fde6-488a-a11a-8b9ed4c41fc6' WHERE case_number='ULP-2026-0011';`
