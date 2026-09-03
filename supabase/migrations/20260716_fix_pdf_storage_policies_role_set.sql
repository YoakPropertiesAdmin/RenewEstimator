-- Fix — 2026-07-16
-- PDF uploads (PDF Library + template PDF attachments) failed with RLS 42501:
-- the template-pdfs storage policies required role = 'admin' exactly, but all admin
-- users are 'super_admin' (and platform_owner/director exist too). Broaden to the same
-- role set the pdf_library TABLE policy already uses. Also add a template-pdfs UPDATE
-- policy so x-upsert uploads work, and fix the same narrow-role bug on
-- contract-attachments delete.

drop policy if exists "template-pdfs: admin upload" on storage.objects;
create policy "template-pdfs: admin upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'template-pdfs'
    and private.get_my_role() = any (array['platform_owner','super_admin','admin','director'])
  );

drop policy if exists "template-pdfs: admin update" on storage.objects;
create policy "template-pdfs: admin update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'template-pdfs'
    and private.get_my_role() = any (array['platform_owner','super_admin','admin','director'])
  )
  with check (
    bucket_id = 'template-pdfs'
    and private.get_my_role() = any (array['platform_owner','super_admin','admin','director'])
  );

drop policy if exists "template-pdfs: admin delete" on storage.objects;
create policy "template-pdfs: admin delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'template-pdfs'
    and private.get_my_role() = any (array['platform_owner','super_admin','admin','director'])
  );

drop policy if exists "contract-attachments: admin delete" on storage.objects;
create policy "contract-attachments: admin delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'contract-attachments'
    and private.get_my_role() = any (array['platform_owner','super_admin','admin','director'])
  );
