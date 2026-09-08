-- STEP 8-I: Passport is a creator declaration layer, not a provenance cache.
-- Invariant: every asset has exactly one passport (data defaults to '{}').

-- ---------------------------------------------------------
-- backfill: existing assets without a passport get an empty one.
-- Existing passports are never overwritten (NOT EXISTS guard only).
-- ---------------------------------------------------------
insert into public.passports (asset_id, data)
select a.id, '{}'::jsonb
from public.assets a
where not exists (
  select 1 from public.passports p where p.asset_id = a.id
);

-- ---------------------------------------------------------
-- auto-create: every new asset gets an empty passport.
-- ---------------------------------------------------------
create function public.create_passport_for_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.passports (asset_id, data) values (new.id, '{}'::jsonb);
  return new;
end;
$$;

create trigger assets_create_passport_trigger
  after insert on public.assets
  for each row
  execute function public.create_passport_for_asset();

-- ---------------------------------------------------------
-- updated_at: kept in sync on every passport update.
-- ---------------------------------------------------------
create function public.set_passport_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger passports_set_updated_at_trigger
  before update on public.passports
  for each row
  execute function public.set_passport_updated_at();
