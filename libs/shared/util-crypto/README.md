# shared/util-crypto

Verschlüsselung im Browser, mit WebCrypto. Ohne Abhängigkeit zu Supabase oder WebAuthn.

- `generateDataKey`, `deriveWrappingKey`, `wrapDataKey`, `unwrapDataKey`, `lockDown`: der
  Datenschlüssel eines Kontos (AES-256-GCM) und seine Verpackung mit einem per HKDF abgeleiteten
  Schlüssel — aus dem PRF-Ergebnis eines Passkeys oder aus dem Wiederherstellungsschlüssel.
- `generateRecoveryKey`, `formatRecoveryKey`, `parseRecoveryKey`: der Wiederherstellungsschlüssel,
  32 Zufallsbytes, geschrieben als 52 Zeichen Base32 in Vierergruppen.
- `DataKeyHolder`: der entsperrte Datenschlüssel, nur im Arbeitsspeicher und nicht exportierbar.
- `randomBytes`, `toBase64`/`fromBase64`, `toBase64Url`/`fromBase64Url`.

Tags: `domain:shared`, `type:util`. Genutzt von `auth/data-access` (Schlüssel einrichten und
entsperren) und den Repositories, die Inhalte verschlüsseln.
