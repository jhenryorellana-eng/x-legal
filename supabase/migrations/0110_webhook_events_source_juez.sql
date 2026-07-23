-- ============================================================
-- 0110_webhook_events_source_juez.sql
-- Añade 'juez' al CHECK de webhook_events.source.
--
-- WHY. La verificación en vivo de la ola "Evaluación de Asilo" (0109) cazó que
-- claimWebhookEvent para el webhook de Juez fallaba en silencio: el CHECK de
-- source (0009) solo admite stripe/abogados/livekit/qstash/resend, así que el
-- INSERT del claim violaba el constraint (23514, no 23505) y el barrier hacía
-- fail-open ("retry") — el webhook se procesaba SIN idempotencia persistida
-- (una re-entrega duplicaba timeline/notificaciones). Los unit tests no lo
-- veían (mockean el claim); solo el flujo real contra la BD lo expuso.
--
-- Depends on: 0009_integrations, 0109_service_external_tools
-- ============================================================

alter table public.webhook_events
  drop constraint if exists webhook_events_source_check;

alter table public.webhook_events
  add constraint webhook_events_source_check
  check (source in ('stripe','abogados','livekit','qstash','resend','juez'));
