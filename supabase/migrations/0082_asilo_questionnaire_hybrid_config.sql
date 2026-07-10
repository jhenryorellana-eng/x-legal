-- 0082_asilo_questionnaire_hybrid_config.sql
-- Ola 3 — seed the credible-fear questionnaire's generation config (data-only).
--
-- Turns the credible-fear questionnaire into HYBRID mode: its fixed base questions
-- (the legal minimums) are always shown, and the AI appends DEEP, SPECIFIC
-- follow-up questions read from the client's I-589 + declaración jurada + evidencias.
-- Prerequisite: the I-589 is submitted (documents are already guaranteed by the
-- Ola 2 documents gate, so no document prerequisite is needed here).
--
-- Idempotent (on conflict do update) so re-running refreshes the config.

insert into public.questionnaire_generation_configs (
  form_definition_id, mode, generation_prompt,
  input_form_slugs, input_document_slugs,
  prerequisite_form_slugs, prerequisite_document_slugs,
  target_question_count, model, hybrid_layout, auto_trigger
)
select
  fd.id,
  'hybrid',
  'Servicio: ASILO POLÍTICO (memorándum de miedo creíble). El cliente ya presentó su I-589 y subió su ' ||
  'declaración jurada y evidencias sustentatorias. Genera preguntas de PROFUNDIZACIÓN sobre su persecución y ' ||
  'su miedo, ancladas en lo que consta en esos documentos y respuestas. Cubre, según lo que aplique a su caso: ' ||
  '(a) cada incidente concreto de persecución/daño — fecha exacta, lugar (ciudad/zona), quiénes fueron los ' ||
  'agentes, qué ocurrió a detalle, quiénes fueron testigos, qué pasó inmediatamente después y las secuelas ' ||
  'físicas o psicológicas; (b) las amenazas — medio, frecuencia, contenido textual y autor; (c) por qué fue ' ||
  'señalado/a (opinión política, religión, nacionalidad, raza o pertenencia a un grupo social particular) y ' ||
  'cómo se le identificó; (d) si acudió a la policía o autoridades y qué pasó; (e) intentos de reubicación ' ||
  'interna; (f) la ruta y forma de salida del país y de entrada a EE. UU.; (g) por qué teme regresar hoy. ' ||
  'Pide SIEMPRE fechas y lugares concretos para poder corroborar con noticias y eventos públicos (represión, ' ||
  'elecciones, informes de ONU/ACNUR/HRW). NO repitas lo ya respondido en el I-589 ni en las preguntas base.',
  array['i-589-parte-a-informacion-personal']::text[],
  array['declaracion-jurada','evidencias-sustentatorias']::text[],
  array['i-589-parte-a-informacion-personal']::text[],
  '{}'::text[],
  18,
  'claude-sonnet-4-6',
  'append_group',
  true
from public.form_definitions fd
where fd.slug = 'memorandum-de-miedo-creible-cuestionario'
on conflict (form_definition_id) do update set
  mode = excluded.mode,
  generation_prompt = excluded.generation_prompt,
  input_form_slugs = excluded.input_form_slugs,
  input_document_slugs = excluded.input_document_slugs,
  prerequisite_form_slugs = excluded.prerequisite_form_slugs,
  prerequisite_document_slugs = excluded.prerequisite_document_slugs,
  target_question_count = excluded.target_question_count,
  model = excluded.model,
  hybrid_layout = excluded.hybrid_layout,
  auto_trigger = excluded.auto_trigger,
  updated_at = now();
