-- Anmeldung nur noch mit Apple.
--
-- Eine Anmeldung ueber Apple kann keinen Einladungscode mitschicken: es gibt
-- kein Feld, das bis in `user_metadata` reicht. Der Hook laesst Apple-Konten
-- deshalb ohne Code entstehen. Freigeschaltet sind sie damit nicht —
-- `has_beta_access()` steckt in jeder RLS-Policy, und ohne eingeloesten Code
-- liefert jede Abfrage nichts. Den Code gibt das Konto nach der ersten
-- Anmeldung ein (`redeem_invite_code()`, mit Fehlversuchszaehler).
--
-- Jeder andere Weg braucht weiter einen gueltigen Code. Der E-Mail-Provider
-- ist in der Cloud abgeschaltet; sollte er wieder angehen, entsteht ueber ihn
-- trotzdem kein Konto ohne Code.

create or replace function public.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text := coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', '');
  v_code text := trim(coalesce(event -> 'user' -> 'user_metadata' ->> 'invite_code', ''));
begin
  if v_provider = 'apple' then
    return '{}'::jsonb;
  end if;

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

revoke all on function public.before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
