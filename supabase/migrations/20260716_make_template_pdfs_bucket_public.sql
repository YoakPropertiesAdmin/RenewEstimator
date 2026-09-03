-- Fix — 2026-07-16
-- Uploaded template/library PDFs stored a /object/public/ URL but template-pdfs was a
-- PRIVATE bucket → "Bucket not found" (404) when viewing. Make the bucket public
-- (non-sensitive docs: T&Cs, warranty certs, intro letters) so the stored public URLs
-- resolve and the anonymous customer signing page can load attached PDFs.
-- Drop the broad authenticated listing policy so the public bucket does not permit
-- file listing (object access via public URL doesn't need it; the app lists PDFs from
-- the pdf_library table, not storage.list()).

update storage.buckets set public = true where id = 'template-pdfs';

drop policy if exists "template-pdfs: authenticated read" on storage.objects;
