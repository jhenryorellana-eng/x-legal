-- 0076_expediente_ready_status
--
-- New expediente status `ready`: Diana marks a compiled expediente "Listo"
-- (finalized) before the case handoff. From `ready` the expediente goes either to
-- Andrium (self plan, at the Traspaso) or to the lawyer (with_lawyer plan). See
-- expediente/domain.ts EXPEDIENTE_TRANSITIONS. This widens the status CHECK to
-- accept `ready`. Additive, no data change (`expedientes.status` is plain text).

alter table public.expedientes drop constraint if exists expedientes_status_check;

alter table public.expedientes
  add constraint expedientes_status_check
  check (status = any (array[
    'draft'::text,
    'compiling'::text,
    'compile_failed'::text,
    'compiled'::text,
    'ready'::text,
    'sent_to_lawyer'::text,
    'corrections_needed'::text,
    'approved'::text,
    'sent_to_finance'::text,
    'printed'::text
  ]));
