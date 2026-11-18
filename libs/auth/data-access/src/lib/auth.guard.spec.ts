import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { CanActivateFn } from '@angular/router';

import { SUPABASE } from '@lib/shared/data-access-supabase';
import { FakeSupabase } from '@lib/shared/data-access-supabase/testing';

import { DPA_VERSION } from '@lib/legal/domain';
import { DataKeyHolder } from '@lib/shared/util-crypto';

import {
  dpaPending,
  guestOnly,
  inviteCodeOnly,
  requireAccount,
  requireDpa,
  requireUnlocked,
  safeReturnUrl,
  vaultLocked,
  vaultMissing,
} from './auth.guard';
import { SessionStore } from './session';

const USER = { id: 'u1', email: 'thorsten@dailyfi.test' };

function setup(configure: (fake: FakeSupabase) => void = () => {}): FakeSupabase {
  const fake = new FakeSupabase();
  configure(fake);

  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: SUPABASE, useValue: fake.asClient() }],
  });

  return fake;
}

/** Guards laufen im Injektionskontext und bekommen zwei Snapshots, die keiner liest. */
async function run(guard: CanActivateFn): Promise<string | true> {
  const result = await TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  );

  if (result instanceof UrlTree) {
    return TestBed.inject(Router).serializeUrl(result);
  }
  expect(result).toBe(true);
  return true;
}

describe('Route-Guards', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('requireAccount', () => {
    it('schickt ohne Session auf die Anmeldung', async () => {
      setup();
      await expect(run(requireAccount)).resolves.toBe('/login');
    });

    it('schickt ohne eingeloesten Code auf die Registrierung', async () => {
      setup((fake) => {
        fake.user = USER;
      });
      await expect(run(requireAccount)).resolves.toBe('/register');
    });

    it('laesst ein freigeschaltetes Konto durch', async () => {
      setup((fake) => {
        fake.user = USER;
        fake.betaAccess = true;
      });
      await expect(run(requireAccount)).resolves.toBe(true);
    });
  });

  describe('guestOnly (/login)', () => {
    it('laesst Gaeste zur Anmeldung', async () => {
      setup();
      await expect(run(guestOnly)).resolves.toBe(true);
    });

    it('schickt ein freigeschaltetes Konto in die Anwendung', async () => {
      setup((fake) => {
        fake.user = USER;
        fake.betaAccess = true;
      });
      await expect(run(guestOnly)).resolves.toBe('/week');
    });

    it('schickt ein Konto ohne Code zur Code-Eingabe statt in die leere Anwendung', async () => {
      setup((fake) => {
        fake.user = USER;
      });
      await expect(run(guestOnly)).resolves.toBe('/register');
    });
  });

  describe('inviteCodeOnly (/register)', () => {
    it('schickt Gaeste zur Anmeldung — ohne Konto gibt es nichts einzuloesen', async () => {
      setup();
      await expect(run(inviteCodeOnly)).resolves.toBe('/login');
    });

    it('laesst ein angemeldetes Konto ohne Code den Code nachtragen', async () => {
      setup((fake) => {
        fake.user = USER;
      });
      await expect(run(inviteCodeOnly)).resolves.toBe(true);
    });

    it('schickt ein freigeschaltetes Konto weiter', async () => {
      setup((fake) => {
        fake.user = USER;
        fake.betaAccess = true;
      });
      await expect(run(inviteCodeOnly)).resolves.toBe('/week');
    });
  });

  describe('requireDpa (/week, /projects, /reports)', () => {
    const member = (fake: FakeSupabase): void => {
      fake.user = USER;
      fake.betaAccess = true;
    };

    /** Mit der angefragten Adresse — der Guard gibt sie als `returnUrl` weiter. */
    async function runAt(url: string): Promise<string | true> {
      const result = await TestBed.runInInjectionContext(() =>
        requireDpa({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
      );
      return result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : true;
    }

    it('schickt ohne Zustimmung auf die Zustimmungsseite, mit Ruecksprung', async () => {
      setup(member);
      await expect(runAt('/projects')).resolves.toBe('/zustimmung?returnUrl=%2Fprojects');
    });

    it('laesst mit Zustimmung zur aktuellen Version durch', async () => {
      setup((fake) => {
        member(fake);
        fake.dpaAcceptances = [DPA_VERSION];
      });
      await expect(runAt('/week')).resolves.toBe(true);
    });

    it('fragt nach einer neuen Version erneut', async () => {
      setup((fake) => {
        member(fake);
        fake.dpaAcceptances = ['0.9'];
      });
      await expect(runAt('/week')).resolves.toBe('/zustimmung?returnUrl=%2Fweek');
    });

    it('schickt ohne Session zur Anmeldung, nicht auf die Zustimmungsseite', async () => {
      setup();
      await expect(runAt('/week')).resolves.toBe('/login');
    });

    it('wertet einen Lesefehler als fehlende Zustimmung', async () => {
      setup((fake) => {
        member(fake);
        fake.dpaAcceptances = [DPA_VERSION];
        fake.dpaReadError = { message: 'connection reset' };
      });
      await expect(runAt('/week')).resolves.toBe('/zustimmung?returnUrl=%2Fweek');
    });
  });

  describe('dpaPending (/zustimmung)', () => {
    async function runWith(query: Record<string, string>): Promise<string | true> {
      const route = { queryParamMap: convertToParamMap(query) } as ActivatedRouteSnapshot;
      const result = await TestBed.runInInjectionContext(() =>
        dpaPending(route, {} as RouterStateSnapshot),
      );
      return result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : true;
    }

    it('zeigt die Seite, solange die Zustimmung fehlt', async () => {
      setup((fake) => {
        fake.user = USER;
        fake.betaAccess = true;
      });
      await expect(runWith({ returnUrl: '/reports' })).resolves.toBe(true);
    });

    it('leitet nach erteilter Zustimmung zum Ziel weiter', async () => {
      setup((fake) => {
        fake.user = USER;
        fake.betaAccess = true;
        fake.dpaAcceptances = [DPA_VERSION];
      });
      await expect(runWith({ returnUrl: '/reports' })).resolves.toBe('/reports');
      await expect(runWith({})).resolves.toBe('/week');
    });
  });

  describe('Datenschluessel (requireUnlocked, vaultMissing, vaultLocked)', () => {
    const PASSKEY_ROW = {
      kind: 'passkey',
      credential_id: 'Y3JlZGVudGlhbC1pZC0x',
      salt: 'c2FsdA==',
      iv: 'aXY=',
      wrapped_key: 'a2V5',
    };
    const member = (fake: FakeSupabase): void => {
      fake.user = USER;
      fake.betaAccess = true;
    };

    async function runGuard(
      guard: CanActivateFn,
      url = '/week',
      query: Record<string, string> = {},
    ): Promise<string | true> {
      const route = { queryParamMap: convertToParamMap(query) } as ActivatedRouteSnapshot;
      const result = await TestBed.runInInjectionContext(() =>
        guard(route, { url } as RouterStateSnapshot),
      );
      return result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : true;
    }

    async function unlock(): Promise<void> {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
      // Erst die Sitzung: ihr Laden wechselt das Konto und leert den Schluessel.
      await TestBed.inject(SessionStore).restore();
      TestBed.inject(DataKeyHolder).set(key);
    }

    it('schickt beim ersten Mal zum Einrichten', async () => {
      setup(member);
      await expect(runGuard(requireUnlocked)).resolves.toBe('/schluessel');
      await expect(runGuard(vaultMissing)).resolves.toBe(true);
      await expect(runGuard(vaultLocked)).resolves.toBe('/schluessel');
    });

    it('schickt mit eingerichtetem Schluessel zum Entsperren, mit Ruecksprung', async () => {
      setup((fake) => {
        member(fake);
        fake.userKeys = [PASSKEY_ROW];
      });
      await expect(runGuard(requireUnlocked, '/reports')).resolves.toBe(
        '/entsperren?returnUrl=%2Freports',
      );
      await expect(runGuard(vaultMissing)).resolves.toBe('/entsperren');
      await expect(runGuard(vaultLocked)).resolves.toBe(true);
    });

    it('laesst entsperrt durch und fuehrt von den Schluesselseiten weiter', async () => {
      setup((fake) => {
        member(fake);
        fake.userKeys = [PASSKEY_ROW];
      });
      await unlock();

      await expect(runGuard(requireUnlocked)).resolves.toBe(true);
      await expect(runGuard(vaultMissing)).resolves.toBe('/week');
      await expect(runGuard(vaultLocked, '/entsperren', { returnUrl: '/projects' })).resolves.toBe(
        '/projects',
      );
    });

    it('bietet bei einem Lesefehler kein neues Einrichten an', async () => {
      // Ein zweiter Schluessel machte die mit dem ersten verschluesselten Daten unlesbar.
      setup((fake) => {
        member(fake);
        fake.userKeysReadError = { message: 'connection reset' };
      });
      await expect(runGuard(requireUnlocked)).resolves.toBe('/entsperren?returnUrl=%2Fweek');
      await expect(runGuard(vaultMissing)).resolves.toBe('/entsperren');
    });
  });

  describe('safeReturnUrl', () => {
    it('nimmt nur Pfade innerhalb der Anwendung', () => {
      expect(safeReturnUrl('/projects')).toBe('/projects');
      expect(safeReturnUrl('/week?woche=2026-11-16')).toBe('/week?woche=2026-11-16');
      for (const raw of [null, '', 'https://example.com', '//example.com', '/\\example.com']) {
        expect(safeReturnUrl(raw), String(raw)).toBe('/week');
      }
    });

    it('fuehrt nicht im Kreis zurueck auf die Zustimmungsseite', () => {
      expect(safeReturnUrl('/zustimmung?returnUrl=%2Fweek')).toBe('/week');
      expect(safeReturnUrl('/zustimmung/')).toBe('/week');
      expect(safeReturnUrl('/zustimmung;x=1')).toBe('/week');
      expect(safeReturnUrl('/%7Austimmung')).toBe('/week');
      expect(safeReturnUrl('/zustimmungen')).toBe('/zustimmungen');
    });

    it('fuehrt auch nicht zurueck auf Einrichten oder Entsperren', () => {
      expect(safeReturnUrl('/entsperren?returnUrl=%2Fweek')).toBe('/week');
      expect(safeReturnUrl('/Entsperren;x')).toBe('/week');
      expect(safeReturnUrl('/schluessel')).toBe('/week');
    });
  });
});
