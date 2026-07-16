# "Mejorar con IA" — instrucciones por campo (seed vía admin UI)

> Análisis campo por campo de los 4 formularios publicados (BD PROD `uexxyokexcamyjcknxua`,
> inventario 2026-07-16). Cada instrucción se pega en el form-editor del admin
> (sección "Mejorar con IA (cliente)") con Playwright. Los guardrails comunes
> (no inventar/añadir/quitar hechos, conservar idioma, conservar tokens PII,
> devolver solo el texto) viven en el system prompt fijo de `ai-engine` — la
> instrucción por campo define SOLO el formato/registro del campo.
>
> ⚠️ **Para revisión de Henry**: la instrucción del ítem 1 del EOIR-26 (formato
> que acepta el juez). El resto sigue los formatos de los formularios oficiales.

## apelacion / eoir-26 (v2 published)

| # | question_id | Campo | Instrucción |
|---|---|---|---|
| 1 | `eb29af50-24fe-4025-9bb2-a05ab5140c94` | Ítem 1 — nombres + A-numbers (textarea) | **(v2, decisión de Henry 2026-07-16: formato canónico `A-#########`)** Formatea como lista: UNA persona por línea, con el formato exacto "APELLIDO(S), Nombre(s) - A-#########" (ejemplo: PEREZ GOMEZ, Diego Armando - A-312654987). Apellidos en MAYÚSCULAS, nombres con mayúscula inicial. El número A (número de extranjero) va como la letra A, un guion y 9 dígitos seguidos. Si un número aparece sin la letra A, consérvalo tal cual. No agregues ni quites personas y no alteres los dígitos. — *El formato del número lo aplica un normalizador DETERMINISTA en código (`normalizeANumbersInText`), no la IA: el número viaja tokenizado y la IA nunca ve los dígitos.* |
| 2 | `660f6539-739e-474c-921a-5ab5dbfb13aa` | Ítem 6 — razones de la apelación (textarea, ai_field) | Registro formal jurídico en el idioma en que está escrito el texto. Corrige gramática, puntuación y coherencia; conserva la estructura de párrafos y cualquier numeración existente. No añadas hechos, argumentos ni citas legales nuevas. |
| 3 | `df30079f-7cdb-4eb9-bcbc-07572a6d52ab` | Última audiencia (text) | Formato: "Corte, Ciudad, Estado" con mayúsculas de nombre propio y la abreviatura postal de 2 letras del estado (ejemplo: Immigration Court, Houston, TX). |
| 4 | `33494cb0-e789-40a4-8456-6cf279b73b71` | Nombre completo en imprenta (text) | Devuelve solo el nombre completo con mayúsculas de nombre propio (ejemplo: Diego Armando Perez Gomez), sin texto adicional. |
| 5 | `a0ad64a4-8c2a-4a1a-8ac9-7477c1215ec7` | Nombre en el correo (text) | Devuelve solo el nombre completo con mayúsculas de nombre propio, sin texto adicional. |
| 6 | `1ac47681-004e-4523-bb92-c1309073ea2d` | Dirección calle y número (text) | Formato postal de EE. UU.: número y calle con abreviaturas USPS (St, Ave, Blvd, Rd). Solo la línea de calle — sin ciudad, estado ni código postal. Ejemplo: 1234 N Main St. |
| 7 | `1344037a-7a2c-40c2-9c02-66163463a448` | Apartamento/cuarto (text) | Solo la unidad en formato USPS (ejemplo: Apt 5B, Unit 12). Sin dirección ni texto adicional. |
| 8 | `3caa2e8a-1a5d-47c5-8332-eaf88f2bcba5` | Ciudad, estado y ZIP (text) | Formato: "Ciudad, XX 00000" — mayúscula de nombre propio en la ciudad, abreviatura postal de 2 letras del estado y ZIP de 5 dígitos. Ejemplo: Houston, TX 77002. |
| 9 | `264de920-0dd3-4913-a2b5-dbe7a599216a` | Teléfono (text) | Formato de teléfono de EE. UU.: (###) ###-####. Usa solo los dígitos presentes; no inventes dígitos faltantes. |
| 10 | `a5cae448-22f5-4f7f-b8e4-396ed04ce0a3` | Dirección de envío de la copia (text) | Dirección postal completa en una sola línea, formato USPS: número y calle, Ciudad, XX 00000. |
| 11 | `67ac974e-9379-45ff-9355-b1baa7d764c9` | Nombre de quien certifica (text) | Devuelve solo el nombre completo con mayúsculas de nombre propio, sin texto adicional. |

## asilo-politico / i-589-parte-a-informacion-personal (v3 published) — 15 textareas

**Instrucción NARRATIVA** (12 campos de explicación de Parte B/C):
`f8d04f73…`, `5e6240af…`, `58056358…`, `c03261e8…`, `3cc39428…`, `2c5083bd…`,
`56c0e105…`, `a392bce2…`, `f6b557e5…`, `6a8eba32…`, `93b15b3e…`, `6bc3cbcc…`

> Narrativa en primera persona para un formulario oficial de asilo. Corrige ortografía, puntuación y mayúsculas; organiza en oraciones completas y párrafos claros; cuando la pregunta pide varios puntos (qué pasó, cuándo, quién, por qué), preséntalos en ese orden. Escribe las fechas como MM/DD/YYYY. Conserva todos los hechos, nombres, lugares y cantidades exactamente como los escribió la persona.

**Procedimientos de inmigración de hijos** (`72bc7a27…` hijo 5, `fcae61a5…` hijo 6):

> Una línea por procedimiento con el formato: Corte — tipo de caso — fechas (MM/DD/YYYY). Mayúsculas de nombre propio en cortes y ciudades. No añadas procedimientos que la persona no mencionó.

**Suplemento B — información adicional** (`9cbda563…`):

> Limpieza de texto dictado: elimina muletillas y repeticiones de transcripción, puntúa, capitaliza y organiza en párrafos claros. Conserva todos los hechos, fechas, nombres y lugares exactamente; no resumas ni añadas nada.

## asilo-politico / i-589-partes-b-y-c-reclamo-de-asilo (v2 published) — 11 textareas

**Narrativas de persecución** (`a67ae10f…` grupo social, `c2843e66…` daño sufrido, `6aed9699…` miedo futuro, `449da071…` reubicación interna, `2a3556e8…` tortura, `6d05e20a…` participación, `056ebf8f…` procedimientos corte, `388fa14e…` info adicional):

> Narrativa en primera persona para un formulario oficial de asilo. Corrige ortografía, puntuación y mayúsculas; organiza en oraciones completas y párrafos con orden cronológico cuando aplique. Registro claro y serio, sin dramatizar. Escribe las fechas como MM/DD/YYYY. Conserva todos los hechos, nombres, lugares y cantidades exactamente como los escribió la persona.

**Parte C-1 solicitudes previas** (`991e9f8f…` — incluye número A) **(v2: canónico `A-#########`)**:

> Organiza la respuesta en este orden: quién solicitó, cuándo (MM/DD/YYYY), la decisión recibida y el número A. El número A va como A-######### (la letra A, un guion y 9 dígitos seguidos). No alteres los dígitos.

**Parte C-2 viaje por terceros países** (`c5560611…`):

> Una entrada por país en líneas separadas con el formato: País — tiempo de estadía — estatus migratorio — por qué saliste — si pediste protección y el resultado. Mayúsculas de nombre propio; fechas como MM/DD/YYYY.

**Parte C-4 arrestos fuera de EE. UU.** (`e721f8eb…`):

> Una línea por arresto o condena con el formato: fecha (MM/DD/YYYY) — lugar — acusación — resultado — si estuvo relacionado con tu caso. No añadas ni omitas incidentes.

## asilo-politico / memorandum-de-miedo-creible-cuestionario (v1 published) — 16 textareas

**Instrucción LIMPIEZA DE DICTADO** (los 16 campos: `920bbf8b…`, `c88bf46e…`, `e6f6d0e0…`, `95d867bb…`, `277f054a…`, `4cddc571…`, `9b9cf752…`, `6d9d7032…`, `c6524d2c…`, `a505955e…`, `36fd55b0…`, `e9362594…`, `608214cb…`, `31c78070…`, `e1302483…`, `73caee5c…`):

> Limpieza de texto dictado por voz: elimina muletillas y repeticiones de transcripción; puntúa, acentúa y capitaliza; organiza en oraciones completas y párrafos claros, en primera persona y en orden cronológico cuando aplique. Escribe las fechas como MM/DD/YYYY. Conserva TODOS los hechos, fechas, nombres y lugares exactamente como los dijo la persona; no resumas, no interpretes y no añadas nada.

**Variante para la lista de evidencias** (`31c78070…` — sobreescribe la genérica):

> Convierte la respuesta en una lista: un documento o evidencia por línea, con guion inicial. Corrige ortografía y capitaliza nombres propios. No añadas documentos que la persona no mencionó.

---

Totales: **44 textareas + 9 text (EOIR-26) = 53 campos** configurados.
Los 204 `text` del I-589 Parte A (nombres/fechas/números sueltos) quedan sin config en esta ola.
