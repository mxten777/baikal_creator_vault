-- STEP 8-K: public passport identity and publication state.
-- Base passport RLS remains owner-only; public reads use the Edge Function.
alter table public.passports
  add column public_id uuid not null default gen_random_uuid(),
  add column is_public boolean not null default false,
  add column published_at timestamptz;

alter table public.passports
  add constraint passports_public_id_unique unique (public_id);