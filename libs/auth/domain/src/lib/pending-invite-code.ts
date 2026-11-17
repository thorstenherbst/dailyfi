import { forgetPending, readPending, rememberPending } from './pending-value';

/**
 * Der Einladungscode von `/register` bis zum Ruecksprung aus der Mail.
 *
 * Eingeloest werden kann er erst mit Session — `redeem_invite_code()` haengt an
 * `auth.uid()`. Zwischen dem Absenden des Formulars und dem Klick auf den Link
 * liegt aber ein Seitenwechsel, und zwar fast immer in einen **neuen Tab**:
 * Mail-Programme und Webmail oeffnen Links so.
 *
 * Deshalb `localStorage` und nicht `sessionStorage`. `sessionStorage` gehoert
 * zu genau einem Tab; im Tab, den die Mail oeffnet, waere er leer, und der Code
 * waere im Regelfall verloren statt im Ausnahmefall. Der PKCE-Verifier von
 * supabase-js liegt aus demselben Grund im `localStorage`.
 *
 * Der Zeitstempel begrenzt, wie lange der Code dort liegt: laenger als der
 * Magic Link gilt, ist er ohnehin wertlos. Ein Einladungscode ist einmal
 * verwendbar und liegt beim Nutzer ohnehin im Postfach — aber er soll nicht
 * unbegrenzt auf einem fremden Rechner herumliegen.
 *
 * Geht er trotzdem verloren (anderer Browser, private Sitzung), ist das kein
 * Fehlerfall: `/register` fragt ihn dann mit bestehender Session erneut ab.
 */
const KEY = 'dailyfi.pending-invite-code';

/** Merkt den Code fuer die Adresse, an die der Bestaetigungslink geht. */
export function rememberInviteCode(code: string, email: string): void {
  rememberPending(KEY, code.trim(), email);
}

/**
 * Liest den Code fuer das angemeldete Konto, **ohne** ihn zu loeschen.
 * Geloescht wird erst, wenn klar ist, dass ein weiterer Versuch nichts mehr
 * bringt (`forgetInviteCode`) — sonst kostet eine Serverstoerung beim
 * Einloesen den Code. Gehoert er zu einer anderen Adresse, ist er weg.
 */
export function readInviteCode(email: string): string | null {
  return readPending(KEY, email);
}

export function forgetInviteCode(): void {
  forgetPending(KEY);
}
