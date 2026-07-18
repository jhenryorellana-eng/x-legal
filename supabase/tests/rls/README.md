# RLS Test Suite — UsaLatinoPrime V2

pgTAP tests for Row Level Security policies defined in DOC-31.

## Files and DOC-31 §8.2 mapping

| File | DOC-31 §8.2 test # | What it asserts |
|------|-------------------|-----------------|
| `01_client_isolation.sql` | **1** | Client A cannot SELECT cases or case_documents of Client B |
| `02_deactivated_user.sql` | **10, 11** | JWT valid but `users.is_active=false` → `is_staff()` / `is_case_member()` return false → 0 rows |
| `03_staff_module_matrix.sql` | **12** | No module row → 0 rows + INSERT blocked; `can_view` → read only; `can_edit` → read+write; admin bypasses all (module: cases) |
| `04_anti_spoofing_write.sql` | **14** | Client cannot UPDATE cases; cannot INSERT case_documents/case_timeline with another user's UUID |
| `05_anon_total_block.sql` | **17** | `anon` role: 0 rows on all representative tables, INSERT raises 42501 |
| `06_billing_module_gate.sql` | **6, 7** | Paralegal without `billing` sees 0 installments/payments; without `accounting` sees 0 ledger_entries; finance with both modules sees all |
| `07_role_defaults_block.sql` | **8, 20** | Sales (no `expedientes`) sees 0 expedientes + blocked INSERT; finance (no `validations`) sees 0 legal_validations + blocked INSERT; **#20** — `legal_validations` UPDATE is service_role-only: even a paralegal WITH the `validations` module cannot UPDATE the verdict (42501) |
| `08_finance_leads_write_block.sql` | **9** | Finance (no `leads` module) cannot SELECT, INSERT, or UPDATE leads; view-only leads staff also blocked from INSERT |
| `09_catalog_module_matrix.sql` | **12** (catalog/datasets), **13** | Catalog/datasets module three-state matrix; admin bypass of catalog+datasets; mid-transaction revocation of `cases` module → next statement returns 0 rows immediately (RF-ADM-045) |
| `10_signing_token.sql` | **18** | Public `/firma/[token]` signing flow cannot be replicated via `anon` or `authenticated` roles against `contracts`; token lookup does not unlock RLS |
| `11_client_ai_pipeline_hidden.sql` | **4** | Client who IS a case member sees 0 rows in `ai_generation_runs` and `document_extractions`; cannot INSERT into `ai_generation_runs` (42501) — costs/pipeline hidden from clients |
| `12_messaging_participant_isolation.sql` | **21** | conversations/messages gated by `is_conversation_participant()`: non-participant staff (finance) + outsider client see 0; messages INSERT only participant + sender=self + kind in (text,attachment) — system/spoof blocked (42501); UPDATE/DELETE affect 0 rows (immutable); admin override reads the thread |
| `13_messaging_realtime_conv_channel.sql` | **22** | `conv:{id}` channel predicate (`is_conversation_participant`, the variable term of policy `rt conv select`): participant ✓; outsider/deactivated-participant/non-participant-admin denied (the channel has NO `is_admin` override); unknown id deny-by-default; `anon` cannot execute the helper (42501) |
| `14_client_child_table_isolation.sql` | **2, 3, 5** | Client cannot SELECT `case_documents` of a case they are not a member of; sees only `case_timeline` rows with `visible_to_client=true` for their own case; a case-member client sees 0 `expedientes`/`expediente_items`/`legal_validations` (Block 8/9 have no client branch) |
| `15_form_response_approval_gate.sql` | **16** | Client `case_form_responses` UPDATE: can edit/submit their own draft (draft→submitted) but can NEVER set `approved` (WITH CHECK → 42501); a submitted row is no longer client-editable (0 rows); cannot INSERT a non-draft response |
| `16_webhook_events_service_role_only.sql` | **19** | `webhook_events` INSERT/UPDATE denied for every `authenticated` (admin, paralegal, client) — service_role only; admin with audit access can SELECT; client sees 0 |
| `17_calls_participant_gate.sql` | **23** | `calls`: non-participant sees 0 and cannot INSERT (42501); participant starts a call as themselves with `status='ringing'`; cannot spoof `started_by` nor INSERT a non-ringing call (42501) |
| `18_notifications_personal_channel.sql` | **24** | `notifications` P-OWNER: user A does not SELECT/UPDATE/DELETE user B's notifications (0 rows); no `authenticated` INSERT for self or others (42501, service_role-only producer); positive: owner marks own read |
| `19_community_client_readonly.sql` | **25, 26** | Client reads only `is_published=true` `community_posts` of their org, never drafts, cannot INSERT (42501); staff without `community` module sees 0 + cannot INSERT; staff with `community` can_edit CAN INSERT |
| `20_scheduling_client_scope.sql` | **27, 28** | Client sees 0 `availability_rules`/`availability_exceptions`/`staff_scheduling_settings` (raw agenda hidden); `appointments` self-service: client books only on their own case as themselves, cannot spoof `client_user_id` nor book a foreign case (42501), cannot UPDATE another client's appointment (0 rows) |
| `21_storage_bucket_policies.sql` | **29** | `storage.objects`: client SELECT/INSERT only `case-documents` objects whose path `case_id` is their case; cross-case path denied (42501/0 rows); `expedientes` bucket invisible to client + no `authenticated` INSERT (42501) |
| `22_realtime_channels_multitenant.sql` | **30** | Realtime channel predicates: client cannot join `board:*` (not owner/admin), passes `team:{org}` SELECT but FAILS INSERT (cannot track presence), staff passes INSERT; multi-tenant — admin of a foreign org sees 0 `cases` of another org (`org_id = auth_org_id()`) |
| `23_lex_private_threads.sql` | — (0093 Lex) | Lex case chat: client sees 0 `case_knowledge_chunks`/`case_lex_threads`/`case_lex_messages` and cannot INSERT chunks (42501); staff with `cases` sees chunks and their OWN thread/messages (+ INSERT into own thread); chunks are service-role-only even for staff (42501); another staff with the module sees 0 threads/messages and cannot INSERT into a foreign thread — history is private per employee |

## Running locally

```bash
# Start the local Supabase stack (requires Docker)
supabase start

# Run the full test suite
supabase test db

# Run a single file
supabase test db --db-url "$(supabase status | grep 'DB URL' | awk '{print $3}')" \
  supabase/tests/rls/01_client_isolation.sql
```

`supabase test db` discovers all `*.sql` files under `supabase/tests/` recursively
(Supabase CLI v1.127+). Each file is run as a pgTAP transaction.

## Running in CI (GitHub Actions)

The workflow installs the Supabase CLI and starts a local stack:

```yaml
- uses: supabase/setup-cli@v1
  with:
    version: latest

- run: supabase start

- run: supabase test db
  working-directory: .
```

The `supabase start` command applies all migrations from `supabase/migrations/`
and seeds from `supabase/seeds/` before the tests run.

## Design decisions

- Every test is **fully self-contained**: fixtures are created inside the
  transaction and rolled back at the end. Tests do NOT depend on seeds.
- `auth.users` rows are inserted with the minimum required columns:
  `id, instance_id, aud, role, email, created_at, updated_at`. This satisfies
  the FK `public.users.id → auth.users(id)`.
- JWT claims are injected via `set_config('request.jwt.claims', ..., true)`.
  The claim map uses `user_kind` and `user_role` (not `role`, which is
  reserved by Supabase/PostgREST — DOC-31 N1).
- Between scenario switches, `set local role postgres` resets the session to
  bypass-RLS before re-setting to `authenticated`/`anon`.
- Service catalog skeletons (services → service_phases → service_plans) are
  minimal: only `id`, required NOT NULL columns, and `is_active=true`.
- `throws_ok(..., '42501', null, ...)` verifies SQLSTATE `42501`
  (`new row violates row-level security policy`).
