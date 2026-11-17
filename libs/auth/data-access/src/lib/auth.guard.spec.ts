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

import {
  dpaPending,
  guestOnly,
  inviteCodeOnly,
  requireAccount,
  requireDpa,
  safeReturnUrl,
} from './auth.guard';

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
    it('laesst Gaeste registrieren', async () => {
      setup();
      await expect(run(inviteCodeOnly)).resolves.toBe(true);
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
      expect(safeReturnUrl('/zustimmung/')).toBe('/week');
      expect(safeReturnUrl('/zustimmung;x=1')).toBe('/week');
      expect(safeReturnUrl('/%7Austimmung')).toBe('/week');
      expect(safeReturnUrl('/zustimmungen')).toBe('/zustimmungen');
    });
  });
});
