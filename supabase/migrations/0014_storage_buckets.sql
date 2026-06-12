-- =============================================================================
-- 0014_storage_buckets.sql
-- 8 private Storage buckets + policies on storage.objects
-- Depends on: 0004 (cases), 0005 (contracts), 0008 (expedientes)
-- (paths reference cases/contracts/expedientes which must already exist)
-- =============================================================================
-- All buckets are PRIVATE (public = false). Access only via signed URL after
-- server-side validation (DOC-30 §14). The canonical path convention per bucket
-- is the source of truth for the storage.objects policies below (SOT-RLS-7).
--
-- Path conventions:
--   case-documents:   case/{case_id}/{document_id}.{ext}
--   generated:        case/{case_id}/…
--   expedientes:      case/{case_id}/{expediente_id}-v{attempt_no}.pdf
--                     (also external/{case_id}/… for Diana's external files)
--   contracts:        contract/{contract_id}/…
--   payment-proofs:   case/{case_id}/{payment_id}.{ext}
--   chat-attachments: conv/{conversation_id}/…
--   catalog-assets:   forms/{form_definition_id}/… · datasets/{dataset_id}/…
--   avatars:          {user_id}/avatar.{ext}

-- ---------------------------------------------------------------------------
-- Bucket definitions
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('case-documents',
   'case-documents',
   false,
   26214400,
   array['application/pdf','image/jpeg','image/png','image/webp','image/heic']),

  ('generated',
   'generated',
   false,
   52428800,
   array['application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'text/markdown']),

  ('expedientes',
   'expedientes',
   false,
   209715200,
   array['application/pdf']),

  ('contracts',
   'contracts',
   false,
   26214400,
   array['application/pdf','image/png','image/jpeg']),

  ('payment-proofs',
   'payment-proofs',
   false,
   10485760,
   array['application/pdf','image/jpeg','image/png','image/webp','image/heic']),

  ('chat-attachments',
   'chat-attachments',
   false,
   26214400,
   null),

  ('catalog-assets',
   'catalog-assets',
   false,
   52428800,
   array['application/pdf','text/plain','text/markdown']),

  ('avatars',
   'avatars',
   false,
   5242880,
   array['image/jpeg','image/png','image/webp'])

on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- storage.objects policies — per bucket
-- RLS on storage.objects uses the path helpers:
--   (storage.foldername(name))[1]  => first path segment
--   (storage.foldername(name))[2]  => second path segment (the UUID)
-- ---------------------------------------------------------------------------

-- ── case-documents ──────────────────────────────────────────────────────────
-- Path: case/{case_id}/…  => segment[2] = case_id
-- SELECT: case member or staff with module 'cases'
create policy "case-documents select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'case-documents'
    and (
      (select public.is_case_member(((storage.foldername(name))[2])::uuid))
      or (select public.has_module('cases', false))
    )
  );

-- INSERT: case member (client uploads to own case) or staff with module 'cases'
create policy "case-documents insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'case-documents'
    and (
      (select public.is_case_member(((storage.foldername(name))[2])::uuid))
      or (select public.has_module('cases', true))
    )
  );

-- UPDATE / DELETE: service_role only (replacements = new object, not edit).
-- No policies for authenticated => denied by default.


-- ── generated ───────────────────────────────────────────────────────────────
-- Path: case/{case_id}/…  => segment[2] = case_id
-- SELECT: case member (delivered outputs) + staff with module 'cases'
-- INSERT / UPDATE / DELETE: service_role only (IA generation jobs)
create policy "generated select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'generated'
    and (
      (select public.is_case_member(((storage.foldername(name))[2])::uuid))
      or (select public.has_module('cases', false))
    )
  );


-- ── expedientes ─────────────────────────────────────────────────────────────
-- Path: case/{case_id}/…  => segment[2] = case_id
-- Client NEVER reads compiled expedientes directly (DOC-30 §8).
-- SELECT: staff with module 'expedientes', 'printing', or 'validations'
-- INSERT / UPDATE / DELETE: service_role only (compilation job)
create policy "expedientes select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'expedientes'
    and (
      (select public.has_module('expedientes', false))
      or (select public.has_module('printing', false))
      or (select public.has_module('validations', false))
    )
  );


-- ── contracts ───────────────────────────────────────────────────────────────
-- Path: contract/{contract_id}/…  => segment[2] = contract_id
-- SELECT: staff (cases/billing) + client who is a member of the case linked to the contract
-- INSERT / UPDATE / DELETE: service_role only (signed PDF persisted in signing transaction)
-- Note: the /firma/[token] page never touches Storage directly; the server renders via service_role.
create policy "contracts select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'contracts'
    and (
      (select public.has_module('cases', false))
      or (select public.has_module('billing', false))
      or exists (
           select 1 from public.contracts c
            where c.id = ((storage.foldername(name))[2])::uuid
              and c.case_id is not null
              and (select public.is_case_member(c.case_id))
         )
    )
  );


-- ── payment-proofs ──────────────────────────────────────────────────────────
-- Path: case/{case_id}/…  => segment[2] = case_id
-- SELECT: case member (client + finance via case) + staff with module 'billing'
-- INSERT: case member (client uploads their Zelle proof)
-- UPDATE / DELETE: service_role only
create policy "payment-proofs select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (
      (select public.is_case_member(((storage.foldername(name))[2])::uuid))
      or (select public.has_module('billing', false))
    )
  );

create policy "payment-proofs insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (select public.is_case_member(((storage.foldername(name))[2])::uuid))
  );


-- ── chat-attachments ────────────────────────────────────────────────────────
-- Path: conv/{conversation_id}/…  => segment[2] = conversation_id
-- SELECT: conversation participant + admin
-- INSERT: conversation participant
-- UPDATE / DELETE: service_role only
create policy "chat-attachments select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (
      (select public.is_conversation_participant(((storage.foldername(name))[2])::uuid))
      or (select public.is_admin())
    )
  );

create policy "chat-attachments insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (select public.is_conversation_participant(((storage.foldername(name))[2])::uuid))
  );


-- ── catalog-assets ──────────────────────────────────────────────────────────
-- Path: forms/{form_definition_id}/… or datasets/{dataset_id}/…
-- SELECT: staff with module 'catalog' or 'datasets'
-- INSERT (write): same
-- DELETE: admin only
create policy "catalog-assets select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'catalog-assets'
    and (
      (select public.has_module('catalog', false))
      or (select public.has_module('datasets', false))
    )
  );

create policy "catalog-assets write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'catalog-assets'
    and (
      (select public.has_module('catalog', true))
      or (select public.has_module('datasets', true))
    )
  );

create policy "catalog-assets delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'catalog-assets'
    and (select public.is_admin())
  );


-- ── avatars ─────────────────────────────────────────────────────────────────
-- Path: {user_id}/avatar.{ext}  => segment[1] = user_id
-- No public listing (legacy debt corrected).
-- SELECT: any authenticated user of the org (staff and client; needed for roster/chat)
-- INSERT / UPDATE / DELETE: owner only (their own avatar slot)
create policy "avatars select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (select public.is_staff())
      or (select public.is_client())
    )
  );

create policy "avatars write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth.uid())
  );

create policy "avatars update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth.uid())
  );

create policy "avatars delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth.uid())
  );
