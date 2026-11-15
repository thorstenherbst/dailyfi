import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WarnDialog } from './warn-dialog';

@Component({
  imports: [WarnDialog],
  template: `
    <button type="button" id="trigger" (click)="ask()">Löschen …</button>
    <app-warn-dialog
      [message]="message()"
      subject="Relaunch, Dienstag 9:15 bis 11:00"
      (confirmed)="onConfirmed()"
      (cancelled)="onCancelled()"
    />
  `,
})
class Host {
  readonly message = signal<string | null>(null);
  confirmed = 0;
  cancelled = 0;

  ask(): void {
    this.message.set('Der Eintrag wird endgültig gelöscht.');
  }
  onConfirmed(): void {
    this.confirmed += 1;
    this.message.set(null);
  }
  onCancelled(): void {
    this.cancelled += 1;
    this.message.set(null);
  }
}

function setup(): {
  fixture: ComponentFixture<Host>;
  host: Host;
  dialog: HTMLDialogElement;
  trigger: HTMLButtonElement;
  button(text: string): HTMLButtonElement;
  render(): void;
} {
  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  const element: HTMLElement = fixture.nativeElement;
  const dialog = element.querySelector('dialog')!;
  return {
    fixture,
    host: fixture.componentInstance,
    dialog,
    trigger: element.querySelector('#trigger')!,
    button: (text) =>
      [...dialog.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!,
    render: () => fixture.detectChanges(),
  };
}

describe('WarnDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('ist ein alertdialog mit Titel, Gegenstand und Text', () => {
    const { dialog, trigger, render } = setup();
    trigger.click();
    render();

    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!);
    const text = document.getElementById(dialog.getAttribute('aria-describedby')!);
    expect(title?.textContent).toBe('Eintrag löschen?');
    expect(text?.querySelector('b')?.textContent).toBe('Relaunch, Dienstag 9:15 bis 11:00');
    expect(text?.textContent).toContain('endgültig gelöscht');
  });

  it('setzt den Erstfokus auf „Abbrechen"', () => {
    const { trigger, render, button } = setup();
    trigger.focus();
    trigger.click();
    render();

    expect(document.activeElement).toBe(button('Abbrechen'));
  });

  it('zeigt den Papierkorb im Gefahr-Knopf', () => {
    const { trigger, render, button } = setup();
    trigger.click();
    render();

    const confirm = button('Löschen');
    expect(confirm.classList).toContain('btn-danger');
    expect(confirm.querySelector('app-icon')).not.toBeNull();
  });

  it('bestaetigt mit „Löschen" und gibt den Fokus an den Ausloeser zurueck', () => {
    const { host, dialog, trigger, render, button } = setup();
    trigger.focus();
    trigger.click();
    render();

    button('Löschen').click();
    render();

    expect(host.confirmed).toBe(1);
    expect(host.cancelled).toBe(0);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('bricht mit Esc ab und gibt den Fokus zurueck', () => {
    const { host, dialog, trigger, render } = setup();
    trigger.focus();
    trigger.click();
    render();

    // Esc: der Browser schliesst den nativen Dialog und feuert `close`.
    dialog.close();
    render();

    expect(host.cancelled).toBe(1);
    expect(host.confirmed).toBe(0);
    expect(document.activeElement).toBe(trigger);
  });

  it('bricht mit „Abbrechen" ab', () => {
    const { host, trigger, render, button } = setup();
    trigger.click();
    render();

    button('Abbrechen').click();
    render();

    expect(host.cancelled).toBe(1);
  });
});
