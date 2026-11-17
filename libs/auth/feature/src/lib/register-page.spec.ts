import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { SessionStore } from '@lib/auth/data-access';
import { readDpaConsent, readInviteCode, rememberInviteCode } from '@lib/auth/domain';
import { DPA_VERSION } from '@lib/legal/domain';
import { SUPABASE } from '@lib/shared/data-access-supabase';
import { FakeSupabase } from '@lib/shared/data-access-supabase/testing';

import { RegisterPage } from './register-page';

const USER = { id: 'u1', email: 'thorsten@dailyfi.test' };

interface Harness {
  fixture: ComponentFixture<RegisterPage>;
  element: HTMLElement;
  fake: FakeSupabase;
  navigate: ReturnType<typeof vi.spyOn>;
  type(selector: string, value: string): void;
  submit(): Promise<void>;
}

async function setup(options: {
  configure?: (fake: FakeSupabase) => void;
  query?: Record<string, string>;
  /** Haken beim AV-Vertrag setzen. Standard: ja — die meisten Tests pruefen anderes. */
  acceptDpa?: boolean;
}): Promise<Harness> {
  const fake = new FakeSupabase();
  options.configure?.(fake);

  await TestBed.configureTestingModule({
    imports: [RegisterPage],
    providers: [
      provideRouter([]),
      { provide: SUPABASE, useValue: fake.asClient() },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(options.query ?? {}) } },
      },
    ],
  }).compileComponents();

  // Der Guard hat die Session gelesen, bevor die Seite entsteht.
  await TestBed.inject(SessionStore).restore();

  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(RegisterPage);
  fixture.detectChanges();
  const element: HTMLElement = fixture.nativeElement;

  if (options.acceptDpa ?? true) {
    element.querySelector<HTMLInputElement>('#register-dpa')!.click();
    fixture.detectChanges();
  }

  return {
    fixture,
    element,
    fake,
    navigate,
    type(selector: string, value: string): void {
      const input = element.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    },
    async submit(): Promise<void> {
      element.querySelector('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();
    },
  };
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('ohne Session', () => {
    it('merkt sich den Code und fordert einen Bestaetigungslink an', async () => {
      const harness = await setup({});

      harness.type('#register-code', 'DAILYFI-DEV-2');
      harness.type('#register-email', 'neu@dailyfi.test');
      await harness.submit();

      expect(harness.fake.otpRequests).toEqual([
        {
          email: 'neu@dailyfi.test',
          shouldCreateUser: true,
          emailRedirectTo: expect.stringMatching(/\/auth\/callback$/),
          // Reist mit, damit `before_user_created` den Code pruefen kann,
          // bevor ein Konto entsteht.
          inviteCode: 'DAILYFI-DEV-2',
        },
      ]);
      expect(readInviteCode('neu@dailyfi.test')).toBe('DAILYFI-DEV-2');
      expect(harness.element.querySelector('[role="status"]')?.textContent).toContain(
        'neu@dailyfi.test',
      );
    });

    it('merkt sich die Zustimmung zum AV-Vertrag bis zum Ruecksprung', async () => {
      const harness = await setup({});

      harness.type('#register-code', 'DAILYFI-DEV-2');
      harness.type('#register-email', 'neu@dailyfi.test');
      await harness.submit();

      // Speichern geht erst mit Session und eingeloestem Code (auth/callback).
      expect(harness.fake.acceptDpaCalls).toEqual([]);
      expect(readDpaConsent('neu@dailyfi.test')).toBe(DPA_VERSION);
    });

    it('verlangt den Haken beim AV-Vertrag, ohne den Server zu fragen', async () => {
      const harness = await setup({ acceptDpa: false });

      harness.type('#register-code', 'DAILYFI-DEV-2');
      harness.type('#register-email', 'neu@dailyfi.test');
      await harness.submit();

      expect(harness.fake.otpRequests).toHaveLength(0);
      expect(readDpaConsent('neu@dailyfi.test')).toBeNull();
      const box = harness.element.querySelector<HTMLInputElement>('#register-dpa')!;
      expect(box.getAttribute('aria-invalid')).toBe('true');
      expect(box.getAttribute('aria-describedby')).toBe('register-dpa-error register-dpa-links');
      expect(harness.element.querySelector('#register-dpa-error')?.textContent).toContain(
        'AV-Vertrag',
      );
    });

    it('nennt Version und Datum des AV-Vertrags und verlinkt ihn in einem neuen Tab', async () => {
      const harness = await setup({});

      const label = harness.element.querySelector('label[for="register-dpa"]')!;
      expect(label.textContent).toContain(`Version ${DPA_VERSION}`);
      // Kein Link im Label: er waere Klickziel der Checkbox und Teil ihres Namens.
      expect(label.querySelector('a')).toBeNull();

      const box = harness.element.querySelector<HTMLInputElement>('#register-dpa')!;
      const links = harness.element.querySelector(`#${box.getAttribute('aria-describedby')}`)!;
      for (const href of ['/avv', '/datenschutz']) {
        const link = links.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!;
        expect(link.target).toBe('_blank');
        expect(link.rel).toContain('noopener');
      }
      expect(links.textContent).toContain('neuem Tab');
    });

    it('setzt ohne Haken den Fokus auf die Checkbox', async () => {
      const harness = await setup({ acceptDpa: false });
      document.body.appendChild(harness.element);

      harness.type('#register-code', 'DAILYFI-DEV-2');
      harness.type('#register-email', 'neu@dailyfi.test');
      await harness.submit();

      expect(document.activeElement).toBe(harness.element.querySelector('#register-dpa'));
      harness.element.remove();
    });

    it('nimmt den Fehler am Feld mit dem Haken sofort weg', async () => {
      const harness = await setup({ acceptDpa: false });

      await harness.submit();
      harness.element.querySelector<HTMLInputElement>('#register-dpa')!.click();
      harness.fixture.detectChanges();

      const box = harness.element.querySelector<HTMLInputElement>('#register-dpa')!;
      expect(box.hasAttribute('aria-invalid')).toBe(false);
      expect(harness.element.querySelector('#register-dpa-error')).toBeNull();
    });

    it('sagt, dass der Code sofort geprueft wird', async () => {
      const harness = await setup({});

      expect(harness.element.querySelector('#register-email-hint')?.textContent).toContain(
        'sofort',
      );
    });

    it('zeigt einen vom Server abgewiesenen Code sofort an und merkt ihn nicht', async () => {
      const harness = await setup({
        configure: (fake) => {
          fake.otpError = {
            message: 'Einladungscode ungueltig oder bereits verwendet.',
            status: 403,
          };
        },
      });

      harness.type('#register-code', 'ERFUNDEN-999999');
      harness.type('#register-email', 'fremd@example.com');
      await harness.submit();

      expect(harness.element.querySelector('[role="alert"]')?.textContent).toContain(
        'gilt nicht oder wurde bereits verwendet',
      );
      expect(harness.element.querySelector('form')).not.toBeNull();
      expect(readInviteCode('fremd@example.com')).toBeNull();
    });

    it('merkt sich nichts, wenn die Mail nicht rausgeht', async () => {
      const harness = await setup({
        configure: (fake) => {
          fake.otpError = { message: 'smtp down', status: 500 };
        },
      });

      harness.type('#register-code', 'DAILYFI-DEV-2');
      harness.type('#register-email', 'neu@dailyfi.test');
      await harness.submit();

      expect(readInviteCode('neu@dailyfi.test')).toBeNull();
      expect(harness.element.querySelector('[role="alert"]')?.textContent).toContain(
        'nicht verschickt',
      );
    });

    it('weist einen zu kurzen Code ab, ohne den Server zu fragen', async () => {
      const harness = await setup({});

      harness.type('#register-code', 'ABC');
      harness.type('#register-email', 'neu@dailyfi.test');
      await harness.submit();

      expect(harness.fake.otpRequests).toHaveLength(0);
      expect(harness.element.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('nennt bei zwei leeren Feldern auch beide', async () => {
      const harness = await setup({});

      await harness.submit();

      const message = harness.element.querySelector('[role="alert"]')?.textContent ?? '';
      expect(message).toContain('Einladungscode');
      expect(message).toContain('E-Mail-Adresse');
      expect(harness.fake.otpRequests).toHaveLength(0);
    });

    it('verdrahtet die Fehlermeldung mit den Feldern', async () => {
      const harness = await setup({});

      await harness.submit();

      const code = harness.element.querySelector<HTMLInputElement>('#register-code')!;
      expect(code.getAttribute('aria-invalid')).toBe('true');
      expect(code.getAttribute('aria-describedby')).toContain('register-error');
      expect(harness.element.querySelector('#register-error')).not.toBeNull();
    });
  });

  describe('mit Session, ohne Freischaltung', () => {
    const signedIn = (fake: FakeSupabase): void => {
      fake.user = USER;
    };

    it('fragt nur noch den Code ab und nennt das angemeldete Konto', async () => {
      const harness = await setup({ configure: signedIn });

      expect(harness.element.querySelector('#register-email')).toBeNull();
      expect(harness.element.textContent).toContain('thorsten@dailyfi.test');
    });

    it('loest den Code ein und geht in die Anwendung', async () => {
      const harness = await setup({ configure: signedIn });

      harness.type('#register-code', 'DAILYFI-DEV-2');
      await harness.submit();

      expect(harness.fake.redeemedCodes).toEqual(['DAILYFI-DEV-2']);
      expect(harness.navigate).toHaveBeenCalledWith(['/week']);
    });

    it('speichert die Zustimmung zum AV-Vertrag nach dem Einloesen', async () => {
      const harness = await setup({ configure: signedIn });

      harness.type('#register-code', 'DAILYFI-DEV-2');
      await harness.submit();

      expect(harness.fake.acceptDpaCalls).toEqual([DPA_VERSION]);
      expect(harness.fake.dpaAcceptances).toEqual([DPA_VERSION]);
    });

    it('geht auch weiter, wenn das Speichern der Zustimmung scheitert', async () => {
      // Kein Sonderweg: `requireDpa` schickt dann auf die Zustimmungsseite.
      const harness = await setup({
        configure: (fake) => {
          signedIn(fake);
          fake.acceptDpaError = { message: 'connection reset' };
        },
      });

      harness.type('#register-code', 'DAILYFI-DEV-2');
      await harness.submit();

      expect(harness.fake.dpaAcceptances).toEqual([]);
      expect(harness.navigate).toHaveBeenCalledWith(['/week']);
    });

    it('loest ohne Haken beim AV-Vertrag nichts ein', async () => {
      const harness = await setup({ configure: signedIn, acceptDpa: false });

      harness.type('#register-code', 'DAILYFI-DEV-2');
      await harness.submit();

      expect(harness.fake.redeemedCodes).toEqual([]);
      expect(harness.fake.acceptDpaCalls).toEqual([]);
      expect(harness.navigate).not.toHaveBeenCalled();
    });

    it('nennt die Sperre nach zu vielen Fehlversuchen', async () => {
      const harness = await setup({
        configure: (fake) => {
          signedIn(fake);
          fake.redeemResult = 'locked';
        },
      });
      rememberInviteCode('DF-ABCDE-FGHIJ-KLMNO-PQRST', USER.email);

      harness.type('#register-code', 'DF-ABCDE-FGHIJ-KLMNO-PQRST');
      await harness.submit();

      expect(harness.navigate).not.toHaveBeenCalled();
      expect(harness.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Zu viele Fehlversuche',
      );
      // Der Code ist nicht das Problem — er bleibt liegen.
      expect(readInviteCode(USER.email)).toBe('DF-ABCDE-FGHIJ-KLMNO-PQRST');
    });

    it('bleibt bei ungueltigem Code stehen und sagt warum', async () => {
      const harness = await setup({
        configure: (fake) => {
          signedIn(fake);
          fake.redeemResult = 'invalid';
        },
      });

      harness.type('#register-code', 'FALSCH-123');
      await harness.submit();

      expect(harness.navigate).not.toHaveBeenCalled();
      expect(harness.element.querySelector('[role="alert"]')?.textContent).toContain(
        'gilt nicht oder wurde bereits verwendet',
      );
    });

    it('nimmt ein bereits freigeschaltetes Konto trotzdem an', async () => {
      const harness = await setup({
        configure: (fake) => {
          signedIn(fake);
          fake.redeemResult = 'already_redeemed';
        },
      });

      harness.type('#register-code', 'DAILYFI-DEV-2');
      await harness.submit();

      expect(harness.navigate).toHaveBeenCalledWith(['/week']);
    });

    it('behaelt den Code, wenn der Server beim Einloesen stolpert', async () => {
      const harness = await setup({
        configure: (fake) => {
          signedIn(fake);
          fake.redeemError = { message: 'connection reset' };
        },
      });
      rememberInviteCode('DAILYFI-DEV-2', USER.email);

      harness.type('#register-code', 'DAILYFI-DEV-2');
      await harness.submit();

      expect(harness.navigate).not.toHaveBeenCalled();
      expect(harness.element.querySelector('[role="alert"]')?.textContent).toContain(
        'nicht geprüft werden',
      );
      // Die Stoerung sagt nichts ueber den Code — er darf nicht verfallen.
      expect(readInviteCode(USER.email)).toBe('DAILYFI-DEV-2');
    });

    it('vergisst den Code, wenn er wirklich ungueltig ist', async () => {
      const harness = await setup({
        configure: (fake) => {
          signedIn(fake);
          fake.redeemResult = 'invalid';
        },
      });
      rememberInviteCode('FALSCH-123', USER.email);

      harness.type('#register-code', 'FALSCH-123');
      await harness.submit();

      expect(readInviteCode(USER.email)).toBeNull();
    });

    it('traegt den Code nach einer Serverstoerung wieder ein', async () => {
      rememberInviteCode('DAILYFI-DEV-2', USER.email);

      const harness = await setup({
        configure: signedIn,
        query: { reason: 'server-error' },
      });

      expect(harness.element.querySelector<HTMLInputElement>('#register-code')!.value).toBe(
        'DAILYFI-DEV-2',
      );
      expect(harness.element.querySelector('[role="alert"]')?.textContent).toContain(
        'noch im Feld',
      );
    });

    it('bietet einen Ausweg, wenn das falsche Konto angemeldet ist', async () => {
      const harness = await setup({ configure: signedIn });

      harness.element.querySelector<HTMLButtonElement>('.footer button')!.click();
      await harness.fixture.whenStable();

      expect(harness.fake.signOutCalls).toBe(1);
      expect(harness.navigate).toHaveBeenCalledWith(['/login']);
    });
  });

  it('erklaert, warum der Ruecksprung hier gelandet ist', async () => {
    const harness = await setup({
      configure: (fake) => {
        fake.user = USER;
      },
      query: { reason: 'invalid-code' },
    });

    expect(harness.element.querySelector('[role="alert"]')?.textContent).toContain(
      'gilt nicht oder wurde bereits verwendet',
    );
  });

  it('verlinkt unter der Karte Impressum, Datenschutz und AV-Vertrag', async () => {
    const harness = await setup({});

    const nav = harness.element.querySelector('nav[aria-label="Rechtliches"]')!;
    expect(
      [...nav.querySelectorAll<HTMLAnchorElement>('a')].map((link) => link.getAttribute('href')),
    ).toEqual(['/impressum', '/datenschutz', '/avv']);
    // Ausserhalb der Karte, damit sie nicht zum Formular gehoeren.
    expect(nav.closest('section')).toBeNull();
  });
});
