-- ============================================================
-- 0109_service_external_tools.sql
-- Servicio con "herramienta externa" (config-as-data) + sesiones de evaluación
-- por caso + runs por jobId (idempotencia consume/webhook/refund).
--
-- WHY. El servicio "Evaluación de Asilo" ($50, pago único) delega TODO el
-- trabajo del cliente a una herramienta externa (Juez) embebida por iframe:
-- el cliente sube documentos ALLÁ, Juez genera un PDF con IA y lo entrega a
-- x-legal por webhook firmado (HMAC, patrón DOC-70/abogados). Patrón GENÉRICO:
-- cualquier servicio puede activar una herramienta externa desde /admin/catalogo
-- (is_enabled + tool_key), NUNCA por slug del servicio (regla del proyecto,
-- ver 0106/0096).
--
--  1. service_external_tools — config por servicio (tool_key, base_url,
--     intentos por defecto, instrucciones i18n). Molde: service_deadline_policies.
--  2. case_evaluations — la sesión por caso: access_token opaco (molde
--     contracts.signing_token), intentos allowed/used, status, PDF entregado.
--  3. case_evaluation_runs — un registro por jobId de Juez. La UNIQUE
--     (evaluation_id, job_id) es la barrera de idempotencia de /consume y la
--     transición de estado del run ('consumed'→'failed') hace el refund
--     exactamente-una-vez.
--  4. Seed case_tab_role_access para el tab staff 'evaluacion' (patrón 0094:
--     cada pestaña nueva necesita su seed o nace oculta en orgs configuradas).
--
-- Escrituras de case_evaluations/runs: SOLO service_role (repos del módulo
-- evaluations). El cliente lee su sesión vía is_case_member; staff org-wide.
--
-- Depends on: 0002_catalog, 0004_cases, 0059_case_tab_role_access
-- ============================================================

-- 1 ── config por servicio ────────────────────────────────────────────────────
create table if not exists public.service_external_tools (
  service_id        uuid        primary key references public.services(id) on delete cascade,
  tool_key          text        not null default 'juez',
  is_enabled        boolean     not null default false,
  base_url          text        not null,
  default_attempts  integer     not null default 1 check (default_attempts >= 1),
  instructions_i18n jsonb       not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.service_external_tools is
  'Herramienta externa por servicio (config-as-data). is_enabled activa el tab/pantalla de evaluación; tool_key identifica la integración (v1: juez); base_url es el origin embebido en el iframe del cliente ({base_url}/xlegal?t={token}); default_attempts = intentos incluidos por pago; instructions_i18n = texto opcional mostrado sobre el iframe.';

drop trigger if exists trg_service_external_tools_updated_at on public.service_external_tools;
create trigger trg_service_external_tools_updated_at
  before update on public.service_external_tools
  for each row execute function public.set_updated_at();

alter table public.service_external_tools enable row level security;

-- RLS espejo de service_deadline_policies (0106): catalog editors siempre;
-- si no, sólo servicios activos (el workspace del caso la lee para gatear el tab).
create policy service_external_tools_select on public.service_external_tools
  for select to authenticated
  using (
    exists (
      select 1 from public.services s
       where s.id = service_id
         and s.org_id = (select public.auth_org_id())
         and (
           (select public.has_module('catalog', false))
           or (s.is_active and s.archived_at is null)
         )
    )
  );

create policy service_external_tools_insert on public.service_external_tools
  for insert to authenticated
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );

create policy service_external_tools_update on public.service_external_tools
  for update to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  )
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );

create policy service_external_tools_delete on public.service_external_tools
  for delete to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );

-- 2 ── sesión de evaluación por caso ──────────────────────────────────────────
create table if not exists public.case_evaluations (
  id               uuid        primary key default gen_random_uuid(),
  org_id           uuid        not null references public.orgs(id) on delete cascade,
  case_id          uuid        not null references public.cases(id) on delete cascade,
  tool_key         text        not null default 'juez',
  access_token     uuid        not null unique default gen_random_uuid(),
  attempts_allowed integer     not null default 1 check (attempts_allowed >= 0),
  attempts_used    integer     not null default 0 check (attempts_used >= 0),
  status           text        not null default 'pending'
                               check (status in ('pending','in_progress','delivered','failed')),
  last_job_id      text,
  pdf_storage_path text,
  report_meta      jsonb       not null default '{}'::jsonb,
  delivered_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (case_id, tool_key)
);
comment on table public.case_evaluations is
  'Sesión de herramienta externa por caso (1 por caso+tool, creación lazy al abrir la pantalla del cliente). access_token = credencial opaca del iframe (molde contracts.signing_token); attempts_used se incrementa en /consume (idempotente por jobId vía case_evaluation_runs) y se DEVUELVE en evaluation.failed; report_meta = {score, nivel, headline, lastError?} del resultado; pdf_storage_path apunta al bucket generated (evaluations/{caseId}/{jobId}.pdf).';

drop trigger if exists trg_case_evaluations_updated_at on public.case_evaluations;
create trigger trg_case_evaluations_updated_at
  before update on public.case_evaluations
  for each row execute function public.set_updated_at();

create index if not exists case_evaluations_case_idx on public.case_evaluations (case_id);
create index if not exists case_evaluations_org_status_idx
  on public.case_evaluations (org_id, status)
  where status = 'in_progress';           -- para el polling de reconciliación

alter table public.case_evaluations enable row level security;

-- Cliente: lee la sesión de SU caso (misma base RLS que el resto del caso).
-- Staff: lectura org-wide. Escrituras: SOLO service_role (sin policies de write).
create policy case_evaluations_select on public.case_evaluations
  for select to authenticated
  using (
    (select public.is_case_member(case_id))
    or ((select public.is_staff()) and org_id = (select public.auth_org_id()))
  );

-- 3 ── runs por jobId (idempotencia) ──────────────────────────────────────────
create table if not exists public.case_evaluation_runs (
  id               uuid        primary key default gen_random_uuid(),
  org_id           uuid        not null references public.orgs(id) on delete cascade,
  evaluation_id    uuid        not null references public.case_evaluations(id) on delete cascade,
  job_id           text        not null,
  status           text        not null default 'consumed'
                               check (status in ('consumed','completed','failed')),
  pdf_storage_path text,
  report_meta      jsonb       not null default '{}'::jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (evaluation_id, job_id)
);
comment on table public.case_evaluation_runs is
  'Un intento (run) de la herramienta externa, identificado por el jobId de Juez. UNIQUE (evaluation_id, job_id) = barrera de idempotencia de POST /consume; la transición consumed→failed ejecuta el refund del intento exactamente una vez; consumed→completed registra la entrega.';

drop trigger if exists trg_case_evaluation_runs_updated_at on public.case_evaluation_runs;
create trigger trg_case_evaluation_runs_updated_at
  before update on public.case_evaluation_runs
  for each row execute function public.set_updated_at();

create index if not exists case_evaluation_runs_evaluation_idx
  on public.case_evaluation_runs (evaluation_id);

alter table public.case_evaluation_runs enable row level security;

create policy case_evaluation_runs_select on public.case_evaluation_runs
  for select to authenticated
  using (
    exists (
      select 1 from public.case_evaluations e
       where e.id = evaluation_id
         and (
           (select public.is_case_member(e.case_id))
           or ((select public.is_staff()) and e.org_id = (select public.auth_org_id()))
         )
    )
  );

-- 4 ── Seed del tab staff 'evaluacion' (patrón 0094: cada tab nuevo necesita
-- su seed para orgs que ya configuraron la matriz, o nace oculto) ─────────────
insert into public.case_tab_role_access (org_id, role, tab_id, enabled)
select distinct org_id, role, 'evaluacion', true
  from public.case_tab_role_access
 where tab_id <> 'evaluacion'
   and role in ('admin', 'paralegal', 'sales')
on conflict (org_id, role, tab_id) do nothing;
