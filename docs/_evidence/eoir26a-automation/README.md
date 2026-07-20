# EOIR-26A (Fee Waiver Request) — automation runbook

> Estado: **preparado, NO aplicado a PROD** (decisión de Henry 2026-07-19: "código + dry-run,
> parar antes de PROD"). Este README es la receta de creación config-como-datos. La vía primaria
> es el **editor de admin** (igual que se hizo el EOIR-26), no un seed SQL.

## Qué es (fuentes oficiales)
Form **EOIR-26A — Fee Waiver Request** (*Solicitud de Exención de Pago*), edición vigente **Rev. Aug.
2022**. Se presenta **junto con** el EOIR-26 ante la BIA para pedir la exención de la tarifa de
apelación ($1,030 FY2026). Obligatorio ante la BIA salvo pago (8 CFR §1003.8). Estructura: encabezado
(Name, A-Number) · Affidavit (lo firma el respondente, NO el abogado) · Parte 1 Ingresos (4 renglones
+ total 1.A) · Parte 2 Gastos (5 renglones + total 2.B) · Parte 3 Cálculo (1.A, 2.B, TOTAL = 1.A−2.B,
puede ser negativo) · Parte 4 explicación · sección de Abogado (en blanco si es pro se). Regla de oro:
**ninguna casilla en blanco**. Guía completa: `docs/guides/eoir-26a-fee-waiver-guia.md`.
PDF oficial: https://www.justice.gov/eoir/eoirforms/eoir26a.pdf

## Prerrequisitos
1. Migraciones **0098** (`form_questions.source += 'computed'`), **0099** (`form_definitions.is_required`),
   **0100** (`case_form_overrides`): **✅ APLICADAS y verificadas en PROD (2026-07-20)**. `database.types.ts`
   está editado a mano en esta ola (no correr `npm run db:types` — está roto, sobrescribe el archivo).
2. El código de plataforma (fuente `computed` + visibilidad de formularios) está en la rama de esta ola
   (5 gates verdes) — **falta desplegarlo** (push a `main` → auto-deploy Vercel) antes del E2E en vivo.

## Diseño de la encuesta (config-como-datos)
`form_definition` slug **`eoir-26a`**, `kind='pdf_automation'`, `filled_by='client'`,
`is_per_party=false`, **`is_required=false`** (opcional → visible por defecto → ocultable por Vanessa),
en la fase `fase-1` de `apelacion`, `position=1` (entre EOIR-26 y el Escrito).
`default_empty_policy='na'` (ninguna casilla de texto en blanco).

**Campos AcroForm reales (detectados por mupdf, `dump-fields.cjs` → `fields.json`):** 24 campos, 2 páginas,
nombres semánticos limpios. **Hallazgo clave:** `MonthIncome` y `MonthExpense` aparecen 2 veces cada uno
(p1 = totales 1.A/2.B, p2 = copias Parte 3). Campos AcroForm con el MISMO nombre comparten valor → llenar
`MonthIncome` llena la casilla 1.A *y* la de la Parte 3 automáticamente. Por eso solo hacen falta **3
campos computed** (no 5), y una pregunta no puede mapear dos veces el mismo `pdf_field_name`.

| Grupo | Pregunta (ES/EN) | field_type | source | `pdf_field_name` |
|---|---|---|---|---|
| 1 Encabezado | Nombre (Apellido, Nombre, 2º) | text | `profile` | `Name Last First Middle` |
| 1 Encabezado | Número "A" | text | `document_extraction` (A-number de la decisión del IJ) o `profile` | `Alien A Number`, `no_translate` |
| 2 Affidavit | Nombre en letra de molde | text | `profile` | `Print name of alien filing the form` |
| 2 Affidavit | Firma / Fecha | — | grupo `do_not_fill` | `Signature of Alien Filing the Form`, `AlienSigDate` |
| 3 Ingresos | Empleo/autoempleo · Renta de propiedad · Intereses · Otros ingresos | number ×4 | `client_answer` | `IncomeEmployment` `IncomeProperty` `IncomeInterest` `IncomeOther` (`default_value:"0"`) |
| 3 Ingresos | **1.A Total ingresos** | number | **`computed` sum(4 ingresos)** | `MonthIncome` (llena 1.A + copia Parte 3) |
| 4 Gastos | Renta/hipoteca · Servicios · Pagos a plazos · Gastos de vida · Otros gastos | number ×5 | `client_answer` | `ExpenseRent` `ExpenseUtil` `ExpenseInstall` `ExpenseLiving` `ExpenseOther` (`default 0`) |
| 4 Gastos | **2.B Total gastos** | number | **`computed` sum(5 gastos)** | `MonthExpense` (llena 2.B + copia Parte 3) |
| 5 Cálculo | **TOTAL (ingresos − gastos)** | number | **`computed` subtract(MonthIncome, MonthExpense)** | `TotalTot`, negativo permitido |
| 6 Parte 4 | Explica por qué no puedes pagar | textarea | `client_answer` + `ai_improve` | `Information`, `is_required=true` |
| 6 Parte 4 | ¿Estás detenido/a? | select (sí/no) | `client_answer` | (auxiliar: tailoriza el help de Parte 4, sin `pdf_field_name`) |
| 7 Abogado | Sección de Abogado/Representante | — | grupo `do_not_fill` | `Signature of Attorney or Representative` `Print Name` `EOIR ID Number` `Date` |

## Receta (editor de admin — vía primaria, mirror de EOIR-26)
1. Admin → Catálogo → Apelación → Formularios → **Nuevo formulario** `eoir-26a` (pdf_automation, client,
   opcional). Marcar `is_required=false`.
2. Subir el PDF oficial (`eoir26a.pdf`) → detecta campos AcroForm (mupdf).
3. **Proponer con IA** (borrador) → corregir contra el field-map real: crear los 7 grupos, las preguntas
   ES/EN de la tabla, mapear cada una a su casilla.
4. Ingresos/gastos = `number` `client_answer`; los **5 totales** = origen **"Total calculado"** (`computed`):
   1.A = suma de los 4 ingresos; 2.B = suma de los 5 gastos; Parte 3 copia 1.A y 2.B; TOTAL = resta 1.A−2.B.
5. Firma/fecha/abogado = grupos `do_not_fill`. `default_empty_policy='na'`.
6. **Previsualizar** con datos de prueba → verificar que 1.A/2.B/TOTAL (incl. negativo) salen correctos y
   ninguna casilla queda en blanco. Ajustar el formato monetario en `src/shared/form-logic/computed.ts`
   (`formatComputedResult`) contra el render real si hace falta.
7. **Pre-Mortem**: tarjeta "Pre-Mortem" → "Subir .md" → `docs/guides/eoir-26a-fee-waiver-guia.md` → Guardar.
8. **Publicar** v1.

## Brief + expediente (ya editados en los seeds — correr con autorización)
- Brief detecta el EOIR-26A: `docs/_evidence/apelacion-brief/seed-ola2.cjs` (`input_form_slugs` += `eoir-26a`)
  + `drafts/system-prompt.txt` (instrucción condicional de fee waiver). Re-correr `seed-ola2.cjs` para aplicar.
- Expediente en orden oficial BIA (EOIR-26A arriba): `docs/_evidence/expediente-guidance/seed-guidance.cjs`.
  Correr `node docs/_evidence/expediente-guidance/seed-guidance.cjs` para aplicar.

## Verificación E2E (tras publicar, con navegador MCP)
1. Cliente de un caso de Apelación ve EOIR-26A, teclea ingresos/gastos → **Generar PDF**: 1.A/2.B/TOTAL
   correctos (incluye el caso negativo del ejemplo de la guía: 1.400 − 1.900 = −500), 0 casillas en blanco.
2. **Pre-Mortem** corre contra la guía cargada.
3. Vanessa **oculta** el EOIR-26A en otro caso (botón "Ocultar al cliente", pestaña Información) →
   deja de aparecerle al cliente; **Mostrar** lo restaura.
4. Brief: con EOIR-26A presentado → menciona la exención en el Procedural Summary; sin él → no la menciona.
5. Expediente compila con EOIR-26A **arriba** y el Certificado de Servicio dentro del brief.
