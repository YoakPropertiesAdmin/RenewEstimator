-- ============================================================
-- Fix quotes.status CHECK constraint to allow 'signed'
-- The complete-signing edge function was silently failing because
-- 'signed' was not in the allowed values for quotes.status.
--
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Drop the existing CHECK constraint on status (whatever it's named)
DO $$
DECLARE
  cname text;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.check_constraints cc
    ON tc.constraint_name = cc.constraint_name
  WHERE tc.table_name = 'quotes'
    AND tc.constraint_type = 'CHECK'
    AND cc.check_clause ILIKE '%status%'
    AND cc.check_clause NOT ILIKE '%signing_status%'
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.quotes DROP CONSTRAINT ' || quote_ident(cname);
    RAISE NOTICE 'Dropped constraint: %', cname;
  ELSE
    RAISE NOTICE 'No matching status constraint found (may already be removed)';
  END IF;
END $$;

-- 2. Add the corrected constraint that includes 'signed'
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_status_check
  CHECK (status IN ('draft', 'sent', 'signed', 'void'));

-- 3. Backfill ALL quotes that have a signed signing session but wrong status
--    This fixes every signed quote at once, not just one hardcoded ID.
UPDATE public.quotes q
SET
  status             = 'signed',
  signing_status     = 'signed',
  signing_session_id = ss.id,
  signed_at          = ss.signed_at
FROM public.signing_sessions ss
WHERE ss.quote_id  = q.id
  AND ss.status    = 'signed'
  AND ss.signed_at IS NOT NULL;

-- Verify all signed sessions and their linked quotes
SELECT
  q.quote_number,
  q.customer_name,
  q.status          AS quote_status,
  q.signing_status,
  ss.status         AS session_status,
  ss.signed_at,
  ss.token
FROM public.signing_sessions ss
JOIN public.quotes q ON q.id = ss.quote_id
WHERE ss.status = 'signed'
ORDER BY ss.signed_at DESC;
