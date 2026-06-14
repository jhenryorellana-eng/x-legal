# F4 Ola-0 — Spike AcroForm: hallazgos y decisión de arquitectura

> Mitigación del **Riesgo R1** (DOC-80 §3): "el editor `pdf_automation` (detección AcroForm + asistencia IA) resulta más complejo de lo estimado — es la pieza más novedosa del sistema". Spike ejecutado contra 3 PDFs gubernamentales reales. **Resultado: R1 resuelto.**

## TL;DR — Decisión

**El motor de formularios PDF de F4 es `mupdf` (Artifex MuPDF.js, wasm), NO `pdf-lib`.**
El SoT (DOC-40 §3.5) asumía `pdf-lib`; el spike prueba que pdf-lib **falla con los formularios reales de USCIS** (los lee como 0 campos o crashea). mupdf los lee, rellena y aplana perfectamente, y corre en serverless (wasm puro). Desviación documentada y justificada por evidencia.

## Evidencia (3 PDFs oficiales reales)

| Formulario | Origen | pdf-lib | @cantoo/pdf-lib | **mupdf** |
|---|---|---|---|---|
| **I-765** (EAD, USCIS) | uscis.gov, 7 págs | ❌ crash `Expected PDFDict, got undefined` | ⚠️ 0 campos (silencioso) | ✅ **161 widgets** (119 text · 38 checkbox · 4 combobox) + rect + page |
| **I-360** (VAWA/SIJS, USCIS) | uscis.gov, 19 págs | ❌ crash | ⚠️ 0 campos | ✅ **510 widgets** (334 text · 165 checkbox · 11 combobox) |
| **EOIR-26** (BIA appeal) | justice.gov, 14 págs | — | — | ✅ abre, **0 widgets** (la versión pública es print-and-sign, sin AcroForm) |

**Causa raíz**: los formularios USCIS modernos son **XFA híbridos** (Adobe LiveCycle) — tienen una capa XFA dinámica + una capa AcroForm estática, con object streams comprimidos. pdf-lib solo entiende AcroForm puro sin comprimir → falla. mupdf entiende ambas capas.

## Las dos funciones núcleo — PROBADAS

### `detectAcroFields(bytes) → DetectedField[]`
mupdf: por página `page.getWidgets()` → cada widget da `getName()`, `getFieldType()` (`text|checkbox|combobox|radiobutton|signature|button`), `getBounds()` (rect `[x0,y0,x1,y1]`) y la página. Ejemplo real I-765:
```
form1[0].Page1[0].Line1a_FamilyName[0]  [text]     page=1  rect=[120,642,294,660]
form1[0].Page1[0].Part1_Checkbox[0]     [checkbox] page=1  rect=[61,373,71,383]
```
→ alimenta `form_automation_versions.detected_fields` + el resaltado del visor PDF del editor (DOC-53 §5).

### `fillAcroForm(bytes, mapping, values) → flattenedBytes`
Receta confiable para XFA híbrido (verificada — el valor queda **visible en el PDF aplanado**):
1. **Drop XFA**: `acroForm.delete("XFA")` → la apariencia AcroForm estática pasa a ser autoritativa (si no, un visor XFA-aware ignora los valores).
2. `acroForm.put("NeedAppearances", true)`.
3. Por campo mapeado: `widget.setTextValue(value)` (o `setChoiceValue`/checkbox toggle) + `widget.update()` (regenera apariencia).
4. `doc.bake()` → aplana campos a contenido (widgets after bake = 0).
5. `doc.saveToBuffer("").asUint8Array()` → bucket `generated`.

Round-trip confirmado: tras bake, el texto extraído de la pág contiene el valor (`GONZALEZ-SPIKE` → visible ✓).

## Pipeline de render de generaciones (md/docx → salida)

- **PDF**: `markdown-it` (md→HTML) → **mupdf** `Document.openDocument(html,"text/html")` + `layout(612,792,11)` + `DocumentWriter` → PDF. Confirmado: mupdf maqueta HTML a páginas US Letter. **Un solo motor (mupdf) para llenado de forms Y render de generaciones.**
- **DOCX**: librería `docx` (genera .docx directo desde JS) — se instala en Ola 1.
- **MD**: texto crudo, sin render.

## Casos límite / fallback (documentados)

- **0 campos AcroForm** (como el EOIR-26 print-and-sign): el editor muestra el error "PDF sin AcroForm" (RF-ADM-031 E1). Tales formularios no son candidatos a `pdf_automation` automático (requerirían overlay posicional por coordenadas — fuera de alcance V2.0).
- **PDF encriptado**: `openDocument` con manejo de excepción → error claro al admin.
- mupdf emite warnings benignos ("Invalid object ref", "structure tree broken") que NO afectan la detección/llenado — se silencian en logs.

## Dependencias

- **Añadida y adoptada**: `mupdf` (motor de formularios + render PDF).
- **Descartadas** (probadas y removidas): `pdf-lib`, `@cantoo/pdf-lib` (no leen los formularios reales).
- **Pendiente Ola 1**: `markdown-it`, `docx`.

## Impacto en el plan

- Ola 1 `domain.ts`/runtime usa mupdf para render PDF de generaciones.
- Ola 2 `createAutomationVersion`/`redetectFields`/`generateTestPdf` usan `detectAcroFields`/`fillAcroForm` (mupdf).
- Ola 3 `generateFilledPdf` usa `fillAcroForm` (mupdf) con `resolveBySource`.
- **Propuesta de cambio al SoT**: DOC-40 §3.5 — sustituir "pdf-lib" por "mupdf" como motor de detección/llenado AcroForm (evidencia: este spike).

## Scripts de evidencia (en esta carpeta)

`detect.cjs` (pdf-lib — falla), `compare.cjs` (cantoo vs mupdf), `mupdf-test.mjs` (detección+fill), `mupdf-verify.mjs` (geometría+round-trip), `fill-debug.mjs` (receta XFA confiable), `htmlpdf.mjs` (html→pdf). PDFs reales en `pdfs/`.
