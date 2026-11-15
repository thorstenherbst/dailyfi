# week/feature

Seite `/week`: Wochenraster mit nicht-modalem Detail-Panel zum Anlegen und Bearbeiten.
Verbindet `WeekStore`, Raster (`week/ui`), Panel und Toasts.

- `loadWeekPage`: einziger Export, Lade-Funktion für die lazy Route in `app.routes.ts`.
- Intern: `WeekPage` (implementiert `canLeave` für `unsavedChangesGuard`) und `WeekPanel`
  (Panel-Zustand auf Basis von `EditSession`, parkt Absichten bei ungespeicherten Änderungen).

Tags: `domain:week`, `type:feature`. Genutzt nur von der App.
