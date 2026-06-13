-- Migration 0016: Scheduling + Kanban atomic RPCs
--
-- Purpose: provides Postgres-level atomicity for two multi-step operations
-- that currently rely on application-level ordering for safety:
--
--   reschedule_appointment_tx  (C-1) — inserts new appt and marks old as
--     'rescheduled' in a single transaction, eliminating the window where
--     both rows could briefly appear 'scheduled' if the second write fails.
--
--   move_kanban_card_tx        (H-3) — updates card position and lead status
--     (contacted_at, won/lost) atomically, so a server crash mid-operation
--     cannot leave a card and its lead in inconsistent states.
--
-- IMPORTANT: These RPCs are an OPTIONAL improvement over the existing
-- application-level reorder (C-1 / H-3 ordering invariants in service.ts).
-- The service.ts implementations remain functional without these RPCs.
-- Apply this migration via the orchestrator after QA sign-off.
--
-- Security: SECURITY DEFINER with search_path = '' so the functions run as
-- their owner (postgres / service_role) and bypass RLS. They are granted
-- ONLY to service_role (never to authenticated) — called from the backend only.
--
-- DO NOT apply this migration directly to production. Let the orchestrator
-- apply it via Supabase MCP after review.

-- ---------------------------------------------------------------------------
-- reschedule_appointment_tx
-- ---------------------------------------------------------------------------
-- Atomically:
--   1. INSERT new appointment row
--   2. UPDATE old appointment status → 'rescheduled'
-- Returns the new appointment row.
-- Raises:
--   'SLOT_TAKEN_DB'   — EXCLUDE constraint violation on new slot
--   'APPT_NOT_FOUND'  — old appointment id not found
-- ---------------------------------------------------------------------------

create or replace function public.reschedule_appointment_tx(
  p_old_id          uuid,
  p_case_id         uuid,
  p_lead_id         uuid,
  p_service_phase_id uuid,
  p_staff_id        uuid,
  p_client_user_id  uuid,
  p_starts_at       timestamptz,
  p_ends_at         timestamptz,
  p_kind            text,
  p_sequence_number integer,
  p_reminder_1d     boolean,
  p_reminder_1h     boolean,
  p_notes           text
)
returns uuid  -- new appointment id
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_id uuid;
begin
  -- Step 1: insert new appointment (may fail on EXCLUDE constraint)
  begin
    insert into public.appointments (
      case_id, lead_id, service_phase_id, staff_id, client_user_id,
      starts_at, ends_at, kind, status, sequence_number,
      reminder_1d, reminder_1h, notes
    ) values (
      p_case_id, p_lead_id, p_service_phase_id, p_staff_id, p_client_user_id,
      p_starts_at, p_ends_at, p_kind, 'scheduled', p_sequence_number,
      p_reminder_1d, p_reminder_1h, p_notes
    )
    returning id into v_new_id;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN_DB';
  end;

  -- Step 2: mark old appointment rescheduled (only reached if insert succeeded)
  update public.appointments
  set status = 'rescheduled', updated_at = now()
  where id = p_old_id;

  if not found then
    raise exception 'APPT_NOT_FOUND';
  end if;

  return v_new_id;
end;
$$;

-- Grant only to service_role (backend calls only — never exposed to authenticated)
revoke all on function public.reschedule_appointment_tx(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, integer, boolean, boolean, text
) from public;
grant execute on function public.reschedule_appointment_tx(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, integer, boolean, boolean, text
) to service_role;

-- ---------------------------------------------------------------------------
-- move_kanban_card_tx
-- ---------------------------------------------------------------------------
-- Atomically:
--   1. UPDATE kanban_cards: column_id + position
--   2. Optionally UPDATE leads: contacted_at (set if null), status (won/lost)
-- Parameters:
--   p_card_id         — card to move
--   p_to_column_id    — target column
--   p_to_position     — target position
--   p_set_contacted   — if true, set leads.contacted_at = now() where null
--   p_lead_id         — lead ref_id (null if not a lead card)
--   p_lead_status     — null | 'won' | 'lost' (terminal column transition)
--   p_lost_reason     — required when p_lead_status = 'lost'
-- ---------------------------------------------------------------------------

create or replace function public.move_kanban_card_tx(
  p_card_id        uuid,
  p_to_column_id   uuid,
  p_to_position    integer,
  p_set_contacted  boolean,
  p_lead_id        uuid,
  p_lead_status    text,      -- null | 'won' | 'lost'
  p_lost_reason    text       -- required if p_lead_status = 'lost'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Step 1: lead side effects (before card move so failure keeps card visible)
  if p_lead_id is not null then
    if p_set_contacted then
      update public.leads
      set contacted_at = now()
      where id = p_lead_id and contacted_at is null;
    end if;

    if p_lead_status = 'won' then
      update public.leads
      set status = 'won', updated_at = now()
      where id = p_lead_id and status <> 'won';
    elsif p_lead_status = 'lost' then
      if p_lost_reason is null or trim(p_lost_reason) = '' then
        raise exception 'LEAD_LOST_REASON_REQUIRED';
      end if;
      update public.leads
      set status = 'lost', lost_reason = p_lost_reason, updated_at = now()
      where id = p_lead_id and status <> 'lost';
    end if;
  end if;

  -- Step 2: move the card
  update public.kanban_cards
  set column_id = p_to_column_id, position = p_to_position, updated_at = now()
  where id = p_card_id;

  if not found then
    raise exception 'CARD_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.move_kanban_card_tx(
  uuid, uuid, integer, boolean, uuid, text, text
) from public;
grant execute on function public.move_kanban_card_tx(
  uuid, uuid, integer, boolean, uuid, text, text
) to service_role;
