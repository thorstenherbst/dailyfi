# auth/feature

Seiten für die Anmeldung mit Apple, die Eingabe des Einladungscodes, die Zustimmung zum
AV-Vertrag und den Datenschlüssel (einrichten, entsperren).

- `loadLoginPage` (`/login`), `loadRegisterPage` (`/register`), `loadCallbackPage`
  (`/auth/callback`), `loadConsentPage` (`/zustimmung`, Zustimmung zum AV-Vertrag),
  `loadVaultSetupPage` (`/schluessel`), `loadUnlockPage` (`/entsperren`):
  Lade-Funktionen für die lazy Routen in `app.routes.ts`. Die Komponenten selbst werden nicht
  exportiert.

Tags: `domain:auth`, `type:feature`. Genutzt nur von der App.
