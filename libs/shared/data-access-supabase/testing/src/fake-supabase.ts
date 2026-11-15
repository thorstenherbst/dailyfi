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

export interface OtpRequest {
  email: string;
  shouldCreateUser: boolean;
  emailRedirectTo: string | undefined;
  /** Kommt als `user_metadata.invite_code` beim Hook an. */
  inviteCode: string | undefined;
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
  otpRequests: OtpRequest[] = [];
  otpError: FakeAuthError | null = null;

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

    signInWithOtp: async (params: {
      email: string;
      options?: {
        shouldCreateUser?: boolean;
        emailRedirectTo?: string;
        data?: Record<string, unknown>;
      };
    }) => {
      const inviteCode = params.options?.data?.['invite_code'];
      this.otpRequests.push({
        email: params.email,
        shouldCreateUser: params.options?.shouldCreateUser ?? true,
        emailRedirectTo: params.options?.emailRedirectTo,
        inviteCode: typeof inviteCode === 'string' ? inviteCode : undefined,
      });
      return { data: {}, error: this.otpError };
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

  async rpc(name: string, args?: Record<string, unknown>) {
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
