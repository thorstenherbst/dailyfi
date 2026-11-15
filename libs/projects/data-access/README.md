# projects/data-access

Datenzugriff und Zustand der Projektverwaltung.

- `ProjectRepository`: einziger Ort, an dem die Projektverwaltung Supabase kennt. Gelöscht wird
  nichts, nur archiviert.
- `ProjectsStore`, `ClientGroup`: erst speichern, dann anzeigen (nicht optimistisch).

Tags: `domain:projects`, `type:data-access`. Genutzt von `projects/feature`.
