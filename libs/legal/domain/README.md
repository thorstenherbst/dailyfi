# legal/domain

Daten der Rechtstexte, ohne Angular.

- `PROVIDER`, `isPlaceholder`: Angaben zum Anbieter, die einzige Quelle für Impressum,
  Datenschutzerklärung und AV-Vertrag. Werte in `[[…]]` sind Platzhalter und werden auf den
  Seiten hervorgehoben.
- `DPA_VERSION`, `DPA_VERSION_DATE`: aktuelle Fassung des AV-Vertrags. Die Zustimmung im Konto
  hängt an der Version. `PRIVACY_POLICY_DATE`: Stand der Datenschutzerklärung.
  `formatLegalDate` schreibt die Daten aus.
- `SUBPROCESSORS`: Dienstleister, die Daten im Auftrag verarbeiten (Empfänger in der
  Datenschutzerklärung, Anlage 2 des AV-Vertrags).

Tags: `domain:legal`, `type:domain`. Genutzt von `legal/feature` und von `auth` (Zustimmung).
