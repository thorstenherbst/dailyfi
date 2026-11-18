import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { SUPABASE } from '@lib/shared/data-access-supabase';
import { FakeSupabase } from '@lib/shared/data-access-supabase/testing';

import { CallbackPage } from './callback-page';

interface Harness {
  fixture: ComponentFixture<CallbackPage>;
  element: HTMLElement;
  fake: FakeSupabase;
  navigate: ReturnType<typeof vi.spyOn>;
}

async function setup(options: {
  query?: Record<string, string>;
  configure?: (fake: FakeSupabase) => void;
}): Promise<Harness> {
  const fake = new FakeSupabase();
  options.configure?.(fake);

  await TestBed.configureTestingModule({
    imports: [CallbackPage],
    providers: [
      provideRouter([]),
      { provide: SUPABASE, useValue: fake.asClient() },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(options.query ?? {}) } },
      },
    ],
  }).compileComponents();

  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(CallbackPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, element: fixture.nativeElement, fake, navigate };
}

function alertText(element: HTMLElement): string {
  return element.querySelector('[role="alert"]')?.textContent ?? '';
}

describe('CallbackPage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.location.hash = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.location.hash = '';
  });

  it('tauscht den Code und geht in die Anwendung', async () => {
    const harness = await setup({
      query: { code: 'pkce-123' },
      configure: (fake) => {
        fake.betaAccess = true;
      },
    });

    expect(harness.fake.exchangedCodes).toEqual(['pkce-123']);
    expect(harness.navigate).toHaveBeenCalledWith(['/week'], { replaceUrl: true });
  });

  it('schickt ohne Freischaltung zur Code-Eingabe', async () => {
    const harness = await setup({ query: { code: 'pkce-123' } });

    expect(harness.navigate).toHaveBeenCalledWith(['/register'], { replaceUrl: true });
  });

  it('loest selbst keinen Code ein und speichert keine Zustimmung', async () => {
    // Beides geschieht erst auf /register bzw. der Zustimmungsseite.
    const harness = await setup({ query: { code: 'pkce-123' } });

    expect(harness.fake.redeemedCodes).toEqual([]);
    expect(harness.fake.acceptDpaCalls).toEqual([]);
  });

  it('meldet eine abgebrochene Anmeldung bei Apple', async () => {
    const harness = await setup({
      query: { error: 'access_denied', error_description: 'user cancelled' },
    });

    expect(alertText(harness.element)).toContain('abgebrochen');
    expect(harness.fake.exchangedCodes).toHaveLength(0);
    expect(harness.navigate).not.toHaveBeenCalled();
  });

  it('liest den Fehler auch hinter der Raute', async () => {
    globalThis.location.hash = '#error=server_error&error_code=unexpected_failure';

    const harness = await setup({});

    expect(alertText(harness.element)).toContain('nicht geklappt');
  });

  it('nennt einen vom Server abgewiesenen Ruecksprung nicht abgebrochen', async () => {
    const harness = await setup({
      query: { error: 'server_error', error_description: 'Error running hook URI' },
    });

    expect(alertText(harness.element)).toContain('nicht geklappt');
    expect(alertText(harness.element)).not.toContain('abgebrochen');
  });

  it('meldet einen Ruecksprung ohne Code als unvollstaendig', async () => {
    const harness = await setup({});

    expect(alertText(harness.element)).toContain('unvollständig');
    expect(harness.navigate).not.toHaveBeenCalled();
  });

  it('meldet einen fehlenden Verifier ohne Session', async () => {
    const harness = await setup({
      query: { code: 'pkce-123' },
      configure: (fake) => {
        fake.exchangeError = {
          message: 'PKCE code verifier not found in storage',
          code: 'pkce_code_verifier_not_found',
          status: 400,
        };
      },
    });

    expect(alertText(harness.element)).toContain('nicht abgeschlossen');
    expect(harness.navigate).not.toHaveBeenCalled();
  });

  it('schickt bei der Zurueck-Taste weiter, statt einen anderen Browser zu behaupten', async () => {
    // Nach dem ersten Tausch ist der Verifier weg. Wer zurueckgeht, landet
    // wieder hier — angemeldet.
    const harness = await setup({
      query: { code: 'pkce-123' },
      configure: (fake) => {
        fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
        fake.betaAccess = true;
        fake.exchangeError = {
          message: 'PKCE code verifier not found in storage',
          code: 'pkce_code_verifier_not_found',
          status: 400,
        };
      },
    });

    expect(alertText(harness.element)).toBe('');
    expect(harness.navigate).toHaveBeenCalledWith(['/week'], { replaceUrl: true });
  });

  it('schickt bei der Zurueck-Taste ohne Freischaltung zur Code-Eingabe', async () => {
    const harness = await setup({
      query: { code: 'pkce-123' },
      configure: (fake) => {
        fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
        fake.exchangeError = {
          message: 'PKCE code verifier not found in storage',
          code: 'pkce_code_verifier_not_found',
          status: 400,
        };
      },
    });

    expect(harness.navigate).toHaveBeenCalledWith(['/register'], { replaceUrl: true });
  });

  it('fuehrt bei jedem Fehlschlag zurueck zur Anmeldung', async () => {
    const harness = await setup({});

    expect(harness.element.querySelector('a[href="/login"]')).not.toBeNull();
  });
});
