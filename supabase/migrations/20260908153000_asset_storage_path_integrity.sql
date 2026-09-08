-- STEP 8-F integrity: assets.storage_path must reference this row's project and asset.
-- Path layout: {user_id}/{project_id}/{asset_id}/{filename}
-- Declarative CHECK only; no trigger/function. NULL (no file attached) stays allowed.

alter table public.assets
  add constraint assets_storage_path_same_project_check
  check (
    storage_path is null
    or (
      split_part(storage_path, '/', 2) = project_id::text
      and split_part(storage_path, '/', 3) = id::text
    )
  );
