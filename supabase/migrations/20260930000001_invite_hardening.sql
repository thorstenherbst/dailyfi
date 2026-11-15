-- Die Zusage „Registrierung nur mit gueltigem Einladungscode" wirklich
-- einloesen.
--
-- Bisher entstand das Konto, bevor irgendjemand den Code angesehen hatte: der
-- Code laesst sich erst mit Session einloesen, und die gibt es erst nach der
-- Anmeldung. Der Datenzugang war dicht (RLS plus Beta-Gate), das Konto nicht —
-- jede erfundene Adresse bekam eine Dailyfi-Mail und eine Zeile in `profiles`.
--
-- Drei Teile, die nur zusammen tragen:
--   1. Zufallscodes — ohne sie wird Raten durch Teil 2 bequemer statt schwerer.
--   2. Ein Hook vor der Kontoanlage, der den Code prueft.
--   3. Ein Fehlversuchszaehler fuer den angemeldeten Weg.

-- 1. Zufallscodes ------------------------------------------------------------
-- `DAILYFI-DEV-1` ist zu erraten. 20 Zeichen aus 32 sind 100 Bit; damit ist
-- Raten auch ohne jede Bremse aussichtslos.
--
-- Alphabet ohne I, L, O und U: die ersten drei verwechselt man mit 1 und 0, das
-- U faellt weg, damit aus Zufall kein Wort entsteht, das niemand vorlesen mag.

create or replace function public.new_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  bytes bytea := extensions.gen_random_bytes(20);
  result text := '';
  i int;
begin
  -- 256 ist durch 32 teilbar, die Verteilung bleibt also gleichmaessig.
  for i in 0..19 loop
    result := result || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
    if i in (4, 9, 14) then
      result := result || '-';
    end if;
  end loop;
  return 'DF-' || result;
end;
$$;

revoke all on function public.new_invite_code() from public, anon, authenticated;

-- Damit reicht dem Betreiber `insert into invite_codes (note) values ('…')
-- returning code;` — niemand muss sich selbst einen Code ausdenken.
alter table public.invite_codes alter column code set default public.new_invite_code();

-- 2. Kein Konto ohne gueltigen Code ------------------------------------------
-- GoTrue ruft diese Funktion vor dem Anlegen eines Nutzers. Der Code reist als
-- `user.user_metadata.invite_code` mit (siehe `core/session.ts`) — das ist die
-- Form im Hook-Ereignis; in der Tabelle heisst dasselbe Feld spaeter
-- `raw_user_meta_data`. Nachgemessen, nicht geraten.
--
-- Das Ereignis traegt ausserdem `metadata.ip_address`. Damit liesse sich hier
-- auch pro Adresse zaehlen — bei 100-Bit-Codes ist das nicht noetig, und
-- GoTrue bremst `/otp` ohnehin mit 30 Anfragen je 5 Minuten und IP.
--
-- Die Funktion loest den Code NICHT ein: bis zur Bestaetigung per Magic Link
-- kann viel passieren, und ein Code, der an einer nie geoeffneten Mail haengt,
-- waere unwiederbringlich verbrannt. Eingeloest wird weiter nach dem
-- Ruecksprung, ueber `redeem_invite_code()`.

create or replace function public.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := trim(coalesce(event -> 'user' -> 'user_metadata' ->> 'invite_code', ''));
begin
  if v_code = '' or not exists (
    select 1
      from public.invite_codes
     where lower(code) = lower(v_code)
       and used_by is null
       and (expires_at is null or expires_at > now())
  ) then
    -- Ein Wortlaut fuer beide Faelle: ob ein Code existiert, aber vergeben ist,
    -- geht niemanden etwas an.
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 403,
        'message', 'Einladungscode ungueltig oder bereits verwendet.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

-- Nur GoTrue ruft das auf. Waere die Funktion fuer `anon` oder `authenticated`
-- freigegeben, waere sie genau die anonyme Code-Pruefung, die wir vermeiden.
revoke all on function public.before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;

-- 3. Fehlversuche des angemeldeten Weges zaehlen -----------------------------
-- Greift fuer den Fall, dass jemand mit gueltigem Code ein Konto hat und
-- anschliessend weitere Codes durchprobiert.

create table public.invite_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  failures int not null default 0,
  last_failure_at timestamptz,
  locked_until timestamptz
);

alter table public.invite_attempts enable row level security;
-- Bewusst keine Policy: erreichbar nur ueber redeem_invite_code() unten.

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
  v_failures int;
begin
  if v_user is null then
    raise exception 'Nicht angemeldet';
  end if;

  -- Wer schon freigeschaltet ist, kann keine Versuche verbrennen.
  if exists (select 1 from public.invite_codes where used_by = v_user) then
    return 'already_redeemed';
  end if;

  if exists (
    select 1 from public.invite_attempts
     where user_id = v_user
       and locked_until > now()
  ) then
    return 'locked';
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
    insert into public.invite_attempts as a (user_id, failures, last_failure_at)
    values (v_user, 1, now())
    on conflict (user_id) do update
      set failures = a.failures + 1,
          last_failure_at = now()
    returning a.failures into v_failures;

    if v_failures >= 5 then
      update public.invite_attempts
         set locked_until = now() + interval '15 minutes',
             failures = 0
       where user_id = v_user;
      return 'locked';
    end if;

    return 'invalid';
  end if;

  update public.invite_codes
     set used_by = v_user,
         used_at = now()
   where code = v_code;

  delete from public.invite_attempts where user_id = v_user;

  return 'redeemed';
end;
$$;

revoke all on function public.redeem_invite_code(text) from public, anon;
grant execute on function public.redeem_invite_code(text) to authenticated;
