import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SUPABASE } from '@lib/shared/data-access-supabase';
import { FakeSupabase } from '@lib/shared/data-access-supabase/testing';

import { LoginPage } from './login-page';

interface Harness {
  fixture: ComponentFixture<LoginPage>;
  element: HTMLElement;
  fake: FakeSupabase;
  button(): HTMLButtonElement;
  click(): Promise<void>;
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
  const button = (): HTMLButtonElement => element.querySelector('.btn-apple')!;

  return {
    fixture,
    element,
    fake,
    button,
    async click(): Promise<void> {
      button().click();
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

  it('bietet nur die Anmeldung mit Apple an', async () => {
    const harness = await setup();

    expect(harness.element.querySelector('input')).toBeNull();
    expect(harness.button().textContent).toContain('Mit Apple anmelden');
    // Das Logo ist Schmuck; der Name steht als Text am Knopf.
    expect(harness.button().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('startet die Anmeldung mit Apple und sperrt den Knopf bis zur Weiterleitung', async () => {
    const harness = await setup();

    await harness.click();

    expect(harness.fake.oauthRequests).toHaveLength(1);
    expect(harness.fake.oauthRequests[0].provider).toBe('apple');
    expect(harness.button().getAttribute('aria-disabled')).toBe('true');
    expect(harness.element.querySelector('[role="status"]')?.textContent).toContain('Apple');
  });

  it('behaelt beim Start den Fokus auf dem Knopf', async () => {
    const harness = await setup((fake) => {
      fake.oauthError = { message: 'provider is not enabled', status: 400 };
    });
    document.body.appendChild(harness.element);
    harness.button().focus();

    await harness.click();

    expect(document.activeElement).toBe(harness.button());
    harness.element.remove();
  });

  it('gibt den Knopf frei, wenn der Browser die Seite aus dem Cache zurueckholt', async () => {
    const harness = await setup();
    await harness.click();

    globalThis.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    harness.fixture.detectChanges();

    expect(harness.button().hasAttribute('aria-disabled')).toBe(false);
    expect(harness.element.querySelector('[role="status"]')?.textContent?.trim()).toBe('');
  });

  it('startet bei einem Doppelklick nur einmal', async () => {
    const harness = await setup();

    harness.button().click();
    harness.button().click();
    await harness.fixture.whenStable();

    expect(harness.fake.oauthRequests).toHaveLength(1);
  });

  it('meldet einen gescheiterten Start und laesst es erneut versuchen', async () => {
    const harness = await setup((fake) => {
      fake.oauthError = { message: 'provider is not enabled', status: 400 };
    });

    await harness.click();

    expect(harness.element.querySelector('[role="alert"]')?.textContent).toContain(
      'nicht erreichbar',
    );
    expect(harness.button().hasAttribute('aria-disabled')).toBe(false);
  });

  it('haelt die Live-Region schon vor dem Klick bereit', async () => {
    const harness = await setup();

    const region = harness.element.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.textContent?.trim()).toBe('');
  });

  it('erklaert neuen Nutzern den Einladungscode und bestehenden die geteilte Adresse', async () => {
    const harness = await setup();

    expect(harness.element.textContent).toContain('Einladungscode');
    expect(harness.element.textContent).toContain('E-Mail-Adresse teilen');
  });

  it('verlinkt unter der Karte Impressum, Datenschutz und AV-Vertrag', async () => {
    const harness = await setup();

    const nav = harness.element.querySelector('nav[aria-label="Rechtliches"]')!;
    expect(
      [...nav.querySelectorAll<HTMLAnchorElement>('a')].map((link) => link.getAttribute('href')),
    ).toEqual(['/impressum', '/datenschutz', '/avv']);
  });
});
