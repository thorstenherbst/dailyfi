import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';

import { RecoveryOutcome, SessionStore, VaultOutcome, VaultStore } from '@lib/auth/data-access';
import { SUPABASE } from '@lib/shared/data-access-supabase';
import { FakeSupabase } from '@lib/shared/data-access-supabase/testing';

import { UnlockPage } from './unlock-page';

class StubVault {
  passkey: VaultOutcome = 'ok';
  recovery: RecoveryOutcome = 'ok';
  add: VaultOutcome = 'ok';
  recoveryInputs: string[] = [];
  addCalls = 0;
  async unlockWithPasskey(): Promise<VaultOutcome> {
    return this.passkey;
  }
  async unlockWithRecoveryKey(text: string): Promise<RecoveryOutcome> {
    this.recoveryInputs.push(text);
    return this.recovery;
  }
  async addPasskey(): Promise<VaultOutcome> {
    this.addCalls += 1;
    return this.add;
  }
  forgetCalls = 0;
  forgetRecovered(): void {
    this.forgetCalls += 1;
  }
}

interface Harness {
  fixture: ComponentFixture<UnlockPage>;
  element: HTMLElement;
  vault: StubVault;
  navigate: ReturnType<typeof vi.spyOn>;
  settle(): Promise<void>;
}

async function setup(
  configure: (vault: StubVault) => void = () => {},
  query: Record<string, string> = { returnUrl: '/projects' },
): Promise<Harness> {
  const fake = new FakeSupabase();
  fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
  const vault = new StubVault();
  configure(vault);

  await TestBed.configureTestingModule({
    imports: [UnlockPage],
    providers: [
      provideRouter([]),
      { provide: SUPABASE, useValue: fake.asClient() },
      { provide: VaultStore, useValue: vault },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
      },
    ],
  }).compileComponents();
  await TestBed.inject(SessionStore).restore();

  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(UnlockPage);
  fixture.detectChanges();
  const element: HTMLElement = fixture.nativeElement;
  document.body.appendChild(element);

  return {
    fixture,
    element,
    vault,
    navigate,
    async settle(): Promise<void> {
      await fixture.whenStable();
      fixture.detectChanges();
    },
  };
}

function button(element: HTMLElement, text: string): HTMLButtonElement {
  const found = [...element.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!found) {
    throw new Error(`Kein Knopf „${text}"`);
  }
  return found;
}

async function enterRecovery(harness: Harness, text: string): Promise<void> {
  button(harness.element, 'Wiederherstellungsschlüssel verwenden').click();
  await harness.settle();
  const input = harness.element.querySelector<HTMLInputElement>('#recovery-input')!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  harness.element.querySelector('form')!.dispatchEvent(new Event('submit'));
  await harness.settle();
}

describe('UnlockPage', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('entsperrt mit dem Passkey und geht zum Ziel', async () => {
    const harness = await setup();

    button(harness.element, 'Mit Passkey entsperren').click();
    await harness.settle();

    expect(harness.navigate).toHaveBeenCalledWith('/projects', { replaceUrl: true });
  });

  it('geht nicht im Kreis zurueck auf sich selbst', async () => {
    const harness = await setup(() => {}, { returnUrl: '/entsperren' });

    button(harness.element, 'Mit Passkey entsperren').click();
    await harness.settle();

    expect(harness.navigate).toHaveBeenCalledWith('/week', { replaceUrl: true });
  });

  it('meldet einen fremden Passkey und bleibt stehen', async () => {
    const harness = await setup((vault) => {
      vault.passkey = 'wrong-key';
    });

    button(harness.element, 'Mit Passkey entsperren').click();
    await harness.settle();

    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.element.querySelector('[role="alert"]')?.textContent).toContain(
      'gehört nicht zu deinem',
    );
  });

  it('setzt beim Wechsel zum Wiederherstellungsschluessel den Fokus ins Feld', async () => {
    const harness = await setup();

    button(harness.element, 'Wiederherstellungsschlüssel verwenden').click();
    await harness.settle();

    expect(document.activeElement).toBe(harness.element.querySelector('#recovery-input'));
  });

  it('entsperrt mit dem Wiederherstellungsschluessel und bietet einen neuen Passkey an', async () => {
    const harness = await setup();

    await enterRecovery(harness, 'abcd-efgh');

    expect(harness.vault.recoveryInputs).toEqual(['abcd-efgh']);
    expect(document.activeElement?.textContent).toContain('Entsperrt');
    button(harness.element, 'Neuen Passkey anlegen').click();
    await harness.settle();

    expect(harness.vault.addCalls).toBe(1);
    expect(harness.navigate).toHaveBeenCalledWith('/projects', { replaceUrl: true });
  });

  it('gibt den Fokus zurueck auf den Passkey-Knopf', async () => {
    const harness = await setup();
    button(harness.element, 'Wiederherstellungsschlüssel verwenden').click();
    await harness.settle();

    button(harness.element, 'Doch mit Passkey').click();
    await harness.settle();

    expect(document.activeElement).toBe(button(harness.element, 'Mit Passkey entsperren'));
  });

  it('weist bei abgebrochenem Passkey auf den Wiederherstellungsschluessel hin', async () => {
    const harness = await setup((vault) => {
      vault.passkey = 'cancelled';
    });

    button(harness.element, 'Mit Passkey entsperren').click();
    await harness.settle();

    expect(harness.element.querySelector('[role="alert"]')?.textContent).toContain(
      'Wiederherstellungsschlüssel',
    );
  });

  it('vergisst den wiederhergestellten Schluessel beim Weitergehen', async () => {
    const harness = await setup();
    await enterRecovery(harness, 'abcd-efgh');

    button(harness.element, 'Später').click();
    await harness.settle();

    expect(harness.vault.forgetCalls).toBeGreaterThan(0);
  });

  it('laesst den neuen Passkey auf spaeter', async () => {
    const harness = await setup();
    await enterRecovery(harness, 'abcd-efgh');

    button(harness.element, 'Später').click();
    await harness.settle();

    expect(harness.vault.addCalls).toBe(0);
    expect(harness.navigate).toHaveBeenCalledWith('/projects', { replaceUrl: true });
  });

  it('nennt einen unvollstaendigen und einen falschen Schluessel verschieden', async () => {
    const invalid = await setup((vault) => {
      vault.recovery = 'invalid';
    });
    await enterRecovery(invalid, 'abc');
    expect(invalid.element.querySelector('#recovery-error')?.textContent).toContain('52 Zeichen');
    expect(invalid.element.querySelector('#recovery-input')?.getAttribute('aria-describedby')).toBe(
      'recovery-hint recovery-error',
    );

    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    const wrong = await setup((vault) => {
      vault.recovery = 'wrong-key';
    });
    await enterRecovery(wrong, 'abc');
    expect(wrong.element.querySelector('#recovery-error')?.textContent).toContain('passt nicht');
    expect(wrong.navigate).not.toHaveBeenCalled();
  });
});
