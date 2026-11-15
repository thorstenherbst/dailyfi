# auth/domain

- `rememberInviteCode`, `readInviteCode`, `forgetInviteCode`: hält den Einladungscode von
  `/register` bis zum Rücksprung aus der Mail im `localStorage` (der Link öffnet meist in einem
  neuen Tab), zeitlich begrenzt auf die Gültigkeit des Magic Links.

Tags: `domain:auth`, `type:domain`. Genutzt von `auth/feature`.
