# Ítem 6 del EOIR-26 — instrucción v6 (para aplicar desde el admin)

Contexto: hallazgos del re-test E2E del 2026-07-18 (segunda vuelta, caso `U26-000038`).

## Qué cambia respecto de la v5 vigente

1. **Se elimina `HARD LIMIT: 120 words total`** de la prosa. El tope pasa a ser
   **config** (`source_ref.max_chars = 1400`), que el motor inyecta en el prompt y
   **verifica** al recibir la respuesta. Un solo lugar donde vive el número.
2. **La línea del *motion to remand* deja de ser incondicional.** En el test la IA
   la añadió pese a que NO se había subido ninguna evidencia, y el cuestionario del
   mismo caso respondía `no_new_evidence` — es decir, se le anunciaba al BIA una
   moción sin sustento. Ahora la condición se ancla a algo verificable: que exista
   un documento de contexto rotulado como evidencia sustentatoria.
3. **Se explicita el formato de lista** (una línea por motivo). El normalizador
   `shared/form-logic/ai-field-format.ts` lo garantiza igualmente después, pero
   pedirlo bien reduce el trabajo de reparación.

## Texto a pegar en el campo "Instrucción para la IA"

```
Read the Immigration Judge's decision (primary document) and draft the 'Reasons for Appeal' for Form EOIR-26 item #6, in English, first person on behalf of the respondent.

FORMAT: a NUMBERED LIST, one ground per line, each on its OWN line (a real line break between items). NO elaboration: the detailed argument goes in the separate written brief, and the official form's box is small.

COVERAGE: cover EVERY dispositive ground of the decision — an unchallenged ground is WAIVED on appeal, so omitting one causes real harm. For each ground, name the specific finding of fact or conclusion of law being challenged, with at most ONE supporting citation (statute/regulation/case) only where essential.

MOTION TO REMAND: add a line announcing a motion to remand under 8 C.F.R. 1003.2(c) ONLY IF a context document rotulated as supporting evidence ("Evidencias sustentatorias") is actually attached to this case AND that evidence was not presented to the Immigration Judge. If no such document is attached, DO NOT mention a motion to remand at all — announcing one that never follows damages credibility before the Board.

NEVER use vague statements like 'the judge was wrong'. If key information is missing or illegible, write '[TO BE COMPLETED BY PREPARER]' instead of inventing facts, names, dates or citations.

End with exactly: 'A separate written brief in support of this appeal will be timely filed.'
```

## Config asociada

| Campo | Valor |
|---|---|
| `max_chars` | **1400** |

Justificación del 1400: el widget `6` mide 446,6 × 423,8 pt ≈ 2.600 caracteres a
11 pt, así que 1400 nunca desborda; y la salida real con 8 motivos fue de 697
caracteres, de modo que el tope deja margen para un caso con 12+ motivos sin
forzar jamás la omisión de uno (que sería una renuncia ante el BIA).
