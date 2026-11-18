import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { SessionStore } from '@lib/auth/data-access';
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
  type(value: string): void;
  submit(): Promise<void>;
}

async function setup(
  options: {
    configure?: (fake: FakeSupabase) => void;
    /** Haken beim AV-Vertrag setzen. Standard: ja — die meisten Tests pruefen anderes. */
    acceptDpa?: boolean;
  } = {},
): Promise<Harness> {
  const fake = new FakeSupabase();
  // Hierher kommt nur, wer angemeldet ist (`inviteCodeOnly`).
  fake.user = USER;
  options.configure?.(fake);

  await TestBed.configureTestingModule({
    imports: [RegisterPage],
    providers: [provideRouter([]), { provide: SUPABASE, useValue: fake.asClient() }],
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
    type(value: string): void {
      const input = element.querySelector<HTMLInputElement>('#register-code')!;
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

function alertText(element: HTMLElement): string {
  return element.querySelector('[role="alert"]')?.textContent ?? '';
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fragt nur den Code ab und nennt das angemeldete Konto', async () => {
    const harness = await setup();

    expect(harness.element.querySelector('input[type="email"]')).toBeNull();
    expect(harness.element.textContent).toContain('thorsten@dailyfi.test');
  });

  it('loest den Code ein und geht in die Anwendung', async () => {
    const harness = await setup();

    harness.type('  DAILYFI-DEV-2 ');
    await harness.submit();

    expect(harness.fake.redeemedCodes).toEqual(['DAILYFI-DEV-2']);
    expect(harness.navigate).toHaveBeenCalledWith(['/week']);
  });

  it('speichert die Zustimmung zum AV-Vertrag nach dem Einloesen', async () => {
    const harness = await setup();

    harness.type('DAILYFI-DEV-2');
    await harness.submit();

    expect(harness.fake.acceptDpaCalls).toEqual([DPA_VERSION]);
    expect(harness.fake.dpaAcceptances).toEqual([DPA_VERSION]);
  });

  it('geht auch weiter, wenn das Speichern der Zustimmung scheitert', async () => {
    // Kein Sonderweg: `requireDpa` schickt dann auf die Zustimmungsseite.
    const harness = await setup({
      configure: (fake) => {
        fake.acceptDpaError = { message: 'connection reset' };
      },
    });

    harness.type('DAILYFI-DEV-2');
    await harness.submit();

    expect(harness.fake.dpaAcceptances).toEqual([]);
    expect(harness.navigate).toHaveBeenCalledWith(['/week']);
  });

  describe('Zustimmung zum AV-Vertrag', () => {
    it('loest ohne Haken nichts ein und markiert die Checkbox', async () => {
      const harness = await setup({ acceptDpa: false });

      harness.type('DAILYFI-DEV-2');
      await harness.submit();

      expect(harness.fake.redeemedCodes).toEqual([]);
      expect(harness.fake.acceptDpaCalls).toEqual([]);
      expect(harness.navigate).not.toHaveBeenCalled();
      const box = harness.element.querySelector<HTMLInputElement>('#register-dpa')!;
      expect(box.getAttribute('aria-invalid')).toBe('true');
      expect(box.getAttribute('aria-describedby')).toBe('register-dpa-error register-dpa-links');
      expect(harness.element.querySelector('#register-dpa-error')?.textContent).toContain(
        'AV-Vertrag',
      );
    });

    it('nennt Version und Datum des AV-Vertrags und verlinkt ihn in einem neuen Tab', async () => {
      const harness = await setup();

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

      harness.type('DAILYFI-DEV-2');
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

    it('nennt bei leerem Formular Code und Haken zugleich', async () => {
      const harness = await setup({ acceptDpa: false });

      await harness.submit();

      expect(harness.element.querySelector('#register-error')?.textContent).toContain(
        'Einladungscode',
      );
      expect(harness.element.querySelector('#register-dpa-error')).not.toBeNull();
    });
  });

  it('weist einen zu kurzen Code ab, ohne den Server zu fragen', async () => {
    const harness = await setup();

    harness.type('ABC');
    await harness.submit();

    expect(harness.fake.redeemedCodes).toEqual([]);
    expect(alertText(harness.element)).toContain('Einladungscode');
  });

  it('verdrahtet die Fehlermeldung mit dem Feld', async () => {
    const harness = await setup();

    await harness.submit();

    const code = harness.element.querySelector<HTMLInputElement>('#register-code')!;
    expect(code.getAttribute('aria-invalid')).toBe('true');
    expect(code.getAttribute('aria-describedby')).toBe('register-error');
    expect(harness.element.querySelector('#register-error')).not.toBeNull();
  });

  it('setzt bei ungueltigem Code den Fokus ins Feld', async () => {
    const harness = await setup({
      configure: (fake) => {
        fake.redeemResult = 'invalid';
      },
    });
    document.body.appendChild(harness.element);

    harness.type('FALSCH-123');
    await harness.submit();

    expect(document.activeElement).toBe(harness.element.querySelector('#register-code'));
    harness.element.remove();
  });

  it('nennt die Sperre nach zu vielen Fehlversuchen', async () => {
    const harness = await setup({
      configure: (fake) => {
        fake.redeemResult = 'locked';
      },
    });

    harness.type('DF-ABCDE-FGHIJ-KLMNO-PQRST');
    await harness.submit();

    expect(harness.navigate).not.toHaveBeenCalled();
    expect(alertText(harness.element)).toContain('Zu viele Fehlversuche');
  });

  it('bleibt bei ungueltigem Code stehen und sagt warum', async () => {
    const harness = await setup({
      configure: (fake) => {
        fake.redeemResult = 'invalid';
      },
    });

    harness.type('FALSCH-123');
    await harness.submit();

    expect(harness.navigate).not.toHaveBeenCalled();
    expect(alertText(harness.element)).toContain('gilt nicht oder wurde bereits verwendet');
  });

  it('nimmt ein bereits freigeschaltetes Konto trotzdem an', async () => {
    const harness = await setup({
      configure: (fake) => {
        fake.redeemResult = 'already_redeemed';
      },
    });

    harness.type('DAILYFI-DEV-2');
    await harness.submit();

    expect(harness.navigate).toHaveBeenCalledWith(['/week']);
  });

  it('laesst den Code nach einer Serverstoerung im Feld stehen', async () => {
    const harness = await setup({
      configure: (fake) => {
        fake.redeemError = { message: 'connection reset' };
      },
    });

    harness.type('DAILYFI-DEV-2');
    await harness.submit();

    expect(harness.navigate).not.toHaveBeenCalled();
    expect(alertText(harness.element)).toContain('nicht geprüft werden');
    expect(harness.element.querySelector<HTMLInputElement>('#register-code')!.value).toBe(
      'DAILYFI-DEV-2',
    );
  });

  it('bietet einen Ausweg, wenn das falsche Konto angemeldet ist', async () => {
    const harness = await setup();

    harness.element.querySelector<HTMLButtonElement>('.footer button')!.click();
    await harness.fixture.whenStable();

    expect(harness.fake.signOutCalls).toBe(1);
    expect(harness.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('verlinkt unter der Karte Impressum, Datenschutz und AV-Vertrag', async () => {
    const harness = await setup();

    const nav = harness.element.querySelector('nav[aria-label="Rechtliches"]')!;
    expect(
      [...nav.querySelectorAll<HTMLAnchorElement>('a')].map((link) => link.getAttribute('href')),
    ).toEqual(['/impressum', '/datenschutz', '/avv']);
    // Ausserhalb der Karte, damit sie nicht zum Formular gehoeren.
    expect(nav.closest('section')).toBeNull();
  });
});
