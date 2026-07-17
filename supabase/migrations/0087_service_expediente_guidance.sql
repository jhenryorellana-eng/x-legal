-- 0087: per-service expediente assembly guidance (config-as-data, decision 2026-07-17).
-- English plain-text guide the AI assembly planner (proposeExpedienteAssembly) injects
-- as the CANONICAL filing order for the service. NULL → generic prompt fallback
-- (previous behavior). Editable from the admin catalog wizard; seeded per service.
-- RLS: covered by the existing services_* policies (no change needed).

alter table public.services
  add column if not exists expediente_guidance text null;

comment on column public.services.expediente_guidance is
  'English plain-text assembly guide for the AI expediente planner (canonical filing order, exhibit/translation rules). NULL = generic prompt fallback.';
