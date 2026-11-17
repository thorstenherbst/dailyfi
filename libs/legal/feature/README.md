# legal/feature

Die Rechtstexte als öffentliche Seiten, ohne Guard, abgemeldet wie angemeldet erreichbar.

- `loadImprintPage` (`/impressum`), `loadPrivacyPage` (`/datenschutz`), `loadDpaPage` (`/avv`):
  Lade-Funktionen für die lazy Routen in `app.routes.ts`. Die Komponenten selbst werden nicht
  exportiert.
- Alle Angaben zum Anbieter, die Fassungen und die Dienstleister kommen aus `legal/domain`.
  Platzhalter in `[[…]]` hebt `ProviderField` hervor.

Tags: `domain:legal`, `type:feature`. Genutzt nur von der App.
