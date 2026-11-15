import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { readInviteCode, rememberInviteCode } from '@lib/auth/domain';
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
    localStorage.clear();
    globalThis.location.hash = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
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

  it('loest den auf /register gemerkten Code ein', async () => {
    rememberInviteCode('DAILYFI-DEV-2');

    const harness = await setup({ query: { code: 'pkce-123' } });

    expect(harness.fake.redeemedCodes).toEqual(['DAILYFI-DEV-2']);
    expect(harness.navigate).toHaveBeenCalledWith(['/week'], { replaceUrl: true });
    // Eingeloest heisst aufgebraucht: der Code liegt danach nicht mehr herum.
    expect(readInviteCode()).toBeNull();
  });

  it('schickt bei ungueltigem Code zur Eingabe zurueck und sagt warum', async () => {
    rememberInviteCode('FALSCH-123');

    const harness = await setup({
      query: { code: 'pkce-123' },
      configure: (fake) => {
        fake.redeemResult = 'invalid';
      },
    });

    expect(harness.navigate).toHaveBeenCalledWith(['/register'], {
      replaceUrl: true,
      queryParams: { reason: 'invalid-code' },
    });
    expect(readInviteCode()).toBeNull();
  });

  it('nennt einen abgelaufenen Link beim Namen', async () => {
    const harness = await setup({
      query: { error: 'access_denied', error_code: 'otp_expired' },
    });

    expect(alertText(harness.element)).toContain('abgelaufen');
    expect(harness.fake.exchangedCodes).toHaveLength(0);
    expect(harness.navigate).not.toHaveBeenCalled();
  });

  it('liest den Fehler auch hinter der Raute', async () => {
    globalThis.location.hash = '#error=access_denied&error_code=otp_expired';

    const harness = await setup({});

    expect(alertText(harness.element)).toContain('abgelaufen');
  });

  it('meldet einen Link ohne Code als unvollstaendig', async () => {
    const harness = await setup({});

    expect(alertText(harness.element)).toContain('unvollständig');
    expect(harness.navigate).not.toHaveBeenCalled();
  });

  it('haelt eine Serverstoerung beim Einloesen vom Code fern', async () => {
    rememberInviteCode('DAILYFI-DEV-2');

    const harness = await setup({
      query: { code: 'pkce-123' },
      configure: (fake) => {
        fake.redeemError = { message: 'connection reset' };
      },
    });

    expect(harness.navigate).toHaveBeenCalledWith(['/register'], {
      replaceUrl: true,
      queryParams: { reason: 'server-error' },
    });
    // Der Code war vielleicht gueltig — er darf die Stoerung ueberleben.
    expect(readInviteCode()).toBe('DAILYFI-DEV-2');
  });

  it('schickt bei gesperrtem Konto zur Eingabe und behaelt den Code', async () => {
    rememberInviteCode('DF-ABCDE-FGHIJ-KLMNO-PQRST');

    const harness = await setup({
      query: { code: 'pkce-123' },
      configure: (fake) => {
        fake.redeemResult = 'locked';
      },
    });

    expect(harness.navigate).toHaveBeenCalledWith(['/register'], {
      replaceUrl: true,
      queryParams: { reason: 'locked' },
    });
    expect(readInviteCode()).toBe('DF-ABCDE-FGHIJ-KLMNO-PQRST');
  });

  it('erklaert den in einem anderen Browser geoeffneten Link', async () => {
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

    expect(alertText(harness.element)).toContain('anderen Browser');
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

  it('bietet bei jedem Fehlschlag einen neuen Anmeldelink an', async () => {
    const harness = await setup({});

    expect(harness.element.querySelector('a[href="/login"]')).not.toBeNull();
  });
});
