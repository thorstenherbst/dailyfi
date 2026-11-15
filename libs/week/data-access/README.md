# week/data-access

Datenzugriff und Zustand der Wochenansicht.

- `TimeEntryRepository`: einziger Ort, an dem die Woche Supabase kennt (Einträge der Woche,
  Projekte für die Auswahl ohne Archiviertes).
- `WeekStore`: optimistisch. Jede Änderung geht sofort ins UI, scheitert der Aufruf, wird genau
  dieser Eintrag zurückgerollt und über `USER_FEEDBACK` gemeldet.

Tags: `domain:week`, `type:data-access`. Genutzt von `week/feature`.
