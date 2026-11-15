# auth/data-access

Anmeldestatus und Routen-Guards.

- `SessionStore`: wer angemeldet ist und ob ein Einladungscode eingelöst ist; Magic Link
  anfordern, Code einlösen, Sitzung wiederherstellen. Dient der App auch als `SESSION_RECOVERY`.
- `authCallbackUrl`
- Guards: `requireAccount` (`/week`, `/projects`, `/reports`), `guestOnly` (`/login`),
  `inviteCodeOnly` (`/register`). Die Guards sind Bequemlichkeit, die Grenze liegt in RLS.

Tags: `domain:auth`, `type:data-access`. Genutzt von der App und `auth/feature`.
