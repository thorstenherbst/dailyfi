-- Dailyfi: Grundschema
-- Kunde -> Projekt -> Zeiteintrag, jeweils streng pro Nutzer getrennt.
-- Tasks gibt es bewusst nicht: der Zeiteintrag hat ein Freitextfeld.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 120),
  -- Hex-Farbe fuer den Block im Wochenraster. Nie die einzige Information (WCAG).
  color text not null default '#4f46e5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  hourly_rate numeric(10, 2) check (hourly_rate is null or hourly_rate >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete restrict,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  description text not null default '' check (length(description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entries_ends_after_start check (ended_at > started_at),
  -- Ein Eintrag laenger als 24h ist immer ein Fehleingabe, nicht ein langer Arbeitstag.
  constraint time_entries_max_duration check (ended_at - started_at <= interval '24 hours')
);

-- Ein Projekt muss demselben Nutzer gehoeren wie sein Kunde bzw. sein Zeiteintrag.
-- Ohne diese Pruefung koennte ein manipulierter Insert fremde Datensaetze verknuepfen.
create or replace function public.assert_same_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_owner uuid;
begin
  if tg_table_name = 'projects' then
    select user_id into parent_owner from public.clients where id = new.client_id;
  else
    select user_id into parent_owner from public.projects where id = new.project_id;
  end if;

  if parent_owner is null or parent_owner <> new.user_id then
    raise exception 'Verknuepfter Datensatz gehoert einem anderen Nutzer';
  end if;

  return new;
end;
$$;

create trigger projects_same_owner
  before insert or update of client_id, user_id on public.projects
  for each row execute function public.assert_same_owner();

create trigger time_entries_same_owner
  before insert or update of project_id, user_id on public.time_entries
  for each row execute function public.assert_same_owner();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger time_entries_touch_updated_at
  before update on public.time_entries
  for each row execute function public.touch_updated_at();

-- Wochenansicht laedt immer einen Zeitraum eines Nutzers.
create index time_entries_user_started_idx on public.time_entries (user_id, started_at);
create index projects_user_idx on public.projects (user_id) where archived_at is null;
create index clients_user_idx on public.clients (user_id) where archived_at is null;
