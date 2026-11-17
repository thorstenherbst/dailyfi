import { TestBed } from '@angular/core/testing';
import { AuthRefreshDiscardedError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { SUPABASE, SUPABASE_CONFIG, SupabaseConfig, fail } from '@lib/shared/data-access-supabase';
import { FakeSupabase } from '@lib/shared/data-access-supabase/testing';

import { SessionStore, authCallbackUrl } from './session';

function setup(configure: (fake: FakeSupabase) => void = () => {}): {
  fake: FakeSupabase;
  store: SessionStore;
} {
  const fake = new FakeSupabase();
  configure(fake);

  TestBed.configureTestingModule({
    providers: [{ provide: SUPABASE, useValue: fake.asClient() }],
  });

  return { fake, store: TestBed.inject(SessionStore) };
}

describe('SessionStore', () => {
  beforeEach(() => {
    // Der Store protokolliert jeden Fehlerweg; im Test ist das nur Laerm.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('liest beim Start Session und Beta-Zugang', async () => {
    const { store } = setup((fake) => {
      fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
      fake.betaAccess = true;
    });

    await store.restore();

    expect(store.user()).toEqual({ id: 'u1', email: 'thorsten@dailyfi.test' });
    expect(store.hasBetaAccess()).toBe(true);
    expect(store.signedIn()).toBe(true);
  });

  it('liest die Session nur einmal, egal wie viele Guards fragen', async () => {
    const { fake, store } = setup();

    await Promise.all([store.restore(), store.restore()]);
    await store.restore();

    expect(fake.getSessionCalls).toBe(1);
  });

  it('meldet ohne Session weder Nutzer noch Zugang', async () => {
    const { store } = setup();

    await store.restore();

    expect(store.user()).toBeNull();
    expect(store.hasBetaAccess()).toBe(false);
  });

  it('schickt den Magic Link auf /auth/callback', async () => {
    const { fake, store } = setup();

    await store.requestLoginLink('  thorsten@dailyfi.test  ');

    expect(fake.otpRequests).toEqual([
      {
        email: 'thorsten@dailyfi.test',
        shouldCreateUser: false,
        emailRedirectTo: authCallbackUrl(),
        // Kein Einladungscode: /login legt nichts an, der Hook laeuft dort nicht.
        inviteCode: undefined,
      },
    ]);
    expect(authCallbackUrl()).toMatch(/\/auth\/callback$/);
  });

  it('gibt beim Anmelden nichts zurueck, woran sich ein Konto erkennen liesse', async () => {
    // 422 heisst „Konto unbekannt", 429 heisst „Konto vorhanden, Mail ging
    // gerade raus". Beides darf die Seite nicht unterscheiden koennen.
    for (const error of [
      null,
      { message: 'Signups not allowed for otp', status: 422 },
      { message: 'you can only request this after 60 seconds', status: 429 },
    ]) {
      TestBed.resetTestingModule();
      const { store } = setup((fake) => {
        fake.otpError = error;
      });

      await expect(store.requestLoginLink('jemand@example.com')).resolves.toBeUndefined();
    }
  });

  it('schickt den Einladungscode zur Registrierung mit', async () => {
    const { fake, store } = setup();

    await expect(store.requestSignupLink('neu@dailyfi.test', 'DF-ABCDE')).resolves.toBe('sent');

    expect(fake.otpRequests[0].shouldCreateUser).toBe(true);
    expect(fake.otpRequests[0].inviteCode).toBe('DF-ABCDE');
  });

  it('meldet den vom Hook abgewiesenen Code als solchen', async () => {
    // 403 kommt an diesem Endpunkt nur aus `before_user_created`.
    const { store } = setup((fake) => {
      fake.otpError = { message: 'Einladungscode ungueltig oder bereits verwendet.', status: 403 };
    });

    await expect(store.requestSignupLink('neu@dailyfi.test', 'ERFUNDEN-1')).resolves.toBe(
      'invalid-code',
    );
  });

  it('meldet andere Fehler der Registrierung ehrlich', async () => {
    const { store } = setup((fake) => {
      fake.otpError = { message: 'smtp down', status: 500 };
    });

    await expect(store.requestSignupLink('neu@dailyfi.test', 'DF-ABCDE')).resolves.toBe('failed');
  });

  it('reicht die Sperre des Fehlversuchszaehlers durch', async () => {
    const { store } = setup((fake) => {
      fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
      fake.redeemResult = 'locked';
    });
    await store.restore();

    await expect(store.redeemInviteCode('RATEVERSUCH-6')).resolves.toBe('locked');
    expect(store.hasBetaAccess()).toBe(false);
  });

  it('tauscht den Code der Mail gegen eine Session', async () => {
    const { fake, store } = setup();

    await expect(store.completeSignIn('abc123')).resolves.toBe('ok');

    expect(fake.exchangedCodes).toEqual(['abc123']);
    expect(store.user()).toEqual(fake.exchangeUser);
  });

  it('erkennt den fehlenden Verifier am Fehlercode der Bibliothek', async () => {
    const { store } = setup((fake) => {
      fake.exchangeError = {
        message: 'PKCE code verifier not found in storage. This can happen if …',
        code: 'pkce_code_verifier_not_found',
        status: 400,
      };
    });

    await expect(store.completeSignIn('abc123')).resolves.toBe('spent-or-foreign');
    expect(store.user()).toBeNull();
  });

  it('erkennt den fehlenden Verifier auch am aelteren Wortlaut', async () => {
    const { store } = setup((fake) => {
      fake.exchangeError = {
        message: 'both auth code and code verifier should be non-empty',
        status: 400,
      };
    });

    await expect(store.completeSignIn('abc123')).resolves.toBe('spent-or-foreign');
  });

  it('meldet andere Fehler des Ruecksprungs als Fehlschlag', async () => {
    const { store } = setup((fake) => {
      fake.exchangeError = { message: 'invalid flow state', status: 400 };
    });

    await expect(store.completeSignIn('abc123')).resolves.toBe('failed');
  });

  it('schaltet frei, wenn der Einladungscode eingeloest wurde', async () => {
    const { fake, store } = setup((f) => {
      f.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
    });
    await store.restore();

    await expect(store.redeemInviteCode('  dailyfi-dev-2 ')).resolves.toBe('redeemed');

    expect(fake.redeemedCodes).toEqual(['dailyfi-dev-2']);
    expect(store.hasBetaAccess()).toBe(true);
  });

  it('schaltet bei ungueltigem Code nicht frei', async () => {
    const { store } = setup((fake) => {
      fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
      fake.redeemResult = 'invalid';
    });
    await store.restore();

    await expect(store.redeemInviteCode('FALSCH-123')).resolves.toBe('invalid');
    expect(store.hasBetaAccess()).toBe(false);
  });

  it('meldet einen Serverfehler beim Einloesen als Fehlschlag, nicht als ungueltig', async () => {
    const { store } = setup((fake) => {
      fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
      fake.rpcError = { message: 'connection reset' };
    });

    await expect(store.redeemInviteCode('DAILYFI-DEV-2')).resolves.toBe('failed');
  });

  it('fragt den Zugang nach, wenn er noch nicht steht', async () => {
    const { fake, store } = setup((f) => {
      f.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
    });
    await store.restore();
    expect(store.hasBetaAccess()).toBe(false);

    // Code in einem zweiten Tab eingeloest.
    fake.betaAccess = true;

    await expect(store.ensureAccess()).resolves.toBe(true);
    expect(store.hasBetaAccess()).toBe(true);
  });

  it('meldet ohne Session keinen Zugang und fragt den Server gar nicht erst', async () => {
    const { store } = setup((fake) => {
      fake.betaAccess = true;
    });

    await expect(store.ensureAccess()).resolves.toBe(false);
  });

  it('wertet einen Fehler der Zugangspruefung als kein Zugang', async () => {
    const { store } = setup((fake) => {
      fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
      fake.betaAccess = true;
      fake.rpcError = { message: 'connection reset' };
    });

    await store.restore();

    expect(store.hasBetaAccess()).toBe(false);
  });

  it('verwirft die Antwort der Zugangspruefung, wenn inzwischen abgemeldet wurde', async () => {
    const { fake, store } = setup((f) => {
      f.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
      f.betaAccess = true;
    });
    await store.restore();
    expect(store.hasBetaAccess()).toBe(true);

    // Waehrend has_beta_access unterwegs ist, endet die Sitzung.
    fake.onBetaCheck = () => {
      void store.signOut();
      fake.onBetaCheck = null;
    };

    await store.refreshAccess();

    // Entscheidend ist, dass die alte Antwort den Zugang nicht wieder aufmacht.
    expect(store.hasBetaAccess()).toBe(false);
  });

  it('raeumt beim Abmelden Nutzer und Zugang weg', async () => {
    const { fake, store } = setup((f) => {
      f.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
      f.betaAccess = true;
    });
    await store.restore();

    await store.signOut();

    expect(fake.signOutCalls).toBe(1);
    expect(store.user()).toBeNull();
    expect(store.hasBetaAccess()).toBe(false);
  });

  describe('Protokoll der Auth-Fehler', () => {
    // Sicherheitsanforderung (README): Im Produktionsbuild verraet die Konsole
    // nicht, was die Oberflaeche verschweigt. Geprueft ueber einen echten
    // Fehlerweg, den gescheiterten Tausch des Magic-Link-Codes.
    async function failSignIn(config: SupabaseConfig | null): Promise<void> {
      const fake = new FakeSupabase();
      fake.exchangeError = { message: 'invalid flow state', code: 'flow_state_not_found' };
      TestBed.configureTestingModule({
        providers: [
          { provide: SUPABASE, useValue: fake.asClient() },
          ...(config ? [{ provide: SUPABASE_CONFIG, useValue: config }] : []),
        ],
      });
      const outcome = await TestBed.inject(SessionStore).completeSignIn('code-123');
      expect(outcome).toBe('failed');
    }

    const config = { url: 'http://localhost', publishableKey: 'key' };

    it('schweigt im Produktionsbuild', async () => {
      await failSignIn({ ...config, production: true });

      expect(console.error).not.toHaveBeenCalled();
    });

    it('schreibt ausserhalb des Produktionsbuilds in die Konsole', async () => {
      await failSignIn({ ...config, production: false });

      expect(console.error).toHaveBeenCalledWith(
        '[Dailyfi] Anmeldung ueber den Magic Link fehlgeschlagen:',
        expect.objectContaining({ code: 'flow_state_not_found' }),
      );
    });

    it('schweigt, wenn keine Konfiguration bereitgestellt ist', async () => {
      await failSignIn(null);

      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe('Sitzung abgelaufen', () => {
    async function signedIn(): Promise<{ fake: FakeSupabase; store: SessionStore }> {
      const result = setup((fake) => {
        fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
        fake.betaAccess = true;
      });
      await result.store.restore();
      return result;
    }

    /** `onDataError` laeuft asynchron (Refresh). */
    const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

    it('erkennt ein SIGNED_OUT, das niemand angefordert hat', async () => {
      const { fake, store } = await signedIn();

      fake.emitAuthEvent('SIGNED_OUT', null);

      expect(store.sessionExpired()).toBe(true);
      expect(store.user()).toBeNull();
    });

    it('haelt das eigene Abmelden nicht fuer einen Ablauf', async () => {
      const { store } = await signedIn();

      await store.signOut();

      expect(store.sessionExpired()).toBe(false);
    });

    it('meldet ohne vorherige Anmeldung keinen Ablauf', async () => {
      const { fake, store } = setup();
      await store.restore();

      fake.emitAuthEvent('SIGNED_OUT', null);

      expect(store.sessionExpired()).toBe(false);
    });

    it('vergisst den Ablauf, sobald wieder jemand angemeldet ist', async () => {
      const { fake, store } = await signedIn();
      fake.emitAuthEvent('SIGNED_OUT', null);

      fake.emitAuthEvent('SIGNED_IN', { id: 'u1', email: 'thorsten@dailyfi.test' });

      expect(store.sessionExpired()).toBe(false);
    });

    it('meldet abgelehnte Tokens erst, wenn auch der Refresh scheitert', async () => {
      const { fake, store } = await signedIn();
      fake.refreshError = { message: 'Invalid Refresh Token', status: 400 };

      expect(() => fail({ message: 'JWT expired', code: 'PGRST301' })).toThrow();
      await tick();

      expect(store.sessionExpired()).toBe(true);
    });

    it('teilt sich bei mehreren parallelen 401 einen einzigen Refresh', async () => {
      const { fake, store } = await signedIn();
      let release!: () => void;
      fake.refreshGate = new Promise((resolve) => (release = resolve));

      for (let i = 0; i < 3; i++) {
        expect(() => fail({ message: 'JWT expired', code: 'PGRST301' })).toThrow();
      }
      const outcomes = Promise.all([store.recover(), store.recover(), store.recover()]);
      release();

      expect(await outcomes).toEqual(['refreshed', 'refreshed', 'refreshed']);
      expect(fake.refreshCalls).toBe(1);
      expect(store.sessionExpired()).toBe(false);
    });

    it('haelt einen 401, der hinter dem eigenen Abmelden wartete, nicht fuer einen Ablauf', async () => {
      const { fake, store } = await signedIn();
      let release!: () => void;
      fake.refreshGate = new Promise((resolve) => (release = resolve));

      // Der Refresh steht hinter dem Lock an; waehrenddessen meldet man sich ab.
      const outcome = store.recover();
      await store.signOut();
      release();

      expect(await outcome).toBe('ended');
      expect(store.sessionExpired()).toBe(false);
    });

    it.each([
      ['Netz weg', () => new AuthRetryableFetchError('Failed to fetch', 0)],
      ['Ergebnis verworfen', () => new AuthRefreshDiscardedError()],
    ])('zeigt bei einem Refresh-Fehler „%s" kein Modal', async (_label, error) => {
      const { fake, store } = await signedIn();
      fake.refreshError = error();

      expect(await store.recover()).toBe('offline');

      expect(store.sessionExpired()).toBe(false);
      expect(store.user()).not.toBeNull();
    });

    it('raeumt auch dann auf, wenn signOut() wirft', async () => {
      const { fake, store } = await signedIn();
      fake.emitAuthEvent('SIGNED_OUT', null);
      fake.signOutThrows = new Error('Speicher gesperrt');

      await expect(store.endExpiredSession()).resolves.toBeUndefined();

      expect(store.user()).toBeNull();
      expect(store.sessionExpired()).toBe(false);
    });

    it('beendet die abgelaufene Sitzung nur lokal', async () => {
      const { fake, store } = await signedIn();
      fake.emitAuthEvent('SIGNED_OUT', null);

      await store.endExpiredSession();

      expect(fake.signOutScopes).toEqual(['local']);
      expect(store.sessionExpired()).toBe(false);
    });

    it('schreibt in Production nichts in die Konsole, wenn der Refresh scheitert', async () => {
      const fake = new FakeSupabase();
      fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
      fake.refreshError = { message: 'Invalid Refresh Token: Already Used', status: 400 };
      TestBed.configureTestingModule({
        providers: [
          { provide: SUPABASE, useValue: fake.asClient() },
          {
            provide: SUPABASE_CONFIG,
            useValue: { url: 'x', publishableKey: 'y', production: true } as SupabaseConfig,
          },
        ],
      });
      const store = TestBed.inject(SessionStore);
      await store.restore();
      const logged = vi.mocked(console.error);
      logged.mockClear();

      // Der Repository-Weg selbst protokolliert (wie bisher); hier zaehlt nur
      // der Auth-Weg danach.
      try {
        fail({ message: 'JWT expired', code: 'PGRST301' });
      } catch {
        // erwartet
      }
      logged.mockClear();
      await tick();

      expect(store.sessionExpired()).toBe(true);
      expect(logged).not.toHaveBeenCalled();
    });
  });

  describe('Zustimmung zum AV-Vertrag', () => {
    const member = (fake: FakeSupabase): void => {
      fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
      fake.betaAccess = true;
    };

    it('merkt sich eine Zustimmung fuer die Sitzung', async () => {
      const { fake, store } = setup((f) => {
        member(f);
        f.dpaAcceptances = ['1.0'];
      });
      await store.restore();

      expect(await store.hasAcceptedDpa('1.0')).toBe(true);
      expect(await store.hasAcceptedDpa('1.0')).toBe(true);
      expect(fake.dpaReads).toBe(1);
    });

    it('fragt ein „nein" beim naechsten Mal wieder nach', async () => {
      const { fake, store } = setup(member);
      await store.restore();

      expect(await store.hasAcceptedDpa('1.0')).toBe(false);
      // Zugestimmt in einem anderen Tab.
      fake.dpaAcceptances = ['1.0'];
      expect(await store.hasAcceptedDpa('1.0')).toBe(true);
      expect(fake.dpaReads).toBe(2);
    });

    it('speichert die Zustimmung und braucht danach keine Abfrage', async () => {
      const { fake, store } = setup(member);
      await store.restore();

      expect(await store.acceptDpa('1.0')).toBe(true);
      expect(fake.acceptDpaCalls).toEqual(['1.0']);
      expect(await store.hasAcceptedDpa('1.0')).toBe(true);
      expect(fake.dpaReads).toBe(0);
    });

    it('meldet ein gescheitertes Speichern', async () => {
      const { store } = setup((f) => {
        member(f);
        f.acceptDpaError = { message: 'connection reset' };
      });
      await store.restore();

      expect(await store.acceptDpa('1.0')).toBe(false);
    });

    it('verwirft die gemerkte Zustimmung beim Abmelden', async () => {
      const { fake, store } = setup((f) => {
        member(f);
        f.dpaAcceptances = ['1.0'];
      });
      await store.restore();
      await store.hasAcceptedDpa('1.0');

      await store.signOut();
      expect(await store.hasAcceptedDpa('1.0')).toBe(false);

      // Wieder angemeldet: es wird neu gefragt, nicht aus der alten Sitzung geantwortet.
      fake.emitAuthEvent('SIGNED_IN', { id: 'u1', email: 'thorsten@dailyfi.test' });
      fake.dpaAcceptances = [];
      expect(await store.hasAcceptedDpa('1.0')).toBe(false);
      expect(fake.dpaReads).toBe(2);
    });

    it('fragt ohne Session nicht und speichert nichts', async () => {
      const { fake, store } = setup();
      await store.restore();

      expect(await store.hasAcceptedDpa('1.0')).toBe(false);
      expect(await store.acceptDpa('1.0')).toBe(false);
      expect(fake.dpaReads).toBe(0);
      expect(fake.acceptDpaCalls).toEqual([]);
    });
  });
});
