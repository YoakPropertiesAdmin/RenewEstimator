-- Security hardening (Phase 2) — 2026-07-16
-- Move RLS helper functions out of the API-exposed public schema so PostgREST
-- stops exposing them as /rest/v1/rpc endpoints. Same function OID, so all
-- ~24 tenant-isolation policies keep resolving; EXECUTE is retained so RLS
-- still evaluates. Also clears their remaining search_path warnings.
-- Verified safe via a transaction test querying quotes/tenants as the
-- authenticated role before applying.

create schema if not exists private;

alter function public.get_my_role()      set schema private;
alter function public.get_my_tenant_id() set schema private;

alter function private.get_my_role()      set search_path = public, pg_temp;
alter function private.get_my_tenant_id() set search_path = public, pg_temp;
