# Diseño — Verificación de tipo de documento al subir (aviso al cliente, no bloqueante)

- **Fecha:** 2026-07-21
- **Autor:** Claude (brainstorming con Henry)
- **Estado:** aprobado (alcance: Componente 1 + config Componente 2; Componente 3 diferido)
- **Origen:** caso `a310cdac-1292-4920-b7e0-3a808e2bcc3b` (apelación BIA). El cliente subió, bajo el
  requisito **"Pasaporte del apelante"**, un PDF con **2 licencias de conducir de Connecticut**
  (Ricardo Paqui Tineo + Madeleine Purizaca Temoche). La extracción devolvió `passport_number: null`
  (correcto: una licencia no tiene número de pasaporte) y solo capturó a la 1ª persona. El sistema
  **no dio ninguna señal** de que lo subido no era lo pedido ni de que contenía 2 personas.

## 1. Problema

Al subir un documento con `ai_extract=true`, el sistema hoy:
1. Corre un **gate de legibilidad** síncrono (`assessDocumentLegibility`, Gemini Vision) que solo
   rechaza escaneos claramente ilegibles/borrosos (DOC-42; `cases/service.ts` ~L1531).
2. Encola la extracción async (`executeExtractionJob`) con el `extraction_schema` del requisito.

No hay ninguna verificación de que **el documento sea del tipo pedido**, ni de **cuántas personas**
contiene. Resultado: documentos equivocados entran en silencio y datos de personas adicionales se
pierden.

## 2. Objetivo y no-objetivos

**Objetivo (Componente 1 + 2):** cuando el cliente sube un documento de identidad, verificar con
**alta precisión** su tipo real y cuántas personas contiene; si no coincide con lo pedido o trae más
de una persona, **avisar al cliente en el momento** con una confirmación adicional
*"¿Deseas subirlo de igual manera?"* — **sin bloquear** (puede subirlo igual tras confirmar).

**No-objetivos (fuera de alcance):**
- **Componente 3 (diferido):** reestructurar el `extraction_schema` del pasaporte a `persons[]`
  multi-persona en `document_extractions.payload`. El gate de subida **detecta** el nº de personas,
  pero la extracción async sigue guardando los campos escalares de la 1ª persona por ahora.
- Modelar co-apelantes como `case_parties` / `service_party_roles`.
- Cambiar el **nombre** o la **obligatoriedad** del requisito "pasaporte" (decisión de Henry).
- El **Item #1 del EOIR-26** ya lista a los apelantes desde `appellants_line` de la decisión del
  juez (verificado); **no se toca**.

## 3. Arquitectura

Reutiliza la llamada Gemini Vision **que ya existe** en el gate de subida (0 coste/latencia extra).
Respeta las fronteras de módulos (DOC-21): `catalog` posee la config, `ai-engine` corre la IA,
`cases` orquesta la subida/gate, la UI del cliente muestra el aviso.

```
Cliente (subir)                cases/service.ts                 ai-engine
   │  confirmUpload(1ª vez) ─────►  confirmDocumentUpload
   │                                  │  assessDocumentIntake ──────►  1 llamada Gemini Vision
   │                                  │     (legible + kind + persons)  { legible, blurLevel,
   │                                  │                                    documentKind, personCount,
   │                                  │                                    reasonEs/En }
   │                                  │  ── ilegible ⇒ borra objeto + throw DOC_NOT_LEGIBLE (igual que hoy)
   │  ◄── { ok:false, warning } ──────┤  ── tipo≠pedido | personas≠1 ⇒ NO borra, NO crea fila; devuelve warning
   │                                  │
   │  [muestra aviso + "Subir de igual manera"]
   │  confirmUpload(ack) ───────────►  confirmDocumentUpload(acknowledgedWarnings)
   │                                  │  ── skip re-assess; crea case_documents; encola extract-document
   │  ◄── { ok:true, caseDocumentId }─┘
```

## 4. Componentes

### 4.1 `ai-engine`: `assessDocumentIntake` (extiende `assessDocumentLegibility`)
- **Firma:** `assessDocumentIntake({ bytes, mimeType, expectedKind }): Promise<DocumentIntakeVerdict>`.
- **Veredicto:** `{ legible, blurLevel, documentKind, personCount, reasonEs, reasonEn }`.
- `documentKind ∈ { passport, drivers_license, national_id, residence_card, birth_certificate, other }`.
- Prompt endurecido para **máxima precisión**: leer encabezados/sellos/MRZ, distinguir explícitamente
  "DRIVER LICENSE / NOT FOR FEDERAL IDENTIFICATION" de un pasaporte, contar identidades distintas.
- **Fail-open** (igual que hoy): error del proveedor ⇒ `{ legible:true, documentKind:'other',
  personCount:1, ... }` (nunca bloquea la subida por caída de IA).
- Respeta el **AI stub** (E2E/CI): sin llamada a Gemini, veredicto neutro.
- `assessDocumentLegibility` se conserva como wrapper delgado (compat) o se reemplaza por
  `assessDocumentIntake` en su único call-site.

### 4.2 `catalog`: config `expected_document_kind` (Componente 2)
- **Migración aditiva** (autorizada): `required_document_types.expected_document_kind text NULL`
  (CHECK contra el enum de `documentKind`). `NULL` = sin verificación de tipo (comportamiento actual
  para docs no-identidad: paquete de asilo, decisión del juez).
- **Seed:** `pasaporte-del-apelante.expected_document_kind = 'passport'`.
- Expuesto en la lectura de requisitos que ya usa `cases` para el gate.

### 4.3 `cases`: gate soft-warning en `confirmDocumentUpload`
- Corre `assessDocumentIntake` con `expectedKind = requirement.expected_document_kind`.
- **Rechazo duro (sin cambios):** ilegible / `blurLevel === 'heavy'` ⇒ borra objeto + `DOC_NOT_LEGIBLE`.
- **Aviso suave (nuevo):** si `expectedKind != null` y (`documentKind !== expectedKind` **o**
  `personCount !== 1`) y **no** viene en `acknowledgedWarnings` ⇒ **no** borra el objeto, **no** crea
  la fila; devuelve `{ warning: { kind: 'type_mismatch'|'multiple_persons', documentKind, personCount,
  reasonEs, reasonEn } }`.
- **Confirmación:** 2ª llamada con `acknowledgedWarnings` ⇒ **omite** el re-assess (evita 2ª llamada
  Gemini; la legibilidad ya pasó en la 1ª), crea la fila y encola la extracción.
- Documentos `signature_role` siguen exentos (igual que hoy).
- El aviso es **advisory**: confiar en `acknowledgedWarnings` del cliente es correcto (es justo el
  "subir de igual manera"); no es un control de seguridad.

### 4.4 UI cliente (`subir`) — PROMPT-CLI-15
- Nuevo estado entre "subiendo" y "celebración": **tarjeta de aviso** con Lex modo `atento`, el motivo
  (`reasonEs`) y dos acciones: **"Subir de igual manera"** (re-llama con ack) y **"Elegir otro archivo"**
  (vuelve a captura; borra el objeto huérfano vía `deleteDocument`).
- Copys nuevos i18n **es/en** (`check:i18n` verde).

## 5. Datos y contratos
- `ConfirmUploadResult` gana `warning?: { kind, documentKind, personCount, reasonEs, reasonEn }`.
- `confirmUploadAction` / `confirmDocumentUpload` ganan `acknowledgedWarnings?: string[]`.
- Nada se persiste del veredicto en esta fase (el aviso es transitorio; el objeto queda en Storage
  entre la 1ª llamada y la confirmación — mismo perfil de "huérfano" que un upload abandonado hoy).

## 6. Manejo de errores
- IA caída ⇒ fail-open (no aviso, sube normal).
- `personCount` esperado = 1 para requisitos de identidad `is_per_party=false` (hardcode explícito;
  configurable en el futuro modelo per-party — fuera de alcance).
- `matchesRequirement` se computa en **código** (`documentKind === expectedKind`), no se delega el
  juicio final a la IA → determinista y testeable.

## 7. Pruebas
- Unit `assessDocumentIntake`: stub IA; mapea kind/personCount; fail-open.
- Unit gate: mismatch ⇒ warning sin borrar/crear; ack ⇒ crea + encola sin 2º assess; ilegible ⇒ hard
  reject; `expected_document_kind=null` ⇒ sin verificación (regresión del flujo actual).
- Paridad i18n es/en de los copys.
- Gates DoD (DOC-80 §6): `typecheck` 0 · `eslint` 0 · `vitest` verde · `build` · `check:i18n`.

## 8. Migración PROD (autorizada por Henry)
- `NNNN_required_document_types_expected_document_kind.sql` (aditiva, reversible) + seed del pasaporte.
- Aplicable vía MCP (`apply_migration`) en el paso correspondiente del plan.
