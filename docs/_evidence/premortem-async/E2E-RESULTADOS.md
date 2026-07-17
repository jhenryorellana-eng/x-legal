# E2E en PROD — Pre-Mortem asíncrono (QStash) + indicador "Generando…" · 2026-07-17

Deploy `c049590` · caso Valentina `U26-000035` · todo por la UI del navegador (Playwright MCP)
sobre `x-legal.usalatinoprime.com`.

## Pre-Mortem asíncrono

1. Click **Validar** en el Escrito de Apelación → respuesta inmediata: banner "En cola…/
   Validando…", botón deshabilitado, botón **Cancelar** visible.
2. **Recarga de página → el estado PERSISTE** (fuente de verdad: la fila
   `case_pre_mortem_assessments` con `status`, no estado del navegador).
3. **Lock por target**: con el brief validando, el selector en EOIR-26 mostró "Validar"
   HABILITADO (otros documentos no se bloquean).
4. **Candado atómico**: `INSERT` duplicado directo a la tabla → `23505` en
   `uq_premortem_active_target` (rechazado por el índice, no por la app).
5. El job QStash reclamó la fila en segundos (`queued→running`, `started_at` sellado) y
   **completó a los ~9 minutos: 72 · amber · needs_corrections · $4.1962 — SIN ningún
   timeout** (con el camino síncrono viejo, esta misma validación había muerto dos veces
   por abort). La varianza 82→72 sobre el mismo documento es la conocida del validador;
   la calibración determinista mapeó 72<75 → needs_corrections correctamente.
6. Al terminar: toast + refresh automático del polling (4s, pausado con pestaña oculta,
   UN solo refresh al terminal), reporte visible, botón rehabilitado.

## Indicador de generación + bloqueos

7. **Regenerar** el brief → pill **"Generando"** visible de inmediato (bug corregido: antes
   el run en vuelo era INVISIBLE — primera generación decía "Sin generar" y re-generación
   "Completada vN"), botón "Generando…" deshabilitado, la info de la v4 completada siguió
   visible. **Persiste tras recarga.**
8. **Bloqueo cruzado**: con la v5 generándose, click en Validar → toast "Este documento se
   está regenerando…" (`PREMORTEM_TARGET_REGENERATING`) y **cero filas creadas** en BD.
9. v5 completó ($1.5305) → el pill pasó solo a "Completada v5", toast "Carta generada.",
   botón de vuelta en "Regenerar" habilitado.

## Proceso (pedido de Henry: agentes + Kimi, una sola conclusión)

- Plan: 3 exploradores + arquitecto (Claude) + consulta de diseño a Kimi (K3) →
  conclusión única fusionada (adopciones y descartes justificados en el plan).
- Implementación: backend TDD (Claude, 48 tests nuevos del ciclo async) + generaciones-tab
  (**Kimi vía kimi-rescue**, diff revisado antes de integrar).
- Review two-stage: code-reviewer NEEDS-REVISION (3 STRONG, 0 blockers) → fixes →
  **APPROVED**; **pase adversarial de Kimi** por invariantes (vía ask; el kimi-review
  nativo es inviable en Windows con diffs grandes — ENAMETOOLONG del argv) → 2 invariantes
  refutadas con escenario + 4 bugs menores → 6 fixes aplicados (Map de polls por id,
  guarda post-unmount, toast espurio tras cancel, resume tras cap, sweep por updated_at,
  clasificador fast-fail estrecho) + 1 tradeoff documentado en código (retry tras timeout
  puede re-pagar una llamada — fiabilidad > costo por directiva, acotado a 3 llamadas).
- Gates: typecheck 0 · eslint 0 · **vitest 2294** · build ✓ · check:i18n 2751 ✓.

Captura: `.playwright-mcp/valentina-generando-pill.png` (validación y generación en vuelo
a la vez, ambos indicadores visibles). Coste del E2E ≈ $5.7.
