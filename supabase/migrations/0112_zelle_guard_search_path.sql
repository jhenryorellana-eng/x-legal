-- =============================================================================
-- 0112_zelle_guard_search_path.sql
-- Pin search_path on the zelle append-only guard (Supabase advisor 0011).
-- The trigger function touches only NEW/OLD, so an empty search_path is safe.
-- Applied to PROD via MCP right after 0111 (2026-07-23).
-- =============================================================================

alter function public.zelle_inbound_emails_guard() set search_path = '';
