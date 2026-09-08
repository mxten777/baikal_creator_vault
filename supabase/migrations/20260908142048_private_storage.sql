-- STEP 8-F: private asset storage
-- 1) assets.storage_path column (minimal; nullable because upload happens after asset INSERT)
-- 2) private bucket: creator-assets
-- 3) storage.objects RLS: owner-only via first path segment = auth.uid(), bucket-scoped
--    INSERT additionally requires the second path segment (project_id) to be an owned project.

-- ---------------------------------------------------------
-- assets.storage_path
-- ---------------------------------------------------------
alter table public.assets
  add column storage_path text;

-- ---------------------------------------------------------
-- private bucket
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('creator-assets', 'creator-assets', false, 52428800);

-- ---------------------------------------------------------
-- storage.objects policies (authenticated only; no anon policies)
-- object path layout: {user_id}/{project_id}/{asset_id}/{filename}
-- ---------------------------------------------------------

-- SELECT: owner only (first path segment must be the caller's user id)
create policy creator_assets_select_owner on storage.objects
  for select to authenticated
  using (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- INSERT: owner path + the project segment must reference a project owned by the caller
create policy creator_assets_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.projects p
      where p.owner_id = auth.uid()
        and p.id::text = (storage.foldername(name))[2]
    )
  );

-- DELETE: owner only
create policy creator_assets_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'creator-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
