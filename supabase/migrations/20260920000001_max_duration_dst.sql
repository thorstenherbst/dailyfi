-- Am Tag der Rueckstellung auf Winterzeit hat der Kalendertag
-- 25 Stunden. Ein Eintrag von 00:00 bis 24:00 am 25.10. dauert real 25 Stunden und
-- scheitert deshalb an der alten Grenze von 24 Stunden — obwohl die Eingabe voellig
-- in Ordnung ist.
--
-- Die Pruefung bleibt erhalten: Sie faengt weiterhin Eingaben ab, die nur durch
-- einen Fehler entstehen koennen (vertauschte Jahre, Tippfehler in der Zeitzone).
-- Sie wandert nur auf die groesste Laenge, die ein Kalendertag in Europe/Berlin
-- ueberhaupt haben kann.

alter table public.time_entries
  drop constraint time_entries_max_duration;

alter table public.time_entries
  add constraint time_entries_max_duration
  check (ended_at - started_at <= interval '25 hours');
