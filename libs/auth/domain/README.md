# auth/domain

- `rememberInviteCode`, `readInviteCode`, `forgetInviteCode`: hält den Einladungscode von
  `/register` bis zum Rücksprung aus der Mail im `localStorage` (der Link öffnet meist in einem
  neuen Tab), zeitlich begrenzt auf die Gültigkeit des Magic Links.
- `rememberDpaConsent`, `readDpaConsent`, `forgetDpaConsent`: dasselbe für die Version des
  AV-Vertrags, der auf `/register` zugestimmt wurde. Gespeichert wird sie auf `/auth/callback`.

Beide Werte sind an die Adresse gebunden, für die sie eingegeben wurden (`pending-value.ts`), und
werden für jede andere Adresse verworfen.

Tags: `domain:auth`, `type:domain`. Genutzt von `auth/feature`.
