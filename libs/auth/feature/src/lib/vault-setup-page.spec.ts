import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { SessionStore, SetUpStep, VaultStore } from '@lib/auth/data-access';
import { SUPABASE } from '@lib/shared/data-access-supabase';
import { FakeSupabase } from '@lib/shared/data-access-supabase/testing';
import { FileDownload } from '@lib/shared/util-browser';

import { VaultSetupPage } from './vault-setup-page';

const KEY = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-ABCD-EFGH-JKMN-PQRS-TV00';

class StubVault {
  available = true;
  begin: SetUpStep = { step: 'show-recovery', recoveryKey: KEY };
  confirm: SetUpStep = { step: 'show-recovery', recoveryKey: KEY };
  finish: SetUpStep = { step: 'done' };
  calls: string[] = [];
  passkeysAvailable(): boolean {
    return this.available;
  }
  async beginSetUp(): Promise<SetUpStep> {
    this.calls.push('begin');
    return this.begin;
  }
  async confirmPasskey(): Promise<SetUpStep> {
    this.calls.push('confirm');
    return this.confirm;
  }
  async finishSetUp(): Promise<SetUpStep> {
    this.calls.push('finish');
    return this.finish;
  }
  abandonSetUp(): void {
    this.calls.push('abandon');
  }
}

interface Harness {
  fixture: ComponentFixture<VaultSetupPage>;
  element: HTMLElement;
  vault: StubVault;
  saved: Array<{ name: string; content: string }>;
  navigate: ReturnType<typeof vi.spyOn>;
  settle(): Promise<void>;
}

async function setup(configure: (vault: StubVault) => void = () => {}): Promise<Harness> {
  const fake = new FakeSupabase();
  fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
  const vault = new StubVault();
  configure(vault);
  const saved: Array<{ name: string; content: string }> = [];

  await TestBed.configureTestingModule({
    imports: [VaultSetupPage],
    providers: [
      provideRouter([]),
      { provide: SUPABASE, useValue: fake.asClient() },
      { provide: VaultStore, useValue: vault },
      {
        provide: FileDownload,
        useValue: { save: (name: string, content: string) => saved.push({ name, content }) },
      },
    ],
  }).compileComponents();
  await TestBed.inject(SessionStore).restore();

  const navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(VaultSetupPage);
  fixture.detectChanges();
  const element: HTMLElement = fixture.nativeElement;
  document.body.appendChild(element);

  return {
    fixture,
    element,
    vault,
    saved,
    navigate: navigateByUrl,
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

describe('VaultSetupPage', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('richtet ein und zeigt den Wiederherstellungsschluessel mit Fokus auf der Ueberschrift', async () => {
    const harness = await setup();

    button(harness.element, 'Passkey anlegen').click();
    await harness.settle();

    expect(harness.vault.calls).toEqual(['begin']);
    expect(harness.element.querySelector('#recovery-key')?.textContent).toBe(KEY);
    expect(document.activeElement?.textContent).toContain('Dein Wiederherstellungsschlüssel');
  });

  it('geht erst weiter, wenn das Aufbewahren bestaetigt ist', async () => {
    const harness = await setup();
    button(harness.element, 'Passkey anlegen').click();
    await harness.settle();

    button(harness.element, 'Einrichtung abschließen').click();
    await harness.settle();

    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.vault.calls).toEqual(['begin']);
    const box = harness.element.querySelector<HTMLInputElement>('#recovery-stored')!;
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(box);

    box.click();
    await harness.settle();
    expect(harness.element.querySelector('#recovery-stored-error')).toBeNull();
    button(harness.element, 'Einrichtung abschließen').click();
    await harness.settle();

    expect(harness.vault.calls).toEqual(['begin', 'finish']);
    expect(harness.navigate).toHaveBeenCalledWith('/week', { replaceUrl: true });
  });

  it('bleibt bei gescheitertem Speichern stehen und zeigt den Schluessel weiter', async () => {
    const harness = await setup((vault) => {
      vault.finish = { step: 'failed', reason: 'save-failed' };
    });
    button(harness.element, 'Passkey anlegen').click();
    await harness.settle();
    harness.element.querySelector<HTMLInputElement>('#recovery-stored')!.click();
    await harness.settle();

    button(harness.element, 'Einrichtung abschließen').click();
    await harness.settle();

    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.element.querySelector('#recovery-key')?.textContent).toBe(KEY);
    expect(harness.element.querySelector('[role="alert"]')?.textContent).toContain(
      'nicht gespeichert',
    );
  });

  it('fragt bei Safari nach einem zweiten Klick und setzt den Fokus darauf', async () => {
    const harness = await setup((vault) => {
      vault.begin = { step: 'confirm-passkey' };
    });

    button(harness.element, 'Passkey anlegen').click();
    await harness.settle();

    const confirm = button(harness.element, 'Passkey bestätigen');
    expect(document.activeElement).toBe(confirm);
    confirm.click();
    await harness.settle();

    expect(harness.vault.calls).toEqual(['begin', 'confirm']);
    expect(harness.element.querySelector('#recovery-key')?.textContent).toBe(KEY);
  });

  it('schickt zum Entsperren, wenn inzwischen eingerichtet ist', async () => {
    const harness = await setup((vault) => {
      vault.begin = { step: 'failed', reason: 'already-set-up' };
    });

    button(harness.element, 'Passkey anlegen').click();
    await harness.settle();

    expect(harness.navigate).toHaveBeenCalledWith('/entsperren', { replaceUrl: true });
  });

  it('gibt ein nicht abgeschlossenes Einrichten beim Verlassen frei', async () => {
    const harness = await setup();
    button(harness.element, 'Passkey anlegen').click();
    await harness.settle();

    harness.fixture.destroy();

    expect(harness.vault.calls).toContain('abandon');
  });

  it('bietet den Schluessel als Textdatei an', async () => {
    const harness = await setup();
    button(harness.element, 'Passkey anlegen').click();
    await harness.settle();

    button(harness.element, 'Als Datei speichern').click();

    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0].content).toContain(KEY);
    expect(harness.saved[0].content).toContain('thorsten@dailyfi.test');
  });

  it('erklaert Abbruch und fehlendes PRF und bleibt beim ersten Schritt', async () => {
    for (const reason of ['cancelled', 'unsupported', 'busy-elsewhere'] as const) {
      TestBed.resetTestingModule();
      document.body.innerHTML = '';
      const harness = await setup((vault) => {
        vault.begin = { step: 'failed', reason };
      });

      button(harness.element, 'Passkey anlegen').click();
      await harness.settle();

      expect(harness.element.querySelector('[role="alert"]')).not.toBeNull();
      expect(harness.element.querySelector('#recovery-key')).toBeNull();
      // Der Knopf bleibt fokussierbar und ist wieder frei.
      expect(button(harness.element, 'Passkey anlegen').hasAttribute('aria-disabled')).toBe(false);
    }
  });

  it('sagt gleich, wenn der Browser keine Passkeys kann', async () => {
    const harness = await setup((vault) => {
      vault.available = false;
    });

    expect(harness.element.querySelector('[role="alert"]')?.textContent).toContain('Browser');
  });
});
