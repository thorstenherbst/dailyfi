# auth/data-access

Anmeldestatus und Routen-Guards.

- `SessionStore`: wer angemeldet ist und ob ein Einladungscode eingelöst ist; Magic Link
  anfordern, Code einlösen, Sitzung wiederherstellen. Dient der App auch als `SESSION_RECOVERY`.
  Dazu die Zustimmung zum AV-Vertrag: `hasAcceptedDpa(version)`, `acceptDpa(version)`; Zusagen
  gelten für die Sitzung und werden beim Abmelden verworfen.
- `authCallbackUrl`
- Guards: `requireAccount` (`/week`, `/projects`, `/reports`, `/zustimmung`), dahinter
  `requireDpa` (`/week`, `/projects`, `/reports`; ohne Zustimmung zur aktuellen `DPA_VERSION` auf
  `/zustimmung?returnUrl=…`), `dpaPending` (`/zustimmung`), `guestOnly` (`/login`),
  `inviteCodeOnly` (`/register`). `safeReturnUrl` lässt nur Ziele innerhalb der App zu. Für
  Anmeldung und Einladungscode sind die Guards Bequemlichkeit, die Grenze liegt in RLS. Die
  Zustimmung prüft nur `requireDpa`, nicht die Datenbank.

Tags: `domain:auth`, `type:data-access`. Nutzt `legal/domain` (`DPA_VERSION`). Genutzt von der App
und `auth/feature`.
