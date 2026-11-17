import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { SessionStore } from '@lib/auth/data-access';
import { DPA_VERSION } from '@lib/legal/domain';
import { SUPABASE } from '@lib/shared/data-access-supabase';
import { FakeSupabase } from '@lib/shared/data-access-supabase/testing';
import { ToastService } from '@lib/shared/ui';

import { ConsentPage } from './consent-page';

interface Harness {
  fixture: ComponentFixture<ConsentPage>;
  element: HTMLElement;
  fake: FakeSupabase;
  navigateByUrl: ReturnType<typeof vi.spyOn>;
  tick(): void;
  submit(): Promise<void>;
}

async function setup(
  options: { query?: Record<string, string>; configure?: (fake: FakeSupabase) => void } = {},
): Promise<Harness> {
  const fake = new FakeSupabase();
  fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
  fake.betaAccess = true;
  options.configure?.(fake);

  await TestBed.configureTestingModule({
    imports: [ConsentPage],
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

  const navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(ConsentPage);
  fixture.detectChanges();
  const element: HTMLElement = fixture.nativeElement;

  return {
    fixture,
    element,
    fake,
    navigateByUrl,
    tick(): void {
      element.querySelector<HTMLInputElement>('#consent-dpa')!.click();
      fixture.detectChanges();
    },
    async submit(): Promise<void> {
      element.querySelector('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();
    },
  };
}

describe('ConsentPage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('nennt die Version und verlinkt AV-Vertrag und Datenschutzerklaerung', async () => {
    const harness = await setup();

    const label = harness.element.querySelector('label[for="consent-dpa"]')!;
    expect(label.textContent).toContain(`Version ${DPA_VERSION}`);
    expect(label.textContent).toContain('gelesen und stimme ihm zu');
    expect(label.querySelector('a')).toBeNull();
    expect(harness.element.querySelector('#consent-dpa-links a[href="/avv"]')).not.toBeNull();
    expect(
      harness.element.querySelector('#consent-dpa-links a[href="/datenschutz"]'),
    ).not.toBeNull();
    expect(harness.element.querySelector('button[type="submit"]')?.textContent).toContain(
      'Zustimmen und weiter',
    );
  });

  it('verlangt den Haken und sagt es am Feld', async () => {
    const harness = await setup();

    await harness.submit();

    expect(harness.fake.acceptDpaCalls).toEqual([]);
    const box = harness.element.querySelector<HTMLInputElement>('#consent-dpa')!;
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.getAttribute('aria-describedby')).toBe('consent-dpa-error consent-dpa-links');
    expect(harness.element.querySelector('#consent-dpa-error')?.textContent).toContain(
      'AV-Vertrag',
    );
    expect(harness.navigateByUrl).not.toHaveBeenCalled();
  });

  it('setzt ohne Haken den Fokus auf die Checkbox', async () => {
    const harness = await setup();
    document.body.appendChild(harness.element);

    await harness.submit();

    expect(document.activeElement).toBe(harness.element.querySelector('#consent-dpa'));
    harness.element.remove();
  });

  it('nimmt den Fehler am Feld mit dem Haken sofort weg', async () => {
    const harness = await setup();

    await harness.submit();
    harness.tick();

    const box = harness.element.querySelector<HTMLInputElement>('#consent-dpa')!;
    expect(box.hasAttribute('aria-invalid')).toBe(false);
    expect(harness.element.querySelector('#consent-dpa-error')).toBeNull();
  });

  it('speichert die Zustimmung und geht zur angefragten Adresse', async () => {
    const harness = await setup({ query: { returnUrl: '/reports' } });

    harness.tick();
    await harness.submit();

    expect(harness.fake.acceptDpaCalls).toEqual([DPA_VERSION]);
    expect(harness.navigateByUrl).toHaveBeenCalledWith('/reports', { replaceUrl: true });
  });

  it('geht ohne Ruecksprungziel in die Woche', async () => {
    const harness = await setup({ query: { returnUrl: 'https://example.com' } });

    harness.tick();
    await harness.submit();

    expect(harness.navigateByUrl).toHaveBeenCalledWith('/week', { replaceUrl: true });
  });

  it('meldet ein gescheitertes Speichern als Toast und bleibt stehen', async () => {
    const harness = await setup({
      configure: (fake) => {
        fake.acceptDpaError = { message: 'connection reset' };
      },
    });

    harness.tick();
    await harness.submit();

    expect(harness.navigateByUrl).not.toHaveBeenCalled();
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map((toast) => toast.message),
    ).toEqual(['Zustimmung konnte nicht gespeichert werden.']);
    // Der Haken bleibt, ein Klick reicht fuer den naechsten Versuch.
    expect(harness.element.querySelector<HTMLInputElement>('#consent-dpa')!.checked).toBe(true);
    expect(harness.element.querySelector('#consent-dpa-error')).toBeNull();
  });

  it('bietet das Abmelden an', async () => {
    const harness = await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    harness.element.querySelector<HTMLButtonElement>('.footer button')!.click();
    await harness.fixture.whenStable();

    expect(harness.fake.signOutCalls).toBe(1);
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });
});
