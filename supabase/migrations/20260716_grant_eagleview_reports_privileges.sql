-- eagleview_reports was created via raw SQL migration, so the API roles never received table
-- grants and PostgREST returned 403 (permission denied) before RLS was evaluated.
-- Grant the API roles; the RLS policies still restrict which rows each tenant can see.
grant select, insert, update on public.eagleview_reports to authenticated;
grant all on public.eagleview_reports to service_role;
