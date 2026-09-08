-- STEP 8-F fix: the INSERT policy's EXISTS subquery resolved `name` to projects.name
-- (column precedence), producing storage.foldername(p.name) instead of
-- storage.foldername(objects.name). Qualify the object name explicitly.

drop policy creator_assets_insert_owner on storage.objects;

create policy creator_assets_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'creator-assets'
    and (storage.foldername(objects.name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.projects p
      where p.owner_id = auth.uid()
        and p.id::text = (storage.foldername(objects.name))[2]
    )
  );
