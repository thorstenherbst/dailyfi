import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  readDpaConsent,
  readInviteCode,
  rememberDpaConsent,
  rememberInviteCode,
} from '@lib/auth/domain';
import { SUPABASE } from '@lib/shared/data-access-supabase';
import { FakeSupabase } from '@lib/shared/data-access-supabase/testing';

import { LoginPage } from './login-page';

interface Harness {
  fixture: ComponentFixture<LoginPage>;
  element: HTMLElement;
  fake: FakeSupabase;
  type(value: string): void;
  submit(): Promise<void>;
}

async function setup(configure: (fake: FakeSupabase) => void = () => {}): Promise<Harness> {
  const fake = new FakeSupabase();
  configure(fake);

  await TestBed.configureTestingModule({
    imports: [LoginPage],
    providers: [provideRouter([]), { provide: SUPABASE, useValue: fake.asClient() }],
  }).compileComponents();

  const fixture = TestBed.createComponent(LoginPage);
  fixture.detectChanges();
  const element: HTMLElement = fixture.nativeElement;

  return {
    fixture,
    element,
    fake,
    type(value: string): void {
      const input = element.querySelector<HTMLInputElement>('#login-email')!;
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

describe('LoginPage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fordert einen Anmeldelink an und bestaetigt als Text', async () => {
    const harness = await setup();

    harness.type('thorsten@dailyfi.test');
    await harness.submit();

    expect(harness.fake.otpRequests).toHaveLength(1);
    expect(harness.fake.otpRequests[0].email).toBe('thorsten@dailyfi.test');
    // Kein Konto anlegen: /login ist kein zweiter Registrierungsweg.
    expect(harness.fake.otpRequests[0].shouldCreateUser).toBe(false);

    expect(harness.element.querySelector('.sent')?.textContent).toContain('thorsten@dailyfi.test');
    expect(harness.element.querySelector('form')).toBeNull();
  });

  it('verwirft beim Anfordern Einladungscode und Zustimmung einer frueheren Registrierung', async () => {
    rememberInviteCode('DAILYFI-DEV-2', 'thorsten@dailyfi.test');
    rememberDpaConsent('1.0', 'thorsten@dailyfi.test');
    const harness = await setup();

    harness.type('thorsten@dailyfi.test');
    await harness.submit();

    // Auch bei derselben Adresse: wer sich anmeldet, registriert sich nicht.
    expect(readInviteCode('thorsten@dailyfi.test')).toBeNull();
    expect(readDpaConsent('thorsten@dailyfi.test')).toBeNull();
  });

  it('antwortet bei unbekannter Adresse genauso wie bei bekannter', async () => {
    const known = await setup();
    known.type('thorsten@dailyfi.test');
    await known.submit();
    const knownText = known.element.querySelector('.sent')!.textContent!;

    TestBed.resetTestingModule();

    const unknown = await setup((fake) => {
      fake.otpError = { message: 'Signups not allowed for otp', status: 422 };
    });
    unknown.type('fremd@example.com');
    await unknown.submit();
    const unknownText = unknown.element.querySelector('.sent')!.textContent!;

    expect(unknownText.replace('fremd@example.com', 'X')).toBe(
      knownText.replace('thorsten@dailyfi.test', 'X'),
    );
    expect(unknown.element.querySelector('[role="alert"]')).toBeNull();
  });

  it('weist eine unvollstaendige Adresse ab, ohne den Server zu fragen', async () => {
    const harness = await setup();

    harness.type('thorsten@');
    await harness.submit();

    expect(harness.fake.otpRequests).toHaveLength(0);
    expect(harness.element.querySelector('[role="alert"]')?.textContent).toContain('gültige');
  });

  it('verraet auch ueber die Mengenbegrenzung kein bestehendes Konto', async () => {
    // Die Drosselung greift nur, wenn tatsaechlich eine Mail rausging — also
    // nur bei vorhandenem Konto. Wuerde die Seite sie zeigen, waere zweimaliges
    // Absenden derselben Adresse die Antwort auf „gibt es dieses Konto?".
    const harness = await setup((fake) => {
      fake.otpError = {
        message: 'For security purposes, you can only request this after 60 seconds.',
        status: 429,
      };
    });

    harness.type('thorsten@dailyfi.test');
    await harness.submit();

    expect(harness.element.querySelector('[role="alert"]')).toBeNull();
    expect(harness.element.querySelector('[role="status"]')?.textContent).toContain(
      'thorsten@dailyfi.test',
    );
  });

  it('haelt die Live-Region schon vor dem Absenden bereit', async () => {
    const harness = await setup();

    // Eine Region, die erst zusammen mit ihrem Text entsteht, sagen
    // Screenreader nicht an.
    expect(harness.element.querySelector('[role="status"]')).not.toBeNull();

    harness.type('thorsten@dailyfi.test');
    await harness.submit();

    expect(harness.element.querySelector('[role="status"]')?.textContent).toContain(
      'thorsten@dailyfi.test',
    );
  });

  it('setzt den Fokus auf die Bestaetigung, statt ihn fallen zu lassen', async () => {
    const harness = await setup();

    harness.type('thorsten@dailyfi.test');
    await harness.submit();

    expect(document.activeElement).toBe(harness.element.querySelector('.sent-title'));
  });

  it('verdrahtet die Fehlermeldung mit dem Feld', async () => {
    const harness = await setup();

    harness.type('thorsten@');
    await harness.submit();

    const input = harness.element.querySelector<HTMLInputElement>('#login-email')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('login-email-error');
    expect(harness.element.querySelector('#login-email-error')).not.toBeNull();
  });

  it('laesst nach dem Absenden eine andere Adresse zu', async () => {
    const harness = await setup();

    harness.type('thorsten@dailyfi.test');
    await harness.submit();

    harness.element.querySelector<HTMLButtonElement>('.btn-secondary')!.click();
    harness.fixture.detectChanges();

    expect(harness.element.querySelector('#login-email')).not.toBeNull();
  });

  it('verweist auf die Registrierung mit Einladungscode', async () => {
    const harness = await setup();

    const link = harness.element.querySelector<HTMLAnchorElement>('a[href="/register"]');
    expect(link?.textContent).toContain('Einladungscode');
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
