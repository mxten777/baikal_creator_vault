-- STEP 9-8B: raise creator-assets bucket file_size_limit to 100MB (104857600 bytes)
-- to allow uncompressed WAV masters (id/name/public/MIME/RLS unchanged)
update storage.buckets
set file_size_limit = 104857600
where id = 'creator-assets';
