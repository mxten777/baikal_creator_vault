-- STEP 8-C: core schema (projects, assets, creation_events, asset_relations, passports) + RLS

-- ---------------------------------------------------------
-- projects
-- ---------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_owner_id_idx on public.projects (owner_id);

-- ---------------------------------------------------------
-- assets
-- ---------------------------------------------------------
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  asset_type text not null check (char_length(asset_type) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assets_project_id_idx on public.assets (project_id);

-- ---------------------------------------------------------
-- creation_events
-- ---------------------------------------------------------
create table public.creation_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  event_type text not null check (char_length(event_type) between 1 and 100),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index creation_events_asset_id_idx on public.creation_events (asset_id);

-- ---------------------------------------------------------
-- asset_relations
-- ---------------------------------------------------------
create table public.asset_relations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  from_asset_id uuid not null references public.assets (id) on delete cascade,
  to_asset_id uuid not null references public.assets (id) on delete cascade,
  relation_type text not null check (char_length(relation_type) between 1 and 100),
  created_at timestamptz not null default now(),
  constraint asset_relations_no_self_relation check (from_asset_id <> to_asset_id),
  constraint asset_relations_unique unique (from_asset_id, to_asset_id, relation_type)
);

create index asset_relations_project_id_idx on public.asset_relations (project_id);
create index asset_relations_from_asset_id_idx on public.asset_relations (from_asset_id);
create index asset_relations_to_asset_id_idx on public.asset_relations (to_asset_id);

-- same-project integrity: from/to assets must belong to asset_relations.project_id
create function public.enforce_asset_relations_same_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  from_project_id uuid;
  to_project_id uuid;
begin
  select project_id into from_project_id from public.assets where id = new.from_asset_id;
  select project_id into to_project_id from public.assets where id = new.to_asset_id;

  if from_project_id is null or to_project_id is null then
    raise exception 'asset_relations: referenced asset does not exist';
  end if;

  if from_project_id <> new.project_id or to_project_id <> new.project_id then
    raise exception 'asset_relations: from_asset_id and to_asset_id must belong to the same project as project_id';
  end if;

  return new;
end;
$$;

create trigger asset_relations_same_project_trigger
  before insert or update on public.asset_relations
  for each row
  execute function public.enforce_asset_relations_same_project();

-- ---------------------------------------------------------
-- passports (one passport per asset)
-- ---------------------------------------------------------
create table public.passports (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null unique references public.assets (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- Row Level Security: owner-only access, no anon policies
-- =========================================================
alter table public.projects enable row level security;
alter table public.assets enable row level security;
alter table public.creation_events enable row level security;
alter table public.asset_relations enable row level security;
alter table public.passports enable row level security;

-- projects
create policy projects_select_owner on public.projects
  for select to authenticated
  using (owner_id = auth.uid());

create policy projects_insert_owner on public.projects
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy projects_update_owner on public.projects
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy projects_delete_owner on public.projects
  for delete to authenticated
  using (owner_id = auth.uid());

-- assets (owner via project)
create policy assets_select_owner on public.assets
  for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = assets.project_id and p.owner_id = auth.uid()
  ));

create policy assets_insert_owner on public.assets
  for insert to authenticated
  with check (exists (
    select 1 from public.projects p
    where p.id = assets.project_id and p.owner_id = auth.uid()
  ));

create policy assets_update_owner on public.assets
  for update to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = assets.project_id and p.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = assets.project_id and p.owner_id = auth.uid()
  ));

create policy assets_delete_owner on public.assets
  for delete to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = assets.project_id and p.owner_id = auth.uid()
  ));

-- creation_events (owner via asset -> project)
create policy creation_events_select_owner on public.creation_events
  for select to authenticated
  using (exists (
    select 1 from public.assets a
    join public.projects p on p.id = a.project_id
    where a.id = creation_events.asset_id and p.owner_id = auth.uid()
  ));

create policy creation_events_insert_owner on public.creation_events
  for insert to authenticated
  with check (exists (
    select 1 from public.assets a
    join public.projects p on p.id = a.project_id
    where a.id = creation_events.asset_id and p.owner_id = auth.uid()
  ));

create policy creation_events_update_owner on public.creation_events
  for update to authenticated
  using (exists (
    select 1 from public.assets a
    join public.projects p on p.id = a.project_id
    where a.id = creation_events.asset_id and p.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.assets a
    join public.projects p on p.id = a.project_id
    where a.id = creation_events.asset_id and p.owner_id = auth.uid()
  ));

create policy creation_events_delete_owner on public.creation_events
  for delete to authenticated
  using (exists (
    select 1 from public.assets a
    join public.projects p on p.id = a.project_id
    where a.id = creation_events.asset_id and p.owner_id = auth.uid()
  ));

-- asset_relations (owner via project_id)
create policy asset_relations_select_owner on public.asset_relations
  for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = asset_relations.project_id and p.owner_id = auth.uid()
  ));

create policy asset_relations_insert_owner on public.asset_relations
  for insert to authenticated
  with check (exists (
    select 1 from public.projects p
    where p.id = asset_relations.project_id and p.owner_id = auth.uid()
  ));

create policy asset_relations_update_owner on public.asset_relations
  for update to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = asset_relations.project_id and p.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = asset_relations.project_id and p.owner_id = auth.uid()
  ));

create policy asset_relations_delete_owner on public.asset_relations
  for delete to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = asset_relations.project_id and p.owner_id = auth.uid()
  ));

-- passports (owner via asset -> project)
create policy passports_select_owner on public.passports
  for select to authenticated
  using (exists (
    select 1 from public.assets a
    join public.projects p on p.id = a.project_id
    where a.id = passports.asset_id and p.owner_id = auth.uid()
  ));

create policy passports_insert_owner on public.passports
  for insert to authenticated
  with check (exists (
    select 1 from public.assets a
    join public.projects p on p.id = a.project_id
    where a.id = passports.asset_id and p.owner_id = auth.uid()
  ));

create policy passports_update_owner on public.passports
  for update to authenticated
  using (exists (
    select 1 from public.assets a
    join public.projects p on p.id = a.project_id
    where a.id = passports.asset_id and p.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.assets a
    join public.projects p on p.id = a.project_id
    where a.id = passports.asset_id and p.owner_id = auth.uid()
  ));

create policy passports_delete_owner on public.passports
  for delete to authenticated
  using (exists (
    select 1 from public.assets a
    join public.projects p on p.id = a.project_id
    where a.id = passports.asset_id and p.owner_id = auth.uid()
  ));
