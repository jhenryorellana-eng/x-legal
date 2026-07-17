# Cuestionario companion `escrito-de-apelacion-cuestionario` — borradores de config

> Config destino: `questionnaire_generation_configs` — `mode=hybrid`, `hybrid_layout=append_group`,
> `target_question_count=18`, `model=claude-sonnet-4-6`, `auto_trigger=true`,
> `allow_client_trigger=false`, `on_new_evidence=flag`,
> `input_document_slugs=[asilo-presentado-completo-con-anexos, decision-y-orden-del-juez-de-inmigracion, evidencias-sustentatorias]`,
> `prerequisite_document_slugs=[asilo-presentado-completo-con-anexos, decision-y-orden-del-juez-de-inmigracion]`
> (las evidencias NO son prerequisito — son opcionales).

## (a) `generation_prompt` (ES — para el generador de preguntas dinámicas)

```
Servicio: APELACIÓN ANTE LA BIA (escrito de apelación / appeal brief). El juez de inmigración negó
el caso del cliente; ya subió su paquete de asilo completo (tal como se presentó), la decisión y
orden del juez y, opcionalmente, evidencias sustentatorias nuevas. Genera preguntas de
PROFUNDIZACIÓN ancladas en esos documentos, para refutar la decisión: (a) por CADA evidencia
sustentatoria nueva que haya subido — identifícala por su nombre de archivo, tal como aparece
rotulada en el contexto — pregunta: ¿a qué incidente, afirmación o punto de tu caso de asilo
pertenece y qué prueba exactamente?, ¿por qué no pudiste presentarla ante el juez antes de la
audiencia? (por ejemplo: costaba dinero conseguirla, era imposible obtenerla desde tu país, no
sabías que existía o que hacía falta, o es de fecha posterior a la audiencia) — NUNCA sugieras la
respuesta ni justificaciones falsas; si no subió evidencias nuevas, NO generes preguntas de esta
parte; (b) por cada motivo concreto que usó el juez para negar (los verás en la decisión:
credibilidad, falta de conexión con un motivo protegido, protección del gobierno, reubicación
interna, tercer país, CAT, etc.) pregunta: ¿qué respondes tú a ese motivo?, ¿qué hechos o
documentos de tu expediente lo contradicen?; (c) ¿qué evidencias que SÍ estaban dentro de tu
paquete de asilo crees que el juez no consideró o entendió mal, y qué probaban?; (d) datos de la
audiencia que el escrito necesita: qué pasó ese día, si hubo problemas con el intérprete o con tu
abogado, qué dijiste que no aparece o aparece mal resumido en la decisión, y quiénes declararon.
Lenguaje simple y humano, sin tecnicismos legales; una idea por pregunta.
```

## (b) Preguntas BASE del hybrid (grupo global — editor del admin, ES/EN)

| # | key sugerida | Pregunta (ES) | Question (EN) | field_type | Help (ES) |
|---|---|---|---|---|---|
| 1 | injusto | ¿Qué fue lo que te pareció más injusto o equivocado de la decisión del juez? | What did you feel was most unfair or wrong about the judge's decision? | textarea | Cuéntalo con tus palabras; no necesitas términos legales. |
| 2 | abogado-audiencia | ¿Tuviste abogado en tu audiencia? ¿Cómo fue esa representación? | Did you have a lawyer at your hearing? How was that representation? | textarea | Di si fuiste solo/a, o si tu abogado no presentó algo que tú querías presentar. |
| 3 | interprete | ¿Hubo problemas con el intérprete o con la traducción durante tu audiencia? | Were there problems with the interpreter or the translation during your hearing? | textarea | Por ejemplo: no entendías las preguntas, tradujeron mal una fecha o un hecho importante. |
| 4 | no-aparece | ¿Dijiste algo importante en la audiencia que no aparece (o aparece mal contado) en la decisión del juez? | Did you say something important at the hearing that is missing (or misstated) in the judge's decision? | textarea | Qué dijiste, en qué momento, y cómo lo resumió mal la decisión. |
| 5 | evidencia-nueva | ¿Tienes evidencia nueva que no presentaste ante el juez? ¿Por qué no la presentaste antes? | Do you have new evidence you did not present to the judge? Why didn't you present it before? | textarea | Sé honesto/a: costaba conseguirla, no se podía obtener desde tu país, no sabías que existía, o es de fecha posterior. La razón real importa — no inventes. |
| 6 | situacion-economica | ¿Cuál es tu situación económica actual (ingresos y gastos de tu hogar)? | What is your current financial situation (your household's income and expenses)? | textarea | Sirve para evaluar la exoneración de la tarifa de apelación ($1,030) más adelante. |
| 7 | algo-mas | ¿Hay algo más que tu equipo legal deba saber para tu apelación? | Is there anything else your legal team should know for your appeal? | textarea | Cualquier detalle, aunque parezca pequeño. |

Notas:
- Todas `is_required=false` salvo #1 y #4 (`is_required=true`): son el corazón de la refutación.
- La #5 alimenta la sección Motion to Remand del brief; la #6 queda registrada para la futura ola
  EOIR-26A (fee waiver) — decisión de Henry: el argumento de pobreza del fee waiver queda en espera.
- El generador (parte (a)) añade las preguntas por-evidencia y por-ground como grupo(s) anexado(s)
  (`append_group`) después de estas bases.
