/**
 * Angaben zum Anbieter fuer Impressum, Datenschutzerklaerung und AV-Vertrag.
 * Die drei Seiten lesen nur von hier.
 *
 * Solange ein Wert in doppelten eckigen Klammern steht, ist er ein Platzhalter:
 * die Seiten heben ihn sichtbar hervor (`isPlaceholder`). Echte Angaben
 * eintragen, und die Hervorhebung verschwindet von selbst. Optionale Angaben
 * (`company`, `phone`) als leere Zeichenkette lassen die Zeile weg.
 */
export interface Provider {
  readonly name: string;
  readonly company: string;
  readonly street: string;
  readonly city: string;
  readonly email: string;
  readonly phone: string;
  /** USt-IdNr. oder der Hinweis auf die Kleinunternehmerregelung (§ 19 UStG). */
  readonly vatId: string;
  /** Datenschutzaufsicht des Bundeslandes, in dem der Anbieter sitzt (§ 40 BDSG). */
  readonly supervisoryAuthority: string;
}

export const PROVIDER: Provider = {
  name: '[[Vorname Nachname]]',
  company: '[[Firmenname, falls vorhanden]]',
  street: '[[Straße Hausnummer]]',
  city: '[[PLZ Ort]]',
  email: '[[E-Mail]]',
  phone: '[[Telefon (optional)]]',
  vatId: '[[USt-IdNr. oder Hinweis Kleinunternehmer § 19 UStG]]',
  supervisoryAuthority: '[[zuständige Landesdatenschutzbehörde]]',
};

const PLACEHOLDER = /^\[\[.+\]\]$/;

/** `true` fuer eine noch nicht ausgefuellte Angabe wie `[[PLZ Ort]]`. */
export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value.trim());
}
