import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SessionExpiredDialog } from './session-expired-dialog';

@Component({
  imports: [SessionExpiredDialog],
  template: `<app-session-expired-dialog [open]="open()" (relogin)="relogins = relogins + 1" />`,
})
class Host {
  readonly open = signal(true);
  relogins = 0;
}

function setup(): { host: Host; dialog: HTMLDialogElement; render(): void } {
  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  return {
    host: fixture.componentInstance,
    dialog: fixture.nativeElement.querySelector('dialog'),
    render: () => fixture.detectChanges(),
  };
}

describe('SessionExpiredDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('zeigt „Sitzung abgelaufen" mit genau einem Weg weiter', () => {
    const { dialog } = setup();

    expect(dialog.open).toBe(true);
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'Sitzung abgelaufen',
    );
    expect([...dialog.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'Neu anmelden',
    ]);
    expect(document.activeElement?.textContent?.trim()).toBe('Neu anmelden');
  });

  it('laesst sich mit Esc nicht wegklicken; Esc fuehrt zu „Neu anmelden"', () => {
    const { dialog } = setup();
    (document.activeElement as HTMLElement).blur();

    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
    expect(document.activeElement?.textContent?.trim()).toBe('Neu anmelden');
  });

  it('oeffnet sich wieder, wenn der Browser ihn trotzdem schliesst', () => {
    const { dialog } = setup();

    // Chrome: zweites Esc ohne Nutzeraktivierung schliesst trotz preventDefault.
    dialog.close();

    expect(dialog.open).toBe(true);
  });

  it('oeffnet sich wieder, wenn Chrome das zweite Esc nicht aufhalten laesst', async () => {
    vi.useFakeTimers();
    const { dialog } = setup();

    // Ohne Nutzeraktivierung: `cancel` ist nicht abbrechbar, der Browser schliesst.
    dialog.dispatchEvent(new Event('cancel', { cancelable: false }));
    dialog.removeAttribute('open');
    vi.runAllTimers();

    expect(dialog.open).toBe(true);
    expect(document.activeElement?.textContent?.trim()).toBe('Neu anmelden');
    vi.useRealTimers();
  });

  it('meldet „Neu anmelden" nach aussen', () => {
    const { host, dialog } = setup();

    dialog.querySelector('button')!.click();

    expect(host.relogins).toBe(1);
  });

  it('schliesst, wenn die Shell ihn nicht mehr braucht', () => {
    const { host, dialog, render } = setup();

    host.open.set(false);
    render();

    expect(dialog.open).toBe(false);
  });
});
