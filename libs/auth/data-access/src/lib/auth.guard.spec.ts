import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { CanActivateFn } from '@angular/router';

import { SUPABASE } from '@lib/shared/data-access-supabase';
import { FakeSupabase } from '@lib/shared/data-access-supabase/testing';

import { guestOnly, inviteCodeOnly, requireAccount } from './auth.guard';

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
});
