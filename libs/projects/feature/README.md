# projects/feature

Seite `/projects`: Kunden und Projekte, direkt in der Zeile bearbeitet, Archivieren über das
Warn-Modal.

- `loadProjectsPage`: einziger Export, Lade-Funktion für die lazy Route in `app.routes.ts`.
- Intern: `ProjectsPage` (implementiert `canLeave` für `unsavedChangesGuard`) und
  `ProjectsEditor` (welche Zeile bearbeitet wird, geparkte Absichten, auf Basis von `EditSession`).

Tags: `domain:projects`, `type:feature`. Genutzt nur von der App.
