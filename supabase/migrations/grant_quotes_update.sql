-- ================================================================
-- Allow authenticated users to UPDATE quotes (status changes, etc.)
-- Run in Supabase Dashboard → SQL Editor
-- ================================================================

GRANT UPDATE ON public.quotes TO authenticated;

DROP POLICY IF EXISTS "authenticated_update_quotes" ON public.quotes;
CREATE POLICY "authenticated_update_quotes"
  ON public.quotes
  FOR UPDATE TO authenticated
  USING (tenant_id = '5249f9c0-9fca-46c8-896c-4e35be437024')
  WITH CHECK (tenant_id = '5249f9c0-9fca-46c8-896c-4e35be437024');
