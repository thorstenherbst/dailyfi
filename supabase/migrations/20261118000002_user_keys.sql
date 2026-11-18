-- Verpackte Datenschluessel fuer die Ende-zu-Ende-Verschluesselung.
--
-- Der Datenschluessel eines Kontos entsteht im Browser und verlaesst ihn nie
-- im Klartext. Hier liegt er nur verpackt (AES-GCM), einmal je Passkey und
-- einmal mit dem Wiederherstellungsschluessel. Ohne das Geheimnis dahinter —
-- PRF-Ergebnis des Passkeys oder den Wiederherstellungsschluessel, beides nur
-- beim Nutzer — kann niemand, der die Datenbank liest, ihn auspacken.
--
-- Salt, IV und Credential-ID sind keine Geheimnisse; sie werden zum Auspacken
-- gebraucht und stehen deshalb neben dem verpackten Schluessel. Alle Bytes als
-- Base64 in `text`.

create table public.user_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('passkey', 'recovery')),
  -- Nur bei `passkey`: die ID des Credentials (Base64url), mit der WebAuthn
  -- genau diesen Passkey anfragt.
  credential_id text check (
    length(credential_id) between 22 and 1366 and credential_id ~ '^[A-Za-z0-9_-]+$'
  ),
  -- Exakte Laengen: 32 Bytes Salt, 12 Bytes IV, 32 Bytes Schluessel plus
  -- 16 Bytes Pruefsumme. Eine Zeile, die sich nie auspacken liesse, soll gar
  -- nicht erst gespeichert werden.
  salt text not null check (length(salt) = 44 and salt ~ '^[A-Za-z0-9+/]+=*$'),
  iv text not null check (length(iv) = 16 and iv ~ '^[A-Za-z0-9+/]+=*$'),
  wrapped_key text not null check (
    length(wrapped_key) = 64 and wrapped_key ~ '^[A-Za-z0-9+/]+=*$'
  ),
  created_at timestamptz not null default now(),
  check ((kind = 'passkey') = (credential_id is not null)),
  unique (user_id, credential_id)
);

-- Ein Wiederherstellungsschluessel je Konto. Dieser Index ist zugleich die
-- Sperre gegen einen zweiten Datenschluessel: das erste Einrichten speichert
-- Passkey- und Wiederherstellungszeile in einer Anweisung, ein zweites scheitert
-- hier als Ganzes. Jedes vollstaendige Einrichten muss deshalb beide Zeilen
-- zusammen schreiben.
create unique index user_keys_one_recovery on public.user_keys (user_id) where kind = 'recovery';

alter table public.user_keys enable row level security;

-- Lesen und anlegen, nur die eigenen, nur mit Beta-Zugang. Bewusst kein
-- update und kein delete: wer eine fremde Session in die Hand bekommt, soll
-- die Schluessel nicht austauschen oder loeschen und damit die Daten
-- unlesbar machen koennen.
create policy user_keys_select_own on public.user_keys
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_beta_access()));

create policy user_keys_insert_own on public.user_keys
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_beta_access()));

-- Supabase vergibt per Voreinstellung alle Rechte, auch TRUNCATE, das an RLS
-- vorbeigeht. Deshalb erst alles entziehen, dann genau Lesen und Anlegen geben.
revoke all on public.user_keys from anon, authenticated;
grant select, insert on public.user_keys to authenticated;
