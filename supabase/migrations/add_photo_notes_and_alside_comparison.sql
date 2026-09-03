-- ================================================================
-- Migration: Photo notes + Alside comparison support
-- Run in Supabase Dashboard → SQL Editor
-- ================================================================

-- 1. Add notes column to quote_photos
ALTER TABLE public.quote_photos
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Add comparison_tiers column to quotes (stores Alside tier data as JSON)
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS comparison_tiers JSONB;

-- 3. Add Polar Board product (Odyssey Plus Siding — used as Polar Board tier)
--    Skip if already exists
INSERT INTO public.products (id, tenant_id, name, unit, price, mat, labor, margin, tax, cat, active, sort_order)
SELECT 'polarboard', '5249f9c0-9fca-46c8-896c-4e35be437024', 'Polar Board (Odyssey Plus Siding)', 'SQ', 578.19, 0, 0, 0, 'n', 'Siding', true, 5
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE id = 'polarboard');
