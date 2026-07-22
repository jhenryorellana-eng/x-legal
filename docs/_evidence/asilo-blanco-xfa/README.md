# Anexos del cliente (I-589) que salen EN BLANCO al imprimir el expediente

Caso `a310cdac-…` (RICARDO, apelación). El documento del cliente **"Asilo presentado
completo (con anexos)"** (`ilovepdf_merged`) salía en blanco en el expediente compilado.

## Causa raíz (verificada, NO es el XFA)

El PDF contiene el **I-589 relleno digitalmente**. Sus campos AcroForm conservan los
**valores** (`/V`) pero **perdieron las apariencias** (`/AP`) y `AcroForm.NeedAppearances`
quedó **sin poner** (`null`). Resultado:

- **Adobe Acrobat** regenera la apariencia desde el valor → el cliente lo ve **lleno**.
- **pdfium / Chrome / impresoras / mupdf** (nuestro motor) **no** la regeneran → **blanco**.

`XFA=false`: al pasar el I-589 por **iLovePDF** se eliminó la capa XFA y quedaron valores
sin apariencias (el peor combo). `compileExpedientePdf` hace `graftPage` **verbatim**, así
que el expediente hereda las páginas en blanco.

## Fix

`flattenAcroAppearances()` en `src/backend/platform/pdf.ts` (gemela de lectura de
`fillAcroForm`): `update()` por widget (regenera apariencia desde el valor, **sin cambiarlo**)
+ `NeedAppearances=true` + `bake()`. Se aplica en `resolveItemBytes` a `client_document` y
`external_file`. **No-op** para escaneos y PDFs propios (sin widgets → devuelve bytes tal cual).
Degradación segura: cualquier error → bytes originales + log (nunca bloquea la compilación).

## Scripts (Node + mupdf; leen `.env.local`, service role)

| Script | Qué prueba |
|---|---|
| `diagnose.cjs` | Por página: texto, nº widgets, % de tinta del render. Muestra XFA=false y las páginas "escaneadas" vs "digitales". |
| `widget-values.cjs` | Los campos del I-589 digital **sí tienen valores** (`/V`) pese a verse en blanco. `NeedAppearances=null`. |
| `render-pngs.cjs` | Rasteriza páginas clave (evidencia visual del blanco). |
| `test-fix.cjs` | Aplica la receta a un solo doc → la página deja de estar en blanco. |
| `verify-fix.cjs` | **End-to-end**: reproduce el compile con los 12 ítems reales, SIN vs CON fix. `"PAQUI PURIZACA"` visible sólo CON fix, en las páginas del asilo. |

Los PNG/PDF renderizados (I-589 real con A-number/pasaporte) **no se versionan** — se
regeneran con los scripts.

## Pendiente para arreglar el expediente ya emitido

El fix corrige **futuras** compilaciones. Para el expediente existente de RICARDO hay que
**recompilarlo** con el código nuevo desplegado (Diana "Compilar" o job `compile-expediente`).
