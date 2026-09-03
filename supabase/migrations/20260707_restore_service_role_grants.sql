-- Restore Supabase's default service_role access to the public schema.
-- Root cause of a 403 "Insufficient permissions" from the manage-tenant edge
-- function: service_role had lost its table privileges, so PostgREST raised
-- "permission denied for table users" and the role lookup returned empty.
-- Applied to project qcpofgrlyhngewspzasa on 2026-07-07.

GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Ensure future tables/sequences created in public are also accessible to service_role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
