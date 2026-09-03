-- Security hardening (Phase 1) — 2026-07-16
-- property-photos is a public bucket; getPublicUrl() needs no SELECT policy.
-- The app only uploads / getPublicUrl / remove (never storage.list), so the
-- broad listing policy is removed to close cross-tenant file enumeration.
-- (First restricted to authenticated, then dropped entirely once UI use was verified.)

drop policy if exists "property_photos_select" on storage.objects;
