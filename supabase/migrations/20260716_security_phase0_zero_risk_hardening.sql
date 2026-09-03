-- Security hardening (Phase 0) — 2026-07-16
-- Clears: wrappers_fdw_stats RLS error, wrappers extension-in-public,
--         6 function search_path warnings, 2 trigger-function RPC exposures.

-- J1: drop unused Wrappers FDW extension (no foreign servers/tables; drops wrappers_fdw_stats)
drop extension if exists wrappers;

-- J2: pin search_path on functions flagged as role-mutable
alter function public._update_signing_session_ts()      set search_path = public, pg_temp;
alter function public.expire_signing_sessions()         set search_path = public, pg_temp;
alter function public.set_updated_at()                  set search_path = public, pg_temp;
alter function public.update_change_orders_updated_at() set search_path = public, pg_temp;
alter function public.next_quote_number()               set search_path = public, pg_temp;
alter function public.handle_new_user()                 set search_path = public, pg_temp;

-- J3a: trigger functions must not be callable via the REST RPC surface (triggers still fire)
revoke execute on function public.handle_new_user()      from public, anon, authenticated;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
