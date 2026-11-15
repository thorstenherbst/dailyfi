-- Der Einladungscode war nur ein Frontend-Guard. Jeder konnte sich per
-- E-Mail/Passwort registrieren und ohne Code Daten anlegen. Zugang gehoert in die
-- Policies, nicht ins Frontend.

-- 1. Beta-Zugang als Bedingung in jede Policy ------------------------------

drop policy clients_all_own on public.clients;
drop policy projects_all_own on public.projects;
drop policy time_entries_all_own on public.time_entries;

create policy clients_all_own on public.clients
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_beta_access()))
  with check (user_id = (select auth.uid()) and (select public.has_beta_access()));

create policy projects_all_own on public.projects
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_beta_access()))
  with check (user_id = (select auth.uid()) and (select public.has_beta_access()));

create policy time_entries_all_own on public.time_entries
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.has_beta_access()))
  with check (user_id = (select auth.uid()) and (select public.has_beta_access()));

-- profiles bleibt lesbar ohne Code, sonst kaeme niemand bis zur Einloeseseite.
drop policy profiles_insert_own on public.profiles;
drop policy profiles_update_own on public.profiles;

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()) and (select public.has_beta_access()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and (select public.has_beta_access()));

-- 2. Einloesen meldet ehrlich, was passiert ist -----------------------------
-- Vorher: "schon eingeloest" wurde als Erfolg fuer jeden beliebigen Code gemeldet,
-- und ein Aufruf konnte mehrere Codes verbrennen, die sich nur in der Gross-
-- schreibung unterscheiden.

drop function if exists public.redeem_invite_code(text);

create function public.redeem_invite_code(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
begin
  if v_user is null then
    raise exception 'Nicht angemeldet';
  end if;

  if exists (select 1 from public.invite_codes where used_by = v_user) then
    return 'already_redeemed';
  end if;

  -- Genau eine Zeile sperren, auch wenn zwei Codes sich nur in der Schreibweise
  -- unterscheiden.
  select code into v_code
    from public.invite_codes
   where lower(code) = lower(trim(p_code))
     and used_by is null
     and (expires_at is null or expires_at > now())
   order by created_at
   limit 1
     for update skip locked;

  if v_code is null then
    return 'invalid';
  end if;

  update public.invite_codes
     set used_by = v_user,
         used_at = now()
   where code = v_code;

  return 'redeemed';
end;
$$;

revoke all on function public.redeem_invite_code(text) from public, anon;
grant execute on function public.redeem_invite_code(text) to authenticated;

-- 3. search_path haerten und ueberfluessige Rechte entziehen ----------------

create or replace function public.has_beta_access()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (select 1 from public.invite_codes where used_by = auth.uid());
$$;

revoke all on function public.has_beta_access() from public, anon;
grant execute on function public.has_beta_access() to authenticated;

create or replace function public.assert_same_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.assert_same_owner() from public, anon;
revoke all on function public.handle_new_user() from public, anon;
revoke all on function public.touch_updated_at() from public, anon;

-- 4. Bequemlichkeit und Performance ----------------------------------------
-- Ohne Default liefert ein vergessenes user_id ein irrefuehrendes RLS-Fehlerbild.

alter table public.clients alter column user_id set default auth.uid();
alter table public.projects alter column user_id set default auth.uid();
alter table public.time_entries alter column user_id set default auth.uid();

create index projects_client_idx on public.projects (client_id);
create index time_entries_project_idx on public.time_entries (project_id);
create index invite_codes_used_by_idx on public.invite_codes (used_by);
