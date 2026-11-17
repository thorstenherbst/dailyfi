import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Title } from '@angular/platform-browser';

import { SessionStore } from '@lib/auth/data-access';
import { SUPABASE } from '@lib/shared/data-access-supabase';
import { FakeSupabase } from '@lib/shared/data-access-supabase/testing';

import { routes } from './app.routes';

const LEGAL = [
  ['/impressum', 'Impressum — Dailyfi', 'Impressum'],
  ['/datenschutz', 'Datenschutz — Dailyfi', 'Datenschutzerklärung'],
  ['/avv', 'AV-Vertrag — Dailyfi', 'Vertrag zur Auftragsverarbeitung'],
] as const;

async function setup(signedIn: boolean): Promise<RouterTestingHarness> {
  const fake = new FakeSupabase();
  if (signedIn) {
    fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
    fake.betaAccess = true;
  }
  TestBed.configureTestingModule({
    providers: [provideRouter(routes), { provide: SUPABASE, useValue: fake.asClient() }],
  });
  await TestBed.inject(SessionStore).restore();
  return RouterTestingHarness.create();
}

describe('Routen der Rechtstexte', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(LEGAL)('%s ist ohne Anmeldung erreichbar', async (url, title, heading) => {
    const harness = await setup(false);

    await harness.navigateByUrl(url);

    // Kein Guard schickt zur Anmeldung, die Wildcard greift nicht.
    expect(TestBed.inject(Router).url).toBe(url);
    expect(TestBed.inject(Title).getTitle()).toBe(title);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(heading);
  });

  it.each(LEGAL)('%s ist auch angemeldet erreichbar', async (url, _title, heading) => {
    const harness = await setup(true);

    await harness.navigateByUrl(url);

    expect(TestBed.inject(Router).url).toBe(url);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(heading);
  });

  it('stehen vor der Wildcard', () => {
    const paths = routes.map((route) => route.path);
    const wildcard = paths.indexOf('**');

    for (const path of ['impressum', 'datenschutz', 'avv']) {
      expect(paths.indexOf(path)).toBeGreaterThan(-1);
      expect(paths.indexOf(path)).toBeLessThan(wildcard);
    }
  });
});
