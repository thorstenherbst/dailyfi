# auth/data-access

Anmeldestatus und Routen-Guards.

- `SessionStore`: wer angemeldet ist und ob ein Einladungscode eingelöst ist; Anmeldung mit
  Apple starten und abschließen, Code einlösen, Sitzung wiederherstellen. Dient der App auch als `SESSION_RECOVERY`.
  Dazu die Zustimmung zum AV-Vertrag: `hasAcceptedDpa(version)`, `acceptDpa(version)`; Zusagen
  gelten für die Sitzung und werden beim Abmelden verworfen.
- `VaultStore`: Datenschlüssel einrichten in Schritten (`beginSetUp`, bei Safari
  `confirmPasskey`, `finishSetUp` speichert erst nach bestätigtem Wiederherstellungsschlüssel;
  eine Web Lock lässt nur einen Tab gleichzeitig einrichten), entsperren (`unlockWithPasskey`,
  `unlockWithRecoveryKey`), nach der Wiederherstellung einen neuen Passkey anlegen
  (`addPasskey`). `PasskeyClient` kapselt WebAuthn mit PRF.
- `authCallbackUrl`
- Guards: `requireAccount` (`/week`, `/projects`, `/reports`, `/zustimmung`), dahinter
  `requireDpa` (`/week`, `/projects`, `/reports`; ohne Zustimmung zur aktuellen `DPA_VERSION` auf
  `/zustimmung?returnUrl=…`), `dpaPending` (`/zustimmung`), `guestOnly` (`/login`),
  `inviteCodeOnly` (`/register`, nur angemeldet und noch nicht freigeschaltet), dahinter
  `requireUnlocked` (`/week`, `/projects`, `/reports`; sonst `/schluessel` oder
  `/entsperren?returnUrl=…`), `vaultMissing` (`/schluessel`), `vaultLocked` (`/entsperren`). `safeReturnUrl` lässt nur Ziele innerhalb der App zu. Für
  Anmeldung und Einladungscode sind die Guards Bequemlichkeit, die Grenze liegt in RLS. Die
  Zustimmung prüft nur `requireDpa`, nicht die Datenbank.

Tags: `domain:auth`, `type:data-access`. Nutzt `legal/domain` (`DPA_VERSION`) und
`shared/util-crypto`. Genutzt von der App
und `auth/feature`.
