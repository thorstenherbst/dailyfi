-- Lokale Entwicklungsdaten. Laeuft bei jedem `supabase db reset`.

-- Sprechende Codes nur hier: sie sind zu erraten und gehoeren deshalb
-- ausschliesslich in die lokale Entwicklung. Echte Codes macht die Datenbank
-- selbst — `insert into public.invite_codes (note) values ('Beta-Tester');`
-- liefert 100 Bit Zufall aus `new_invite_code()` (siehe Migration
-- 20260930000001_invite_hardening.sql).
insert into public.invite_codes (code, note)
values
  ('DAILYFI-DEV-1', 'lokale Entwicklung'),
  ('DAILYFI-DEV-2', 'lokale Entwicklung'),
  ('DAILYFI-BETA-1', 'lokale Entwicklung')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Demo-Konto fuer die lokale Entwicklung: dev@dailyfi.local
--
-- Ohne Passwort und ohne Anmeldeweg: Apple leitet nicht auf das lokale
-- Supabase zurueck. Das Konto existiert nur, damit nach einem `db:reset` Kunden
-- und Projekte fuer SQL-Abfragen und Studio da sind.
--
-- Es gibt hier bewusst keine Zugangsdaten mehr. `seed.sql` laeuft nie gegen
-- die Cloud, aber ein Passwort in einer eingecheckten Datei wandert erfahrungs-
-- gemaess irgendwann dorthin, wo es nicht hingehoert.
-- ---------------------------------------------------------------------------

-- Die leeren Token-Spalten sind Absicht: GoTrue liest sie als Go-String und
-- bricht mit "Database error querying schema" ab, wenn sie NULL sind. Das gilt
-- auch fuer `encrypted_password` — leer heisst hier "kein Passwort-Login".
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'dev@dailyfi.local',
  '',
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Dev"}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

-- Ohne Identity findet GoTrue den Nutzer zur Adresse nicht.
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"dev@dailyfi.local","email_verified":true,"phone_verified":false}'::jsonb,
  'email',
  now(),
  now(),
  now()
)
on conflict (id) do nothing;

-- Einladungscode gilt als eingeloest, sonst greift das Beta-Gate in den Policies.
-- DAILYFI-DEV-2 bleibt frei, um die Registrierung von Hand durchzuspielen.
update public.invite_codes
   set used_by = '11111111-1111-4111-8111-111111111111',
       used_at = now()
 where code = 'DAILYFI-DEV-1'
   and used_by is null;

-- Zwei Kunden mit je zwei Projekten, Farben aus der Projektpalette.
insert into public.clients (id, user_id, name)
values
  ('33333333-3333-4333-8333-000000000001', '11111111-1111-4111-8111-111111111111', 'Sandmann GmbH'),
  ('33333333-3333-4333-8333-000000000002', '11111111-1111-4111-8111-111111111111', 'Nordlicht Medien')
on conflict (id) do nothing;

insert into public.projects (id, user_id, client_id, name, color, hourly_rate)
values
  ('44444444-4444-4444-8444-000000000001', '11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-000000000001', 'Relaunch', '#A8412A', 95.00),
  ('44444444-4444-4444-8444-000000000002', '11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-000000000001', 'Wartung', '#3F6B4C', 110.00),
  ('44444444-4444-4444-8444-000000000003', '11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-000000000002', 'Beratung', '#414BA8', 140.00),
  ('44444444-4444-4444-8444-000000000004', '11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-000000000002', 'Schulung', '#8A5512', 120.00)
on conflict (id) do nothing;
