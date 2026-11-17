# auth/feature

Seiten für Anmeldung und Registrierung per Magic Link sowie die Zustimmung zum AV-Vertrag.

- `loadLoginPage` (`/login`), `loadRegisterPage` (`/register`), `loadCallbackPage`
  (`/auth/callback`), `loadConsentPage` (`/zustimmung`, Zustimmung zum AV-Vertrag):
  Lade-Funktionen für die lazy Routen in `app.routes.ts`. Die Komponenten selbst werden nicht
  exportiert.

Tags: `domain:auth`, `type:feature`. Genutzt nur von der App.
