-- Beta-Zugang: Registrierung nur mit gueltigem Einladungscode.
-- Codes sind nie per API lesbar; geprueft wird ausschliesslich serverseitig ueber
-- redeem_invite_code(), damit niemand die Liste gueltiger Codes abziehen kann.

create table public.invite_codes (
  code text primary key check (length(code) between 6 and 40),
  note text,
  expires_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;
-- Bewusst keine Policy: ohne Policy kommt ueber die API niemand an die Tabelle.
-- Zugriff laeuft nur ueber die security-definer-Funktion unten.

create or replace function public.redeem_invite_code(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_rows int;
begin
  if v_user is null then
    raise exception 'Nicht angemeldet';
  end if;

  -- Bereits eingeloester Code desselben Nutzers: nichts zu tun (idempotent).
  if exists (select 1 from public.invite_codes where used_by = v_user) then
    return;
  end if;

  update public.invite_codes
     set used_by = v_user,
         used_at = now()
   where lower(code) = lower(trim(p_code))
     and used_by is null
     and (expires_at is null or expires_at > now());

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'Einladungscode ungueltig oder bereits verwendet';
  end if;
end;
$$;

revoke all on function public.redeem_invite_code(text) from public, anon;
grant execute on function public.redeem_invite_code(text) to authenticated;

-- Hat der angemeldete Nutzer Zugang? Treibt den Guard im Frontend.
create or replace function public.has_beta_access()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.invite_codes where used_by = auth.uid());
$$;

revoke all on function public.has_beta_access() from public, anon;
grant execute on function public.has_beta_access() to authenticated;
