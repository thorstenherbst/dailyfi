# auth/ui

- `AuthCard` (`app-auth-card`): schmale zentrierte Karte mit Wortmarke, trägt die `h1` der
  Auth-Seiten. Darunter stehen die Links zu den Rechtstexten (`LegalLinks` aus `shared/ui`).
- `DpaConsent` (`app-dpa-consent`): Pflicht-Checkbox für den AV-Vertrag mit Version und Datum aus
  `legal/domain`, Fehlertext am Feld. Genutzt auf `/register` und `/zustimmung`.

Tags: `domain:auth`, `type:ui`. Genutzt von `auth/feature`.
