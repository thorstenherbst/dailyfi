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

/** So lange wie der Magic Link gilt. */
const MAX_AGE_MS = 60 * 60 * 1000;

interface Stored {
  readonly code: string;
  readonly savedAt: number;
}

/** `localStorage` kann werfen (private Sitzung, blockierte Speicherung). */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function rememberInviteCode(code: string): void {
  const entry: Stored = { code: code.trim(), savedAt: Date.now() };
  try {
    storage()?.setItem(KEY, JSON.stringify(entry));
  } catch {
    // Ohne Zwischenspeicher fragt /register den Code spaeter erneut ab.
  }
}

/**
 * Liest den Code, **ohne** ihn zu loeschen. Geloescht wird erst, wenn klar ist,
 * dass ein weiterer Versuch nichts mehr bringt (`forgetInviteCode`) — sonst
 * kostet eine Serverstoerung beim Einloesen den Code.
 */
export function readInviteCode(): string | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) {
      return null;
    }

    const entry = JSON.parse(raw) as Partial<Stored>;
    if (typeof entry.code !== 'string' || entry.code.length === 0) {
      forgetInviteCode();
      return null;
    }
    if (typeof entry.savedAt !== 'number' || Date.now() - entry.savedAt > MAX_AGE_MS) {
      forgetInviteCode();
      return null;
    }
    return entry.code;
  } catch {
    // Kaputter Inhalt ist kein Grund, die Registrierung abzubrechen.
    forgetInviteCode();
    return null;
  }
}

export function forgetInviteCode(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // nichts zu tun
  }
}
