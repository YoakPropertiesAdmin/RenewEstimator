-- ================================================================
-- Grant read access for reports.html queries
-- Run in Supabase Dashboard → SQL Editor
-- ================================================================

-- 1. Grant SELECT on quotes to authenticated role
GRANT SELECT ON public.quotes TO authenticated;

-- 2. Grant SELECT on signing_sessions (for signed status)
GRANT SELECT ON public.signing_sessions TO authenticated;

-- 3. RLS policy: authenticated users can read all quotes for this tenant
DROP POLICY IF EXISTS "authenticated_read_quotes" ON public.quotes;
CREATE POLICY "authenticated_read_quotes"
  ON public.quotes
  FOR SELECT
  TO authenticated
  USING (tenant_id = '5249f9c0-9fca-46c8-896c-4e35be437024');

-- 4. RLS policy: authenticated users can read signing sessions
DROP POLICY IF EXISTS "authenticated_read_signing_sessions" ON public.signing_sessions;
CREATE POLICY "authenticated_read_signing_sessions"
  ON public.signing_sessions
  FOR SELECT
  TO authenticated
  USING (tenant_id = '5249f9c0-9fca-46c8-896c-4e35be437024');

-- 5. Make sure RLS is enabled on both tables
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signing_sessions ENABLE ROW LEVEL SECURITY;
