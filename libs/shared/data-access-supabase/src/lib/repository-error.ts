import { InjectionToken, inject } from '@angular/core';

import { SUPABASE_CONFIG } from './supabase-config';

/**
 * Warum ein Datenzugriff gescheitert ist — grob genug, dass ein Store daraus
 * einen deutschen Satz machen kann, ohne Postgres- oder Supabase-Wortlaut zu
 * zeigen.
 */
export type RepositoryErrorCode =
  | 'offline' // Netz weg, Server nicht erreichbar
  | 'session-expired' // JWT abgelaufen oder ungueltig: die Anmeldung gilt nicht mehr
  | 'unauthorized' // angemeldet, aber RLS verweigert
  | 'invalid-range' // Ende vor Beginn, laenger als erlaubt
  | 'invalid-value' // Pruefbedingung verletzt (Name leer, Farbe kein Hex, Satz negativ)
  | 'in-use' // wird noch verwendet, `on delete restrict` greift
  | 'not-found' // Datensatz existiert nicht mehr
  | 'unknown';

/**
 * Fehler des Datenzugriffs mit einem Code statt eines Textes. Der Wortlaut der
 * Datenbank bleibt in `technicalMessage` und gehoert in die Konsole, nicht in
 * die Oberflaeche: „violates check constraint" hilft einem Freelancer nicht,
 * und bei den Auth-Meldungen kaeme dazu, dass sie preisgeben, was der Server
 * ueber ein Konto weiss.
 */
export class RepositoryError extends Error {
  constructor(
    readonly code: RepositoryErrorCode,
    readonly technicalMessage: string,
  ) {
    super(`${code}: ${technicalMessage}`);
    this.name = 'RepositoryError';
  }
}

export interface SupabaseErrorShape {
  readonly message: string;
  readonly code?: string;
  readonly details?: string | null;
}

export function classify(error: SupabaseErrorShape): RepositoryErrorCode {
  // Nur Code und Meldung, nie `details`: dort steht bei 23502/23514
  // „Failing row contains (… Beschreibung …)", also Nutzertext. Eine
  // Beschreibung „JWT-Rollout" darf keine Sitzung beenden und „foreign key"
  // keinen Eintrag sperren.
  const head = `${error.code ?? ''} ${error.message}`.toLowerCase();
  // Eine Postgres-Meldung (fuenfstelliger SQLSTATE wie 22P02) zitiert gern den
  // abgelehnten Wert: `invalid input syntax for type uuid: "…jwt…"`. Das Wort
  // „jwt" in der Meldung zaehlt deshalb nur ohne SQLSTATE (Gateway, PostgREST).
  const sqlState = /^[0-9A-Z]{5}$/.test(error.code ?? '');

  if (
    head.includes('failed to fetch') ||
    head.includes('networkerror') ||
    head.includes('load failed')
  ) {
    return 'offline';
  }
  if (
    head.includes('ends_after_start') ||
    head.includes('max_duration') ||
    head.includes('23514') // check_violation
  ) {
    // Die Zeitspanne ist der haeufigste Fall dieser Verletzung und hat einen
    // eigenen Satz; alles andere faellt unten auf 'invalid-value'.
    return head.includes('time_entries') || head.includes('ends_after_start')
      ? 'invalid-range'
      : 'invalid-value';
  }
  // PostgREST meldet ein abgelaufenes oder unbrauchbares Token mit PGRST301
  // („JWT expired") bzw. PGRST302/303 (fehlendes Token, Claims ungueltig). Das
  // Gateway davor antwortet ohne Code mit „Invalid JWT". Das ist eindeutig: die
  // Anmeldung gilt nicht mehr. Ein RLS-Verbot (42501) heisst dagegen nur „das
  // darfst du nicht" und bleibt `unauthorized`.
  if (
    head.includes('pgrst301') ||
    head.includes('pgrst302') ||
    head.includes('pgrst303') ||
    (!sqlState && head.includes('jwt'))
  ) {
    return 'session-expired';
  }
  if (
    head.includes('42501') ||
    head.includes('row-level security') ||
    head.includes('permission denied')
  ) {
    return 'unauthorized';
  }
  // Fremdschluessel mit `on delete restrict`: Kunde hat noch Projekte, Projekt
  // hat noch Zeiteintraege.
  if (head.includes('23503') || head.includes('foreign key')) {
    return 'in-use';
  }
  if (head.includes('pgrst116') || head.includes('no rows')) {
    return 'not-found';
  }
  return 'unknown';
}

/**
 * Wer wissen muss, dass ein Datenzugriff gescheitert ist, ohne selbst einer zu
 * sein — heute nur `SessionStore`, der an `session-expired` das
 * „Sitzung abgelaufen"-Modal haengt. Die Repositories rufen `fail()` ausserhalb
 * jedes Injection-Kontexts auf, deshalb ein schlichtes Register statt DI.
 */
export type RepositoryErrorListener = (error: RepositoryError) => void;

const listeners = new Set<RepositoryErrorListener>();

/** Meldet sich an; der Rueckgabewert meldet wieder ab (`DestroyRef.onDestroy`). */
export function onRepositoryError(listener: RepositoryErrorListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Ist das ein Fehler, nach dem nicht mehr sicher ist, was der Server hat? Nein,
 * wenn der Server den Inhalt nur abgelehnt hat (Pruefbedingung, Fremdschluessel,
 * Datensatz weg): dann ist nach dem Zurueckrollen alles wieder gleich. Ja bei
 * Netz, Anmeldung und allem Unbekannten — das zeigt die Statusleiste als Fehler.
 */
export function isSyncFailure(error: unknown): boolean {
  if (!(error instanceof RepositoryError)) {
    return true;
  }
  return !['invalid-range', 'invalid-value', 'in-use', 'not-found'].includes(error.code);
}

/**
 * Wie ausfuehrlich `fail()` in die Konsole schreibt. `fail()` laeuft ausserhalb
 * jedes Injection-Kontexts; den Schalter setzt `injectGuarded()` aus
 * `SUPABASE_CONFIG.production` — so wie `logAuthIssue` in `SessionStore`.
 *
 * Voreinstellung ist knapp: ohne Konfiguration lieber zu wenig als zu viel.
 */
let verboseLogging = false;

/** Nur fuer `injectGuarded()` und Tests. */
export function setVerboseRepositoryLogging(verbose: boolean): void {
  verboseLogging = verbose;
}

/**
 * In Production steht nur Klasse und Code in der Konsole. `message`, `details`
 * und `hint` von PostgREST enthalten bei Pruefbedingungen die ganze Zeile —
 * `user_id`, IDs, Zeiten, Beschreibung —, und die gehoert nicht in die Konsole
 * eines fremden Rechners.
 */
function logFailure(code: RepositoryErrorCode, shape: SupabaseErrorShape, raw: unknown): void {
  if (verboseLogging) {
    console.error('[Dailyfi] Datenzugriff fehlgeschlagen:', raw);
    return;
  }
  const suffix = shape.code ? ` (${shape.code})` : '';
  console.error(`[Dailyfi] Datenzugriff fehlgeschlagen: ${code}${suffix}`);
}

/** Jeder Fehlerweg eines Repositories laeuft hier durch — inklusive Netzfehler. */
export function fail(error: unknown): never {
  const shape: SupabaseErrorShape =
    error instanceof Error
      ? { message: error.message }
      : ((error as SupabaseErrorShape | null) ?? { message: 'Unbekannter Fehler' });
  const repositoryError = new RepositoryError(classify(shape), shape.message);
  logFailure(repositoryError.code, shape, error);
  for (const listener of listeners) {
    // Ein werfender Zuhoerer darf weder die anderen stummschalten noch den
    // RepositoryError ersetzen, mit dem der Store rechnet.
    try {
      listener(repositoryError);
    } catch (listenerError) {
      if (verboseLogging) {
        console.error(
          '[Dailyfi] Fehler in einem Zuhoerer fuer Datenzugriffsfehler:',
          listenerError,
        );
      }
    }
  }
  throw repositoryError;
}

function toRepositoryError(error: unknown): RepositoryError {
  if (error instanceof RepositoryError) {
    return error;
  }
  try {
    return fail(error);
  } catch (converted) {
    return converted as RepositoryError;
  }
}

/**
 * Was ein Versuch, die Sitzung nach einem abgelehnten Token zu retten, ergeben
 * hat:
 * - `refreshed`: neues Token da — der Zugriff darf einmal wiederholt werden;
 * - `offline`: der Refresh kam nicht durch (Netz), die Sitzung steht aber noch;
 * - `ended`: die Sitzung ist vorbei (oder es gab gar keine).
 */
export type SessionRecoveryOutcome = 'refreshed' | 'offline' | 'ended';

export interface SessionRecovery {
  recover(): Promise<SessionRecoveryOutcome>;
}

/**
 * Haken fuer `auth/data-access`, ohne dass diese Lib `auth` kennt: die App
 * bindet ihn an `SessionStore` (`app.config.ts`). Ungebunden (Tests) wird
 * nichts wiederholt.
 */
export const SESSION_RECOVERY = new InjectionToken<SessionRecovery | null>('SESSION_RECOVERY', {
  providedIn: 'root',
  factory: () => null,
});

/**
 * Auch was die Bibliothek wirft statt zurueckzugeben (abgebrochenes `fetch`)
 * verlaesst ein Repository als `RepositoryError`. Der Store bekommt damit nie
 * einen fremden Fehlertext zu sehen.
 *
 * Mit `recovery`: lehnt der Server das Token ab (`session-expired`) und laesst
 * sich die Sitzung erneuern, wird der Zugriff **genau einmal** wiederholt. Das
 * ist auch fuer Schreibvorgaenge sicher — bei 401 hat der Server nichts
 * ausgefuehrt. Scheitert die Wiederholung, bleibt es bei ihrem Fehler.
 */
export async function guarded<T>(
  operation: () => Promise<T>,
  recovery: SessionRecovery | null = null,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const first = toRepositoryError(error);
    if (first.code !== 'session-expired' || recovery === null) {
      throw first;
    }
    const outcome = await recovery.recover();
    if (outcome === 'offline') {
      // Der Refresh kam nicht durch, die Sitzung steht noch: fuer den Store
      // ist das ein Netzproblem, kein Ablauf.
      throw new RepositoryError('offline', first.technicalMessage);
    }
    if (outcome !== 'refreshed') {
      throw first;
    }
  }
  try {
    return await operation();
  } catch (error) {
    throw toRepositoryError(error);
  }
}

/**
 * `guarded()` mit dem Haken aus der App. Fuer Repositories, im Feld
 * initialisieren: `private readonly guarded = injectGuarded();`
 */
export function injectGuarded(): <T>(operation: () => Promise<T>) => Promise<T> {
  const recovery = inject(SESSION_RECOVERY);
  const config = inject(SUPABASE_CONFIG, { optional: true });
  setVerboseRepositoryLogging(config?.production === false);
  return (operation) => guarded(operation, recovery);
}
