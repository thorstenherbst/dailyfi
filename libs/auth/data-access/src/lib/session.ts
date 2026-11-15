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

/** Der angemeldete Nutzer, so weit die Oberflaeche ihn braucht. */
export interface SessionUser {
  readonly id: string;
  readonly email: string;
}

/** Was aus einer Magic-Link-Anforderung zur Registrierung geworden ist. */
export type MagicLinkOutcome = 'sent' | 'invalid-code' | 'rate-limited' | 'failed';

/** Ergebnis von `redeem_invite_code()`, plus ein Ausgang fuer Serverfehler. */
export type RedeemOutcome = 'redeemed' | 'already_redeemed' | 'invalid' | 'locked' | 'failed';

/** Ausgang des Magic-Link-Ruecksprungs. */
export type CompleteSignInOutcome = 'ok' | 'spent-or-foreign' | 'failed';

/**
 * Supabase liefert bei zu vielen Mails 429. Der Code kommt je nach Endpunkt
 * einmal als Status und einmal als Textkennung.
 */
function isRateLimit(error: { status?: number; code?: string } | null): boolean {
  return error?.status === 429 || (error?.code ?? '').includes('rate_limit');
}

/**
 * PKCE legt den Code-Verifier im Browser ab, der den Link angefordert hat.
 * Fehlt er, gibt es genau zwei Gruende: die Mail wurde in einem anderen Browser
 * geoeffnet, oder dieser Link ist hier bereits eingeloest worden — supabase-js
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
 * Anmeldestatus der Anwendung: wer angemeldet ist und ob dieses Konto einen
 * Einladungscode eingeloest hat.
 *
 * Beides ist hier nur eine Kopie fuer die Oberflaeche. Verbindlich ist der
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
   * Magic Link zum Anmelden. **Ohne Rueckmeldung, und das ist der Zweck.**
   *
   * Der Server antwortet unterschiedlich, je nachdem ob es die Adresse gibt:
   * 200 fuer ein vorhandenes Konto, 422 fuer ein unbekanntes — und beim zweiten
   * Versuch 429 fuer das vorhandene, weil nur dann eine Mail rausging und die
   * Drosselung greift. Jede dieser Unterscheidungen, die bis in die Oberflaeche
   * durchschlaegt, macht aus der Anmeldeseite ein Nutzerverzeichnis.
   *
   * Der 429 fuehrt den Nutzer dabei nicht in die Irre: er entsteht nur, wenn
   * gerade eine Mail an genau diese Adresse rausging. „Ein Link ist unterwegs"
   * stimmt dann.
   */
  async requestLoginLink(email: string): Promise<void> {
    await this.sendOtp(email, false);
  }

  /**
   * Magic Link zur Registrierung. Der Einladungscode reist als
   * `user_metadata.invite_code` mit und wird **vor** der Kontoanlage geprueft:
   * `before_user_created` in der Datenbank weist einen ungueltigen Code mit
   * HTTP 403 ab, und dann entsteht weder ein Konto noch geht eine Mail raus.
   *
   * Der Preis dafuer steht in der Uebergabe: fuer eine Adresse, die es schon
   * gibt, laeuft der Hook nicht — ein erfundener Code liefert dort 200 statt
   * 403. Damit sagt `/register`, ob eine Adresse bereits ein Konto hat. Das ist
   * der uebliche Handel einer Registrierungsseite; `/login` bleibt davon
   * unberuehrt und antwortet weiter immer gleich.
   */
  async requestSignupLink(email: string, inviteCode: string): Promise<MagicLinkOutcome> {
    const error = await this.sendOtp(email, true, inviteCode);
    if (!error) {
      return 'sent';
    }
    // 403 kommt an diesem Endpunkt nur aus dem Hook.
    if (error.status === 403) {
      return 'invalid-code';
    }
    return isRateLimit(error) ? 'rate-limited' : 'failed';
  }

  /** Ruecksprung aus der Mail: Code gegen eine Session tauschen. */
  async completeSignIn(code: string): Promise<CompleteSignInOutcome> {
    const { data, error } = await this.db.auth.exchangeCodeForSession(code);

    if (error) {
      this.logAuthIssue('Anmeldung ueber den Magic Link fehlgeschlagen:', error);
      return isMissingVerifier(error) ? 'spent-or-foreign' : 'failed';
    }

    this.applyUser(data.session?.user ?? null);
    await this.refreshAccess();
    return 'ok';
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

  private async sendOtp(
    email: string,
    shouldCreateUser: boolean,
    inviteCode?: string,
  ): Promise<{ status?: number; code?: string } | null> {
    const { error } = await this.db.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser,
        emailRedirectTo: authCallbackUrl(),
        // Landet im Hook als `user.user_metadata.invite_code`.
        ...(inviteCode ? { data: { invite_code: inviteCode } } : {}),
      },
    });

    if (error) {
      this.logAuthIssue('Magic Link konnte nicht verschickt werden:', error);
    }
    return error;
  }

  /**
   * Fehler aus dem Anmeldeweg gehoeren nur in die lokale Fehlersuche.
   *
   * In der ausgelieferten Anwendung wuerde die Konsole sonst genau das
   * ausplaudern, was die Oberflaeche verschweigt: „Signups not allowed for otp"
   * heisst, dass es dieses Konto nicht gibt, die Drosselungsmeldung heisst, dass
   * es existiert. Ohne jedes Werkzeug ablesbar. Dieselbe Begruendung steht schon
   * ueber `RepositoryError` in `shared/data-access-supabase`.
   */
  private logAuthIssue(message: string, error: unknown): void {
    if (this.logsAuthIssues) {
      console.error(`[Dailyfi] ${message}`, error);
    }
  }

  private applyUser(raw: { id: string; email?: string | null } | null): void {
    const next: SessionUser | null = raw ? { id: raw.id, email: raw.email ?? '' } : null;

    // Ein anderes Konto heisst: der gepruefte Zugang von vorhin gilt nicht mehr.
    if (this.currentUser()?.id !== next?.id) {
      this.betaAccess.set(false);
    }
    this.currentUser.set(next);
  }
}

/**
 * Ziel des Magic Links. Muss buchstabengleich in `additional_redirect_urls`
 * (`supabase/config.toml`) stehen — GoTrue tauscht eine nicht passende Adresse
 * stillschweigend gegen `site_url`, der Link landet dann auf `/` und der Code
 * verfaellt, ohne dass irgendwo ein Fehler steht.
 */
export function authCallbackUrl(): string {
  return `${globalThis.location.origin}/auth/callback`;
}
