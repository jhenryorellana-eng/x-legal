# Rúbrica de calificación (QA) — Escrito de Apelación (Brief in Support of Appeal, BIA)

> **Qué es este documento.** No es un prompt de generación: es la **vara de medición** con la que el validador de IA (Pre‑Mortem / Etapa D) juzga un *Brief in Support of Appeal* **ya redactado** para una apelación ante la Board of Immigration Appeals (BIA) tras la denegación de asilo/withholding/CAT por un Immigration Judge (IJ). El validador recibe (a) esta rúbrica completa, (b) el **texto del brief generado**, (c) el **MATERIAL FUENTE** (paquete de asilo presentado con anexos + decisión y orden del IJ + evidencias sustentatorias subidas + respuestas del cuestionario de apelación del cliente) y (d) el **contexto del caso**. Con eso debe emitir un reporte estructurado: `{ score 0-100, semaforo, verdict, summary, findings[] }`.
>
> **NO es asesoría legal.** Es una compuerta heurística de calidad para atrapar contradicciones, grounds sin refutar, citas inventadas, estándares de revisión mal aplicados y evidencia nueva mal presentada **antes** de que el escrito llegue a la BIA. Objetivo operativo: que un abogado supervisor pueda confiar en que un brief con veredicto `would_approve` es coherente con el record, cubre todos los grounds del IJ con el estándar correcto y es **defendible**.

---

## 0. Propósito y calibración

### 0.1 Qué es un Brief in Support of Appeal

Es un escrito jurídico, en **inglés**, presentado ante la BIA después del Notice of Appeal (EOIR‑26), conforme al briefing schedule. Su función es **refutar los fundamentos específicos de la decisión del IJ** — no relitigar el caso ni introducir una teoría nueva. Presenta de forma clínica y persuasiva:

1. La **postura procesal**: quién apela, qué decisión, de qué corte/IJ, fecha, apelación oportuna (EOIR‑26 dentro de los 30 días, 8 C.F.R. §1003.38).
2. Los **estándares de revisión** (8 C.F.R. §1003.1(d)(3)) y su aplicación issue por issue.
3. Los **hechos del record** (fieles al expediente presentado — nunca hechos nuevos en el cuerpo).
4. La **enumeración de los grounds del IJ** y su **refutación punto por punto** (errores de derecho de novo; hallazgos de hecho/credibilidad clearly erroneous).
5. El análisis **CAT por separado**; el análisis de **tercer país** solo si el record lo toca.
6. Si hay evidencia nueva: una sección de **Motion to Remand** bajo 8 C.F.R. §1003.2(c).
7. **Precedentes** reales aplicados con analogía fáctica directa, y la **Conclusion & Prayer for Relief**.

Su fuerza depende de cuatro pilares: **coherencia con el record**, **cobertura total de los grounds** (lo no atacado se considera **waived**), **estándar de revisión correcto** por issue, y **citas verificables**.

### 0.2 Para qué sirve esta rúbrica

Da al validador criterios **verificables** y su **mapeo exacto** a la taxonomía de hallazgos del sistema (`finding-categories.ts`: severidades `critico|moderado|sugerencia`; categorías `mal_llenado|discordancia|formato|placeholder_sin_resolver|campo_faltante|dato_incoherente|calidad`), de modo que la salida sea consistente, auditable y accionable. Cada eje indica **qué revisar**, **cómo compararlo con la fuente**, **qué categoría/severidad emitir** y **cómo pesa en el score**.

### 0.3 Fuentes con las que se calibró (autoridades reales, verificadas)

| Tema | Autoridad controladora |
|---|---|
| **Estándar de revisión de la BIA** | **8 C.F.R. §1003.1(d)(3)**: hallazgos de hecho (incluida credibilidad y hallazgos predictivos) → **clear error**; cuestiones de derecho, discreción y juicio → **de novo**. **Matter of Z‑Z‑O‑, 26 I&N Dec. 586 (BIA 2015)** (los hallazgos predictivos del IJ — qué pasaría al retornar — son hechos revisados por clear error). |
| **Clear error** | "Definite and firm conviction that a mistake has been committed" — el brief no puede pedir a la BIA que simplemente re‑pese la evidencia; debe mostrar POR QUÉ el hallazgo es insostenible sobre el record. |
| **Waiver de issues** | Los grounds dispositivos no atacados en el brief se consideran abandonados. El EOIR‑26 exige declarar los motivos en detalle; el brief debe desarrollarlos TODOS. |
| **Evidencia nueva en apelación** | La BIA **no** admite evidencia nueva en apelación; una presentación con evidencia nueva se trata como **Motion to Remand/Reopen** — estándar **8 C.F.R. §1003.2(c)**: evidencia **material** que "was not available and could not have been discovered or presented at the former hearing". **Matter of Coelho, 20 I&N Dec. 464 (BIA 1992)** (los motions to remand se sujetan a los mismos requisitos sustantivos que los de reopen; el famoso "heavy burden" de Coelho es contextual — no exagerar su alcance). |
| **Deber de considerar la evidencia** | **Cole v. Holder, 659 F.3d 762 (9th Cir. 2011)** (la agencia debe dar *reasoned consideration* a evidencia potencialmente dispositiva; en CAT debe evaluarse el **riesgo agregado** de todas las fuentes de tortura, no fuente por fuente). **Sagaydak v. Gonzales, 405 F.3d 1035 (9th Cir. 2005)** (el IJ/BIA no puede ignorar argumentos planteados). |
| **Credibilidad (REAL ID)** | **INA §208(b)(1)(B)(iii)**: *totality of the circumstances* (demeanor, candor, plausibilidad, consistencia interna y con country conditions). **Shrestha v. Holder, 590 F.3d 1034 (9th Cir. 2010)** (marco de totalidad; inconsistencias deben ser reales, no trivialidades — pero incluso las menores pueden pesar si el conjunto lo sostiene). |
| **Persecución acumulativa / protección estatal** | **Matter of O‑Z‑ & I‑Z‑, 22 I&N Dec. 23 (BIA 1998)** (los incidentes se evalúan **acumulativamente**; denuncias policiales sin acción → gobierno unable/unwilling). |
| **CAT** | **8 C.F.R. §§1208.16(c)–1208.18**: *more likely than not* + **aquiescencia** estatal (incluye *willful blindness*); protección **no discrecional** y **no sujeta a las bars** del asilo. **Madrigal v. Holder, 716 F.3d 499 (9th Cir. 2013)** (error legal centrarse en la *voluntad* del gobierno de controlar al actor en vez de su *capacidad*; no se exige que TODO el gobierno aquiesza). |
| **Tercer país / firm resettlement** | **INA §208(b)(2)(A)(vi)** + **Matter of A‑G‑G‑, 25 I&N Dec. 486 (BIA 2011)** (framework: DHS carga inicial de prima facie con evidencia de oferta de residencia permanente). Presunción de tránsito (Circumvention of Lawful Pathways) = **rebatible y con excepciones**, y su litigio sigue vivo — el brief debe tratarla con precisión temporal. Withholding/CAT **no** están sujetos a estas bars. |

> **Nota de estabilidad (0.3‑bis).** La línea **Matter of A‑B‑ / Matter of A‑R‑C‑G‑** (PSG por violencia doméstica) ha sido vacada y restaurada varias veces (la última reversión en 2025). Si el brief la cita, el validador DEBE verificar por web su estado **vigente a la fecha de validación**; citarla como derecho firme sin matiz → `calidad` (moderado) o `discordancia` doctrinal si el holding citado ya no rige (crítico).

---

## 1. Reglas de oro (aplican a TODO el brief)

1. **English, clean prose.** Cuerpo en inglés jurídico claro. Español/spanglish sin marcar → `formato`.
2. **No placeholders, ever.** `[NAME]`, `[cite]`, `{{token}}`, `TBD`, `[TO BE COMPLETED]`, corchetes editoriales → `placeholder_sin_resolver` (**crítico** si es sustantivo; **moderado** si cosmético).
3. **REFUTAR, no relitigar.** El brief ataca los fundamentos de la decisión; no re‑narra el caso como si la audiencia no hubiera existido ni introduce teorías jurídicas nuevas sin anclaje en el record. Argumento que ignora por completo lo que el IJ sostuvo → `calidad` (moderado/crítico según el ground).
4. **Facts ONLY from the record.** Todo hecho del solicitante debe ser trazable al material fuente (paquete de asilo + decisión + evidencias + cuestionario). Hecho inventado o "mejorado" → `discordancia`/`calidad`. **La evidencia nueva NUNCA aparece en el cuerpo como si fuera parte del record** — solo dentro del Motion to Remand (ver Eje 5).
5. **Every citation must be REAL and verifiable.** Cita fabricada, holding tergiversado, URL falsa → **crítico** (ver Eje 6). El dataset de precedentes es guía de derecho/estilo, jamás fuente de hechos del caso.
6. **Standard of review, siempre y por issue.** Cada argumento declara y aplica su estándar (clear error vs de novo). Pedir de novo para credibilidad, o "re‑weighing" disfrazado → error doctrinal (`dato_incoherente`).
7. **One document, one chronology.** Fechas, actores y secuencias idénticos entre secciones → si no, `dato_incoherente`.
8. **No exaggeration.** Elevar el daño o el riesgo más allá del record debilita la credibilidad → `calidad`.
9. **Coherencia con el EOIR‑26.** Los grounds del brief deben corresponder a las razones declaradas en el ítem #6 del Notice of Appeal (ver §5).
10. **Cierre formal.** Conclusion & Prayer for Relief concreta (sustain the appeal; vacate/reverse; grant relief o remand). Ausente → `campo_faltante`.

---

## 2. Cómo tratar el MATERIAL FUENTE (regla de verdad)

- **El material fuente es la ÚNICA fuente de verdad de los HECHOS**: paquete de asilo presentado (con anexos), decisión del IJ, evidencias sustentatorias subidas, respuestas del cuestionario. Si el brief afirma un hecho, debe existir ahí; si lo contradice, gana la fuente → `discordancia`.
- **La decisión del IJ es la fuente de verdad de LO QUE EL IJ SOSTUVO.** El brief no puede atribuir al IJ fundamentos que la decisión no contiene (straw man) ni omitir los que sí contiene. Tergiversar la decisión → `discordancia` (**crítico**: destruye la credibilidad del escrito ante la BIA).
- **El cuestionario del cliente es la fuente de la justificación de la evidencia tardía** (por qué no se presentó antes) y de las correcciones al resumen del IJ. La justificación del brief debe SALIR de ahí — no de la imaginación del redactor.
- **Vacío en la fuente ≠ licencia para inventar.** Manejo honesto de la imprecisión ("on or about") es aceptable; fabricar → `discordancia`.
- **Comparación dato‑a‑dato**: cada afirmación factual se clasifica *soportada* / *no soportada* (`calidad`) / *contradicha* (`discordancia`) / *placeholder* (`placeholder_sin_resolver`).

---

## 3. Los 8 ejes de calificación (en orden de prioridad)

> Un mismo defecto se reporta **una sola vez** en su eje/categoría más pertinente. La severidad final la fija el impacto (§6).

### Eje 1 — Coherencia total contra el record → `discordancia` / `dato_incoherente` (PRIORIDAD MÁXIMA)

**Qué evalúa:** que cada dato del brief coincida con TODO el material fuente y que el brief no se contradiga a sí mismo. Es el eje de mayor peso: una contradicción material ante la BIA destruye el escrito.

**Criterios verificables:**
- **Identidad**: nombre legal, A‑number, nacionalidad idénticos en brief ↔ decisión ↔ paquete de asilo ↔ pasaporte. Discrepancia de A‑number o nombre → **crítico**.
- **Fechas**: decisión del IJ, audiencia, entrada a EE. UU., incidentes de persecución — coinciden con la fuente; la cronología interna es monótona.
- **Lo que declaró el cliente**: el "Statement of Facts" refleja el paquete de asilo tal como se presentó (no la versión "mejorada").
- **Lo que sostuvo el IJ**: cada ground citado con fidelidad a la decisión (idealmente con referencia de página/párrafo si el record lo permite).
- **Consistencia argumental interna**: el error alegado en el Summary of Argument es el mismo que se desarrolla después; el estándar anunciado en a2 es el aplicado en a6/a7.
- **Cifras**: número de incidentes, detenciones, duración — cuadran con la fuente.

**Severidad:** contradicción en hecho material (fecha de la decisión, identidad, qué denegó el IJ, nexo relatado) → **crítico**. Divergencia menor no central → **moderado**.

### Eje 2 — Cobertura de grounds con el estándar correcto → `campo_faltante` / `dato_incoherente`

**Qué evalúa:** que el brief enumere **todos los grounds dispositivos** de la decisión y ataque **cada uno** bajo su estándar de revisión.

**Criterios verificables:**
- Extraer de la DECISIÓN la lista de grounds dispositivos (p. ej.: adverse credibility; falta de nexo; PSG no cognizable; protección estatal disponible; reubicación interna; one‑year bar; firm resettlement/tercer país; denegación CAT). Cotejar que la sección a4 los enumera COMPLETOS.
- **Cada ground dispositivo tiene refutación** en a6/a7/a8/a9/a10. Un ground dispositivo sin atacar → **crítico** (`campo_faltante` — waiver: la BIA lo dará por abandonado).
- **Estándar correcto por issue**: credibilidad/hechos/hallazgos predictivos → *clear error* (Z‑Z‑O‑); derecho/discreción/aplicación de derecho a hechos → *de novo*. Argumento de "clear error" que en realidad solo pide re‑pesar evidencia sin mostrar el error → `calidad` (moderado). Estándar equivocado → `dato_incoherente` (moderado/crítico si es el issue central).
- El brief NO ataca grounds que la decisión no contiene (straw man) → `discordancia`.

### Eje 3 — CAT adjudicado por separado → `campo_faltante` / `dato_incoherente`

**Qué evalúa:** que el brief trate CAT como protección **independiente**: estándar *more likely than not* + **aquiescencia estatal** (o willful blindness), **no discrecional**, **no sujeta a las bars** del asilo, con **riesgo agregado** de todas las fuentes (Cole).

**Criterios verificables:**
- Si el IJ denegó CAT, existe la sección a9 con análisis específico de las falencias del veredicto CAT (¿el IJ exigió nexo? ¿ignoró aquiescencia/willful blindness? ¿evaluó fuente por fuente en vez de agregado? ¿confundió voluntad con capacidad — Madrigal?).
- El brief NO mezcla el estándar del asilo (well‑founded fear) con el de CAT.
- Si el IJ NO adjudicó CAT pese a estar solicitado, el brief lo señala como error.
- CAT ausente cuando la decisión lo denegó → **crítico** (`campo_faltante`).

### Eje 4 — Tercer país SOLO si el record lo toca → `calidad` / `campo_faltante`

**Qué evalúa:** disciplina condicional. El análisis de tercer país (presunción de tránsito CLP / firm resettlement INA §208(b)(2)(A)(vi), framework A‑G‑G‑) aparece **únicamente** si la decisión del IJ o el record lo plantean.

**Criterios verificables:**
- IJ usó la bar de tercer país y el brief la ignora → **crítico** (`campo_faltante`, ground waived).
- IJ NO la usó y el brief dedica una sección entera a refutarla → **moderado** (`calidad`: invita a la BIA a un issue inexistente). Lo correcto es una sola frase indicándolo.
- Si aplica: el brief recuerda que withholding/CAT no están sujetos a esas bars, y trata el estado del litigio CLP con precisión temporal (verificable por web).

### Eje 5 — Evidencia nueva SOLO en el Motion to Remand, con justificación honesta → `discordancia` / `calidad`

**Qué evalúa:** el manejo de las evidencias sustentatorias subidas para la apelación (documentos que NO estaban en el record de la audiencia).

**Criterios verificables:**
- **Ubicación**: la evidencia nueva se discute EXCLUSIVAMENTE dentro de la sección Motion to Remand (a11). Evidencia nueva argumentada en el cuerpo como si fuera parte del record → **crítico** (`discordancia`: la BIA no la considerará y contamina todo el escrito).
- **Estándar**: la sección invoca 8 C.F.R. §1003.2(c) — materialidad + "was not available and could not have been discovered or presented at the former hearing" — y argumenta AMBOS elementos por cada evidencia.
- **Justificación honesta y anclada**: la explicación de por qué no se presentó antes (costo de obtención, imposibilidad de conseguirla desde el país de origen, desconocimiento, fecha posterior a la audiencia) debe salir de las **respuestas del cuestionario del cliente** y ser verosímil contra el record (una evidencia FECHADA antes de la audiencia y fácilmente disponible con justificación de "no estaba disponible" → **crítico**, justificación insostenible).
- **Vinculación**: por cada evidencia, el brief dice **qué punto del caso de asilo refuerza** (el punto que el cliente indicó en el cuestionario) y su materialidad (por qué podría cambiar el resultado).
- Si NO hay evidencias nuevas subidas: la sección a11 se reduce a una frase (o se omite limpiamente); un Motion to Remand fabricado sin evidencias → **crítico**.

### Eje 6 — Citas verificables (usar web_search) → `discordancia` / `calidad`

**Qué evalúa:** que cada autoridad citada exista y diga lo que el brief dice que dice.

**Instrucción operativa al validador:** usa tu presupuesto de **web_search (cap 5)** así: (1) verifica la existencia y el holding de las 2–4 autoridades MÁS centrales del brief (las que sostienen los argumentos dispositivos); (2) verifica cualquier cita que suene inventada o que no aparezca en el dataset del sistema; (3) si te queda presupuesto, busca un ejemplo de brief/apelación similar (misma nacionalidad/tipo de error) para calibrar la calidad argumental. No gastes búsquedas en country conditions ya citadas con fuente en el propio brief salvo sospecha.

**Criterios:**
- Cita inexistente o holding tergiversado → **crítico** (`discordancia`).
- Autoridad real pero impertinente al punto (no sostiene lo argumentado) → **moderado** (`calidad`).
- Autoridad de estabilidad dudosa (línea A‑B‑/A‑R‑C‑G‑; reglas de tránsito en litigio) citada sin matiz temporal → **moderado**.
- Estadística o country condition sin fuente → `calidad`.

### Eje 7 — Especificidad y calidad argumental → `calidad`

**Qué evalúa:** que la refutación sea concreta, no genérica: cita la página/párrafo de la decisión cuando el record lo permite, identifica el pasaje del record que el IJ ignoró o malinterpretó (Cole/Sagaydak — evidencia potencialmente dispositiva sin *reasoned consideration*), construye la analogía fáctica precedente↔caso (no lista casos "de adorno"), y el Summary of Argument mapea 1:1 con los argumentos desarrollados. Vaguedad sistemática ("the IJ erred in many respects") → **moderado**. Precedente citado sin analogía fáctica → **sugerencia/moderado**.

### Eje 8 — Formato y estructura → `formato` / `campo_faltante`

**Qué evalúa:** estructura canónica completa (las 13 secciones configuradas: a1 Introduction & Procedural History · a2 Jurisdiction & Standards of Review · a3 Statement of Facts · a4 The IJ's Decision · a5 Summary of Argument · a6 Argument I Legal Errors · a7 Argument II Clearly Erroneous Findings · a8 Argument III Record Evidence Overlooked · a9 Argument IV CAT · a10 Argument V Third‑Country *(condicional)* · a11 Motion to Remand *(condicional)* · a12 Precedent Applied · a13 Conclusion & Prayer for Relief), encabezados coherentes, inglés limpio, cover/TOC del ensamblado. Sección estructural ausente (no condicional) → `campo_faltante` (moderado; crítico si es a4, a13 o el argumento del ground central).

---

## 4. Validaciones cruzadas obligatorias (brief ↔ record ↔ EOIR‑26)

1. **A‑number y nombre**: brief ↔ decisión del IJ ↔ paquete de asilo (el nombre del expediente EOIR manda).
2. **Fecha de la decisión y corte**: brief ↔ extracción de la decisión (la fecha errada compromete la tempestividad → **crítico**).
3. **Grounds del brief ↔ ítem #6 del EOIR‑26**: los argumentos desarrollados deben caber dentro de las razones declaradas en el Notice of Appeal (los issues no anunciados se arriesgan a summary dismissal). Ground del brief ausente del #6, o #6 que anuncia motivos que el brief abandona → **moderado** (`discordancia`) con corrección sugerida (actualizar el #6 vía "Actualizar PDF" o cubrir el ground en el brief).
4. **Motion to Remand ↔ EOIR‑26**: si el brief incluye a11 con evidencia nueva, el #6 debería mencionar la intención de presentar evidencia nueva/motion — discordancia → **moderado** con corrección sugerida.
5. **Relief pedida ↔ relief denegada**: la Prayer pide exactamente lo que el IJ denegó (asylum/withholding/CAT según el caso); pedir relief no litigada → `dato_incoherente`.
6. **Nacionalidad/país de remoción** coherentes en todo el paquete.

---

## 5. Score, semáforo y veredicto (calibración)

### 5.1 Qué SIGUE siendo crítico (nunca lo rebajes)

- Contradicción material contra el record o tergiversación de la decisión del IJ (Eje 1).
- Ground dispositivo sin refutar (Eje 2 — waiver).
- CAT denegado y no atacado (Eje 3).
- Tercer país usado por el IJ e ignorado por el brief (Eje 4).
- Evidencia nueva fuera del Motion to Remand, o justificación de indisponibilidad insostenible/fantasiosa (Eje 5).
- Cita legal inexistente o holding tergiversado (Eje 6).
- Placeholder sustantivo sin resolver.

### 5.2 Qué NO es crítico en la validación pre‑firma (lección EOIR‑26 §11)

Estas condiciones son **sugerencia** (el flujo las resuelve después, antes de presentar):
- Firmas manuscritas pendientes; Proof of Service aún no ejecutado; ensamblado físico/anexos pendientes de compilar.
- La tarifa/fee waiver (EOIR‑26A) en trámite — NO es objeto de este brief.
- Ajustes cosméticos de formato del PDF final.

### 5.3 Criterio aprobatorio explícito

- **`would_approve` (score ≥ 75, semáforo amber/green):** cero hallazgos críticos; coherencia total contra el record; TODOS los grounds dispositivos atacados con su estándar correcto; CAT tratado por separado (si aplica); condicionales a10/a11 correctamente activadas u omitidas; citas centrales verificadas.
- **`needs_corrections` (≈ 50–74):** sin críticos de invención/contradicción, pero con moderados accionables (analogías débiles, cruce #6 desalineado, estándar declarado pero mal ejecutado en un issue secundario).
- **`would_reject` (< 50 o cualquier crítico de los listados en 5.1):** el brief no debe salir así.
- El `summary` (en español) SIEMPRE: (a) lista los grounds del IJ detectados y marca cuáles quedaron cubiertos/sin cubrir; (b) reporta el resultado del cruce con el EOIR‑26; (c) indica qué citas verificó por web y su resultado; (d) si hay Motion to Remand, evalúa la solidez de la justificación 1003.2(c).

### 5.4 Reglas de emisión

- Cada `finding`: `location` (sección/heading exacto en inglés), `description` y `correction` en español, `severity` y `category` con los códigos EXACTOS del sistema.
- Anti doble‑penalización: un defecto → un hallazgo en su eje más pertinente.
- No inventes hallazgos para "rellenar": un brief limpio merece green/would_approve.

---

*Rúbrica del Pre‑Mortem para `escrito-de-apelacion` (ai_letter, servicio `apelacion`). Copia versionada de la guía cargada en `form_fill_guides`. No es asesoría legal.*
