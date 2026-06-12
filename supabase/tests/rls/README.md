# RLS Test Suite — UsaLatinoPrime V2

pgTAP tests for Row Level Security policies defined in DOC-31.

## Files and DOC-31 §8.2 mapping

| File | DOC-31 §8.2 test # | What it asserts |
|------|-------------------|-----------------|
| `01_client_isolation.sql` | **1** | Client A cannot SELECT cases or case_documents of Client B |
| `02_deactivated_user.sql` | **10, 11** | JWT valid but `users.is_active=false` → `is_staff()` / `is_case_member()` return false → 0 rows |
| `03_staff_module_matrix.sql` | **12** | No module row → 0 rows + INSERT blocked; `can_view` → read only; `can_edit` → read+write; admin bypasses all |
| `04_anti_spoofing_write.sql` | **14** | Client cannot UPDATE cases; cannot INSERT case_documents/case_timeline with another user's UUID |
| `05_anon_total_block.sql` | **17** | `anon` role: 0 rows on all representative tables, INSERT raises 42501 |

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
