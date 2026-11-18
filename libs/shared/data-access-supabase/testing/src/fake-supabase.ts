import type { DailyfiClient } from '../../src/lib/supabase.client';

export interface FakeAuthUser {
  id: string;
  email: string;
}

export interface FakeAuthError {
  message: string;
  status?: number;
  code?: string;
}

export interface OAuthRequest {
  provider: string;
  redirectTo: string | undefined;
}

/**
 * Supabase-Doppel fuer die Tests: nur die Aufrufe, die `SessionStore` wirklich
 * macht. Bewusst kein Mock der ganzen Bibliothek — was hier nicht steht, faellt
 * im Test als `undefined is not a function` auf, statt still nichts zu tun.
 */
export class FakeSupabase {
  /** Angemeldeter Nutzer. `null` heisst: keine Session. */
  user: FakeAuthUser | null = null;
  betaAccess = false;

  getSessionCalls = 0;
  oauthRequests: OAuthRequest[] = [];
  oauthError: FakeAuthError | null = null;

  exchangedCodes: string[] = [];
  exchangeError: FakeAuthError | null = null;
  /** Wer nach einem erfolgreichen Tausch angemeldet ist. */
  exchangeUser: FakeAuthUser = { id: 'u1', email: 'neu@dailyfi.test' };

  redeemedCodes: string[] = [];
  redeemResult: 'redeemed' | 'already_redeemed' | 'invalid' | 'locked' = 'redeemed';
  rpcError: FakeAuthError | null = null;
  /** Nur fuer `redeem_invite_code`; `null` heisst: `rpcError` gilt fuer beide. */
  redeemError: FakeAuthError | null = null;
  /** Laeuft, waehrend `has_beta_access` unterwegs ist — fuer Kontowechsel mitten im Flug. */
  onBetaCheck: (() => void) | null = null;

  /** Ergebnis von `refreshSession()`: mit Fehler endet die Session. */
  refreshError: FakeAuthError | null = null;
  refreshCalls = 0;
  /**
   * Haelt `refreshSession()` an, bis das Versprechen erfuellt ist — wie das
   * Lock von supabase-js, hinter dem ein Refresh auf ein `signOut()` wartet.
   */
  refreshGate: Promise<void> | null = null;

  /** Versionen des AV-Vertrags, denen der angemeldete Nutzer zugestimmt hat. */
  dpaAcceptances: string[] = [];
  /** Wie oft `dpa_acceptances` gelesen wurde — fuer den Zwischenspeicher. */
  dpaReads = 0;
  dpaReadError: FakeAuthError | null = null;
  /** Fehler von `accept_dpa`; die Zustimmung wird dann nicht gespeichert. */
  acceptDpaError: FakeAuthError | null = null;
  /** Versionen, die `accept_dpa` bekommen hat, in Reihenfolge. */
  acceptDpaCalls: string[] = [];

  /** `signOut()` wirft statt zurueckzugeben (Speicher gesperrt o. ae.). */
  signOutThrows: Error | null = null;

  signOutCalls = 0;
  /** Was `signOut()` mitbekommen hat (`scope: 'local'` beim Ablauf). */
  signOutScopes: Array<string | undefined> = [];

  private authListener: ((event: string, session: { user: FakeAuthUser } | null) => void) | null =
    null;

  /**
   * Spielt ein Ereignis von supabase-js nach — z. B. `SIGNED_OUT` nach einem
   * gescheiterten Token-Refresh. Wie die Bibliothek: erst Speicher, dann Ruf.
   */
  emitAuthEvent(event: string, user: FakeAuthUser | null = null): void {
    this.user = user;
    this.authListener?.(event, user ? { user } : null);
  }

  readonly auth = {
    onAuthStateChange: (
      listener: (event: string, session: { user: FakeAuthUser } | null) => void,
    ) => {
      this.authListener = listener;
      return {
        data: {
          subscription: {
            unsubscribe: (): void => {
              this.authListener = null;
            },
          },
        },
      };
    },

    getSession: async () => {
      this.getSessionCalls += 1;
      return {
        data: { session: this.user ? { user: this.user } : null },
        error: null,
      };
    },

    signInWithOAuth: async (params: { provider: string; options?: { redirectTo?: string } }) => {
      this.oauthRequests.push({
        provider: params.provider,
        redirectTo: params.options?.redirectTo,
      });
      return { data: {}, error: this.oauthError };
    },

    exchangeCodeForSession: async (code: string) => {
      this.exchangedCodes.push(code);
      if (this.exchangeError) {
        return { data: { session: null }, error: this.exchangeError };
      }
      this.user = this.exchangeUser;
      return { data: { session: { user: this.user } }, error: null };
    },

    refreshSession: async () => {
      this.refreshCalls += 1;
      await this.refreshGate;
      if (this.refreshError || !this.user) {
        return { data: { session: null }, error: this.refreshError ?? { message: 'no session' } };
      }
      return { data: { session: { user: this.user } }, error: null };
    },

    signOut: async (options?: { scope?: string }) => {
      this.signOutCalls += 1;
      this.signOutScopes.push(options?.scope);
      if (this.signOutThrows) {
        throw this.signOutThrows;
      }
      // Wie supabase-js: die Session ist weg, und der Listener hoert davon.
      this.emitAuthEvent('SIGNED_OUT', null);
      return { error: null };
    },
  };

  /** Zeilen in `user_keys` des angemeldeten Nutzers. */
  userKeys: Array<Record<string, unknown>> = [];
  userKeysReadError: FakeAuthError | null = null;
  userKeysInsertError: FakeAuthError | null = null;
  /** Gespeichert, aber die Antwort geht unterwegs verloren. */
  userKeysInsertLosesResponse = false;
  userKeysReads = 0;

  /**
   * `dpa_acceptances` (nur `select(...).eq('version', …)`) und `user_keys`
   * (`select(...)` und `insert([...])`).
   */
  from(table: string) {
    if (table === 'user_keys') {
      return {
        select: async () => {
          this.userKeysReads += 1;
          if (this.userKeysReadError) {
            return { data: null, error: this.userKeysReadError };
          }
          return { data: this.user ? this.userKeys.map((row) => ({ ...row })) : [], error: null };
        },
        insert: async (rows: Array<Record<string, unknown>>) => {
          if (this.userKeysInsertError) {
            return { data: null, error: this.userKeysInsertError };
          }
          // Wie `user_keys_one_recovery` und `unique (user_id, credential_id)`:
          // eine Anweisung, die dagegen verstoesst, schreibt gar nichts.
          const all = [...this.userKeys, ...rows];
          const recoveries = all.filter((row) => row['kind'] === 'recovery').length;
          const ids = all.map((row) => row['credential_id']).filter((id) => id !== null);
          if (recoveries > 1 || new Set(ids).size !== ids.length) {
            return {
              data: null,
              error: { message: 'duplicate key value violates unique constraint', code: '23505' },
            };
          }
          this.userKeys.push(...rows.map((row) => ({ ...row })));
          if (this.userKeysInsertLosesResponse) {
            return { data: null, error: { message: 'Failed to fetch' } };
          }
          return { data: null, error: null };
        },
      };
    }
    if (table !== 'dpa_acceptances') {
      throw new Error(`Unerwartete Tabelle: ${table}`);
    }
    return {
      select: () => ({
        eq: async (column: string, value: string) => {
          this.dpaReads += 1;
          if (this.dpaReadError) {
            return { data: null, error: this.dpaReadError };
          }
          const rows = this.user
            ? this.dpaAcceptances.filter((version) => column === 'version' && version === value)
            : [];
          return { data: rows.map((version) => ({ version })), error: null };
        },
      }),
    };
  }

  async rpc(name: string, args?: Record<string, unknown>) {
    if (name === 'accept_dpa') {
      const version = String(args?.['p_version'] ?? '');
      this.acceptDpaCalls.push(version);
      if (this.acceptDpaError) {
        return { data: null, error: this.acceptDpaError };
      }
      if (!this.dpaAcceptances.includes(version)) {
        this.dpaAcceptances.push(version);
      }
      return { data: null, error: null };
    }
    if (name === 'has_beta_access') {
      this.onBetaCheck?.();
      return this.rpcError
        ? { data: null, error: this.rpcError }
        : { data: this.betaAccess, error: null };
    }
    if (name === 'redeem_invite_code') {
      const error = this.redeemError ?? this.rpcError;
      if (error) {
        return { data: null, error };
      }
      this.redeemedCodes.push(String(args?.['p_code'] ?? ''));
      if (this.redeemResult === 'redeemed' || this.redeemResult === 'already_redeemed') {
        this.betaAccess = true;
      }
      return { data: this.redeemResult, error: null };
    }
    throw new Error(`Unerwarteter RPC-Aufruf: ${name}`);
  }

  asClient(): DailyfiClient {
    return this as unknown as DailyfiClient;
  }
}
