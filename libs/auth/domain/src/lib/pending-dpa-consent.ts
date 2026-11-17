import { forgetPending, readPending, rememberPending } from './pending-value';

/**
 * Die Zustimmung zum AV-Vertrag von `/register` bis zum Ruecksprung aus der
 * Mail. Gespeichert werden kann sie erst mit Session und eingeloestem Code
 * (`accept_dpa()` haengt an `auth.uid()`), also auf `/auth/callback`.
 *
 * Gemerkt wird die **Version**, der zugestimmt wurde, zusammen mit der
 * Adresse (siehe `pending-value.ts`): uebernommen wird sie nur fuer genau
 * dieses Konto, nie fuer jemanden, der sich danach auf demselben Rechner
 * anmeldet. Geht sie verloren oder
 * scheitert das Speichern, ist das kein Fehlerfall: der Guard `requireDpa`
 * schickt dann auf die Zustimmungsseite.
 */
const KEY = 'dailyfi.pending-dpa-consent';

/** Merkt die Version fuer die Adresse, an die der Bestaetigungslink geht. */
export function rememberDpaConsent(version: string, email: string): void {
  rememberPending(KEY, version, email);
}

/** Nur fuer dieselbe Adresse; eine fremde Zustimmung wird verworfen. */
export function readDpaConsent(email: string): string | null {
  return readPending(KEY, email);
}

export function forgetDpaConsent(): void {
  forgetPending(KEY);
}
