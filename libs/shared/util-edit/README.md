# shared/util-edit

Domänenneutraler Kern für „ungespeicherte Änderungen", gemeinsam für das Detail-Panel (`/week`) und
die Inline-Zeilen (`/projects`). Hängt nur an `@angular/core`, `@angular/common` und
`@angular/router`.

- `EditSession`: Getipptes feldweise über einer gespeicherten Quelle, Konflikte, geparkte
  Absichten. Kennt weder DOM noch Store.
- `unsavedChangesGuard` (`canDeactivate`) mit `LeavesWithUnsavedCheck`
- `RouteLeave` und `LeaveIntent`: eine abgebrochene Navigation nach „Speichern" oder „Verwerfen"
  nachholen, bei Zurück/Vor über `history.go`
- `LEAVE_WITHOUT_ASKING`: Token der App für Ziele ohne Rückfrage (Anmeldeseiten)

**Achtung:** `RouteLeave` liest die Verlaufsposition aus der privaten Router-API `ɵrouterPageId` in
`history.state`. Das setzt `withRouterConfig({ canceledNavigationResolution: 'computed' })` voraus
(`app.config.ts`). Fällt der Schlüssel in einer Angular-Version weg, wird nach „Verwerfen" normal
navigiert, mit einem Verlaufseintrag zu viel. `route-leave.spec.ts` schlägt dann fehl.

Tags: `domain:shared`, `type:util`. Genutzt von der App, `week/feature` und `projects/feature`.
