-- Zustimmung zum Vertrag zur Auftragsverarbeitung (AV-Vertrag), je Konto und
-- Version. Eine Zeile ist der Nachweis des Vertragsschlusses: wer, welche
-- Fassung, wann. Die Fassung selbst steht im Frontend (`DPA_VERSION` in
-- `legal/domain`); eine neue Version heisst, alle werden erneut gefragt.
--
-- Geschrieben wird nur ueber accept_dpa(): der Zeitpunkt kommt vom Server, und
-- eine einmal erteilte Zustimmung laesst sich ueber die API weder aendern noch
-- loeschen. Mit dem Konto verschwindet sie (on delete cascade).

create table public.dpa_acceptances (
  user_id uuid not null references auth.users (id) on delete cascade,
  version text not null check (length(version) between 1 and 20),
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);

alter table public.dpa_acceptances enable row level security;

-- Nur lesen, nur die eigenen Zeilen. Bewusst keine Policy fuer insert, update
-- und delete: ohne Policy kommt ueber die API niemand schreibend heran.
create policy dpa_acceptances_select_own on public.dpa_acceptances
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.accept_dpa(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Nicht angemeldet';
  end if;

  -- Wie die Daten selbst: erst mit eingeloestem Einladungscode.
  if not public.has_beta_access() then
    raise exception 'Kein Beta-Zugang';
  end if;

  -- Zweimal zustimmen ist kein Fehler; es zaehlt der erste Zeitpunkt.
  insert into public.dpa_acceptances (user_id, version)
  values (v_user, trim(p_version))
  on conflict (user_id, version) do nothing;
end;
$$;

revoke all on function public.accept_dpa(text) from public, anon;
grant execute on function public.accept_dpa(text) to authenticated;
