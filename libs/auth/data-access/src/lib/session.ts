import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { isAuthRefreshDiscardedError, isAuthRetryableFetchError } from '@supabase/supabase-js';

import {
  RepositoryError,
  SUPABASE_CONFIG,
  SessionRecovery,
  SessionRecoveryOutcome,
  injectSupabase,
  onRepositoryError,
} from '@lib/shared/data-access-supabase';
import { DataKeyHolder } from '@lib/shared/util-crypto';

/** Der angemeldete Nutzer, so weit die Oberflaeche ihn braucht. */
export interface SessionUser {
  readonly id: string;
  readonly email: string;
}

/**
 * Start der Anmeldung mit Apple. Klappt er, verlaesst der Browser die Seite;
 * `failed` heisst, er ist geblieben.
 */
export type AppleSignInOutcome = 'redirecting' | 'failed';

/** Ergebnis von `redeem_invite_code()`, plus ein Ausgang fuer Serverfehler. */
export type RedeemOutcome = 'redeemed' | 'already_redeemed' | 'invalid' | 'locked' | 'failed';

/** Ausgang des Ruecksprungs von Apple. */
export type CompleteSignInOutcome = 'ok' | 'spent-or-foreign' | 'failed';

/**
 * PKCE legt den Code-Verifier im Browser ab, der die Anmeldung gestartet hat.
 * Fehlt er, gibt es genau zwei Gruende: der Ruecksprung landet in einem anderen
 * Browser, oder dieser Code ist hier bereits eingeloest worden — supabase-js
 * loescht den Verifier nach dem ersten erfolgreichen Tausch, und die
 * Zurueck-Taste fuehrt danach wieder auf dieselbe Adresse.
 *
 * Der Fehlercode ist massgeblich, der Wortlaut nur die Rueckfallebene fuer
 * aeltere Fassungen der Bibliothek.
 */
function isMissingVerifier(error: { code?: string; message?: string } | null): boolean {
  if (error?.code === 'pkce_code_verifier_not_found') {
    return true;
  }
  const text = (error?.message ?? '').toLowerCase();
  return text.includes('code verifier') || text.includes('code challenge');
}

/**
 * Anmeldestatus der Anwendung: wer angemeldet ist, ob dieses Konto einen
 * Einladungscode eingeloest hat und welcher Fassung des AV-Vertrags es
 * zugestimmt hat.
 *
 * Alles ist hier nur eine Kopie fuer die Oberflaeche. Verbindlich ist der
 * Server: `has_beta_access()` steckt als Bedingung in jeder RLS-Policy, ein
 * manipuliertes Signal in dieser Klasse gibt also keine Daten frei.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore implements SessionRecovery {
  private readonly db = injectSupabase();

  /**
   * Nur lokal in die Konsole schreiben. Fehlt die Konfiguration (Tests), wird
   * geschwiegen — lieber eine Meldung zu wenig als eine zu viel.
   */
  private readonly dataKey = inject(DataKeyHolder);

  private readonly logsAuthIssues =
    inject(SUPABASE_CONFIG, { optional: true })?.production === false;

  private readonly currentUser = signal<SessionUser | null>(null);
  private readonly betaAccess = signal(false);

  private readonly expired = signal(false);

  readonly user = this.currentUser.asReadonly();
  readonly hasBetaAccess = this.betaAccess.asReadonly();
  readonly signedIn = computed(() => this.currentUser() !== null);

  /**
   * Die Sitzung ist **unfreiwillig** zu Ende gegangen: Token-Refresh
   * gescheitert, in einem anderen Tab abgemeldet, oder der Server hat ein
   * abgelaufenes Token abgelehnt. Die Shell zeigt dafuer das Modal
   * „Sitzung abgelaufen". Nie beim eigenen Abmelden und nie ohne vorherige
   * Anmeldung — beim ersten Laden ohne Session greift der Guard.
   */
  readonly sessionExpired = this.expired.asReadonly();

  /**
   * Versionen des AV-Vertrags, denen dieses Konto nachweislich zugestimmt hat.
   * Nur Zusagen werden gemerkt: ein „nein" fragt beim naechsten Mal nach, damit
   * eine Zustimmung aus einem anderen Tab nicht ausgesperrt bleibt. Gilt fuer
   * eine Sitzung; mit dem Abmelden oder einem Kontowechsel ist sie leer
   * (`applyUser`).
   */
  private acceptedDpaVersions = new Set<string>();

  /** Laeuft genau einmal — `restore()` darf von jedem Guard gerufen werden. */
  private restoring: Promise<void> | null = null;

  /** Waehrend `signOut()` laeuft, ist ein `SIGNED_OUT` gewollt. */
  private signingOut = false;

  /**
   * Der laufende Rettungsversuch nach einem abgelehnten Token. Kommen mehrere
   * 401 auf einmal (Woche laedt Projekte und Eintraege parallel), teilen sie
   * sich **einen** Refresh — sonst liefen N Refreshes hintereinander durch das
   * Lock von supabase-js, und jeder rotierte das Refresh-Token erneut.
   */
  private recovering: Promise<SessionRecoveryOutcome> | null = null;

  constructor() {
    // Haelt den Stand nach, wenn die Session woanders endet: abgemeldet in
    // einem zweiten Tab, abgelaufenes Token, erneuertes Token.
    //
    // supabase-js meldet einen endgueltig gescheiterten Refresh als
    // `SIGNED_OUT` (die Session ist dann schon geloescht). Von einem gewollten
    // Abmelden unterscheidet es nur `signingOut`.
    this.db.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null;
      if (event === 'SIGNED_OUT' && this.currentUser() !== null && !this.signingOut) {
        this.expired.set(true);
      }
      if (user) {
        this.expired.set(false);
      }
      this.applyUser(user);
    });

    const stopListening = onRepositoryError((error) => this.onDataError(error));
    inject(DestroyRef).onDestroy(stopListening);
  }

  /** Session aus dem Speicher holen und den Beta-Zugang einmal pruefen. */
  restore(): Promise<void> {
    this.restoring ??= this.readSession();
    return this.restoring;
  }

  /**
   * Darf dieses Konto die Anwendung benutzen? Prueft bei Bedarf nach, damit ein
   * Code, der in einem anderen Tab eingeloest wurde, nicht ausgesperrt bleibt.
   */
  async ensureAccess(): Promise<boolean> {
    await this.restore();
    if (!this.currentUser()) {
      return false;
    }
    return this.betaAccess() ? true : this.refreshAccess();
  }

  /**
   * Anmeldung mit Apple, der einzige Weg in die Anwendung. Leitet zu Apple
   * weiter; zurueck kommt der Browser ueber `/auth/callback` mit einem Code,
   * den `completeSignIn` tauscht.
   *
   * Ein neues Konto entsteht dabei auch ohne Einladungscode. Freigeschaltet ist
   * es damit nicht: ohne eingeloesten Code liefert jede RLS-Policy nichts, und
   * der Guard schickt zur Code-Eingabe.
   */
  async signInWithApple(): Promise<AppleSignInOutcome> {
    const { error } = await this.db.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: authCallbackUrl() },
    });

    if (error) {
      this.logAuthIssue('Anmeldung mit Apple konnte nicht starten:', error);
      return 'failed';
    }
    return 'redirecting';
  }

  /** Ruecksprung von Apple: Code gegen eine Session tauschen. */
  async completeSignIn(code: string): Promise<CompleteSignInOutcome> {
    const { data, error } = await this.db.auth.exchangeCodeForSession(code);

    if (error) {
      this.logAuthIssue('Anmeldung mit Apple fehlgeschlagen:', error);
      return isMissingVerifier(error) ? 'spent-or-foreign' : 'failed';
    }

    this.applyUser(data.session?.user ?? null);
    await this.refreshAccess();
    return 'ok';
  }

  /**
   * Fehler, den Supabase an den Ruecksprung gehaengt hat (`?error=…`):
   * abgebrochen bei Apple, Provider falsch eingerichtet, vom Hook abgewiesen.
   * Nur fuer die lokale Fehlersuche, wie alle Auth-Fehler.
   */
  reportSignInError(details: unknown): void {
    this.logAuthIssue('Ruecksprung der Anmeldung meldet einen Fehler:', details);
  }

  /**
   * Einladungscode einloesen. Geprueft wird ausschliesslich in der Datenbank —
   * die Tabelle `invite_codes` ist ueber die API gar nicht lesbar.
   */
  async redeemInviteCode(code: string): Promise<RedeemOutcome> {
    const { data, error } = await this.db.rpc('redeem_invite_code', { p_code: code.trim() });

    if (error) {
      this.logAuthIssue('Einladungscode konnte nicht eingeloest werden:', error);
      return 'failed';
    }

    if (data === 'redeemed' || data === 'already_redeemed') {
      this.betaAccess.set(true);
      return data;
    }
    return data === 'locked' ? 'locked' : 'invalid';
  }

  /**
   * Hat dieses Konto der Version `version` des AV-Vertrags zugestimmt? Liest
   * die eigene Zeile in `dpa_acceptances` (RLS: nur die eigenen). Ohne Session
   * oder bei einem Fehler `false` — dann fragt die Zustimmungsseite, und ein
   * zweites Zustimmen schadet nicht.
   */
  async hasAcceptedDpa(version: string): Promise<boolean> {
    await this.restore();
    const askedFor = this.currentUser()?.id ?? null;
    if (askedFor === null) {
      return false;
    }
    if (this.acceptedDpaVersions.has(version)) {
      return true;
    }

    const { data, error } = await this.db
      .from('dpa_acceptances')
      .select('version')
      .eq('version', version);

    if (this.currentUser()?.id !== askedFor) {
      return false;
    }
    if (error) {
      this.logAuthIssue('Zustimmung zum AV-Vertrag konnte nicht geprueft werden:', error);
      return false;
    }

    const accepted = (data ?? []).length > 0;
    if (accepted) {
      this.acceptedDpaVersions.add(version);
    }
    return accepted;
  }

  /**
   * Zustimmung zur Version `version` speichern. Den Zeitpunkt setzt der Server
   * (`accept_dpa()`); zweimal zustimmen ist kein Fehler. `false` heisst: nicht
   * gespeichert — die Seite entscheidet, wie sie das meldet.
   */
  async acceptDpa(version: string): Promise<boolean> {
    const askedFor = this.currentUser()?.id ?? null;
    if (askedFor === null) {
      return false;
    }

    const { error } = await this.db.rpc('accept_dpa', { p_version: version });

    if (error) {
      this.logAuthIssue('Zustimmung zum AV-Vertrag konnte nicht gespeichert werden:', error);
      return false;
    }
    if (this.currentUser()?.id === askedFor) {
      this.acceptedDpaVersions.add(version);
    }
    return true;
  }

  async signOut(): Promise<void> {
    await this.endSession('global');
  }

  /**
   * „Neu anmelden" im Modal. Nur lokal: das Token ist ohnehin abgelaufen, der
   * Server wuerde das Abmelden ablehnen.
   */
  async endExpiredSession(): Promise<void> {
    await this.endSession('local');
  }

  private async endSession(scope: 'global' | 'local'): Promise<void> {
    this.signingOut = true;
    try {
      const { error } = await this.db.auth.signOut({ scope });
      if (error) {
        this.logAuthIssue('Abmelden fehlgeschlagen:', error);
      }
    } catch (error) {
      // Wirft die Bibliothek (Netz weg, Speicher gesperrt), darf die Shell
      // trotzdem nicht haengen bleiben — der Aufrufer navigiert danach.
      this.logAuthIssue('Abmelden fehlgeschlagen:', error);
    } finally {
      this.signingOut = false;
      // Auch wenn der Server nicht antwortet: lokal ist die Sitzung vorbei.
      this.applyUser(null);
      this.expired.set(false);
    }
  }

  /**
   * Der Server hat ein Token abgelehnt. Oft hat supabase-js nur noch nicht
   * erneuert (Rechner war im Ruhezustand) — dann reicht ein Refresh, und es
   * gibt kein Modal. Scheitert er endgueltig, ist die Sitzung wirklich vorbei.
   *
   * Zwei Wege fuehren hierher: der Zuhoerer an `fail()` und `guarded()`, das
   * nach `refreshed` den Zugriff einmal wiederholt (`SESSION_RECOVERY`). Beide
   * teilen sich denselben Versuch.
   */
  recover(): Promise<SessionRecoveryOutcome> {
    this.recovering ??= this.tryRefresh().finally(() => {
      this.recovering = null;
    });
    return this.recovering;
  }

  private onDataError(error: RepositoryError): void {
    if (error.code === 'session-expired') {
      void this.recover();
    }
  }

  private async tryRefresh(): Promise<SessionRecoveryOutcome> {
    const before = this.currentUser();
    if (before === null || this.expired() || this.signingOut) {
      return 'ended';
    }

    const { data, error } = await this.db.auth.refreshSession();

    // Waehrend des Wartens kann sich alles geaendert haben: der Refresh stand
    // womoeglich hinter dem Lock eines gewollten `signOut()` an, oder es ist
    // inzwischen jemand anderes angemeldet. Die Antwort gehoert dann nicht mehr
    // zu dieser Sitzung — und ein Ablauf ist es schon gar nicht.
    if (this.signingOut || this.currentUser()?.id !== before.id || this.expired()) {
      return 'ended';
    }
    if (!error && data.session) {
      return 'refreshed';
    }
    // Netz weg (`AuthRetryableFetchError`) oder Ergebnis verworfen
    // (`AuthRefreshDiscardedError`): supabase-js behaelt die Session in beiden
    // Faellen. Ein Modal waere ein Fehlalarm, und „Neu anmelden" beendete
    // danach eine gueltige Sitzung.
    if (isAuthRetryableFetchError(error) || isAuthRefreshDiscardedError(error)) {
      this.logAuthIssue('Sitzung liess sich gerade nicht erneuern:', error);
      return 'offline';
    }
    this.logAuthIssue('Sitzung liess sich nicht erneuern:', error);
    this.expired.set(true);
    return 'ended';
  }

  /** Fragt `has_beta_access()` neu ab und schreibt das Ergebnis fort. */
  async refreshAccess(): Promise<boolean> {
    const askedFor = this.currentUser()?.id ?? null;
    if (askedFor === null) {
      this.betaAccess.set(false);
      return false;
    }

    const { data, error } = await this.db.rpc('has_beta_access');

    // Waehrend die Abfrage lief, kann abgemeldet oder das Konto gewechselt
    // worden sein. Dann gehoert die Antwort zu jemand anderem.
    if (this.currentUser()?.id !== askedFor) {
      return this.betaAccess();
    }

    if (error) {
      this.logAuthIssue('Beta-Zugang konnte nicht geprueft werden:', error);
      this.betaAccess.set(false);
      return false;
    }

    this.betaAccess.set(data === true);
    return data === true;
  }

  private async readSession(): Promise<void> {
    const { data, error } = await this.db.auth.getSession();
    if (error) {
      this.logAuthIssue('Session konnte nicht gelesen werden:', error);
    }
    this.applyUser(data?.session?.user ?? null);
    await this.refreshAccess();
  }

  /**
   * Fehler aus dem Anmeldeweg gehoeren nur in die lokale Fehlersuche.
   *
   * In der ausgelieferten Anwendung gehoeren Serverantworten nicht in die
   * Konsole: sie verraten mehr ueber Konten und Zugang, als die Oberflaeche
   * sagt. Dieselbe Begruendung steht ueber `RepositoryError` in
   * `shared/data-access-supabase`.
   */
  private logAuthIssue(message: string, error: unknown): void {
    if (this.logsAuthIssues) {
      console.error(`[Dailyfi] ${message}`, error);
    }
  }

  private applyUser(raw: { id: string; email?: string | null } | null): void {
    const next: SessionUser | null = raw ? { id: raw.id, email: raw.email ?? '' } : null;

    // Ein anderes Konto heisst: der gepruefte Zugang, die Zustimmung und der
    // Datenschluessel von vorhin gelten nicht mehr. Abmelden ist der Wechsel zu „niemand".
    if (this.currentUser()?.id !== next?.id) {
      this.betaAccess.set(false);
      this.acceptedDpaVersions = new Set();
      // Der entsperrte Datenschluessel gehoert zum alten Konto.
      this.dataKey.clear();
    }
    this.currentUser.set(next);
  }
}

/**
 * Ziel des Ruecksprungs nach der Anmeldung. Muss buchstabengleich in den
 * Redirect-URLs des Projekts stehen (`additional_redirect_urls` in
 * `supabase/config.toml`) — GoTrue tauscht eine nicht passende Adresse
 * stillschweigend gegen `site_url`, der Ruecksprung landet dann auf `/` und der
 * Code verfaellt, ohne dass irgendwo ein Fehler steht.
 */
export function authCallbackUrl(): string {
  return `${globalThis.location.origin}/auth/callback`;
}
