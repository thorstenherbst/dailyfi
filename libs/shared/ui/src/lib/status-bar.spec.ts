import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Shortcut, SyncState } from './shell-status';
import { StatusBar } from './status-bar';

@Component({
  imports: [StatusBar],
  template: `
    <app-status-bar
      [sync]="sync()"
      [weekNumber]="weekNumber()"
      [weekTotal]="weekTotal()"
      [todayTotal]="todayTotal()"
      [shortcuts]="shortcuts()"
      [email]="email()"
      (signOut)="signedOut = signedOut + 1"
    />
  `,
})
class Host {
  readonly sync = signal<SyncState | null>('synced');
  readonly weekNumber = signal<number | null>(45);
  readonly weekTotal = signal<string | null>('24,25 h');
  readonly todayTotal = signal<string | null>('3,00 h');
  readonly shortcuts = signal<readonly Shortcut[]>([{ keys: ['Enter'], label: 'bearbeiten' }]);
  readonly email = signal<string | null>('thorsten@dailyfi.test');
  signedOut = 0;
}

async function setup(): Promise<{ host: Host; element: HTMLElement; render: () => void }> {
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const element: HTMLElement = fixture.nativeElement.querySelector('app-status-bar');
  return { host: fixture.componentInstance, element, render: () => fixture.detectChanges() };
}

const text = (element: HTMLElement): string => element.textContent!.replace(/\s+/g, ' ').trim();

describe('StatusBar', () => {
  it('zeigt Sync-Zustand, KW, Summen, Kuerzel und Konto', async () => {
    const { element } = await setup();

    expect(text(element)).toContain('synchronisiert');
    expect(text(element)).toContain('KW 45');
    expect(text(element)).toContain('Woche 24,25 h');
    expect(text(element)).toContain('Heute 3,00 h');
    expect(element.querySelector('kbd')?.textContent).toBe('Enter');
    expect(text(element)).toContain('bearbeiten');
    expect(text(element)).toContain('thorsten@dailyfi.test');
    expect(element.getAttribute('aria-label')).toBe('Statusleiste');
  });

  it('nennt den Sync-Zustand als Wort, nicht nur als Farbe', async () => {
    const { host, element, render } = await setup();

    host.sync.set('error');
    render();
    expect(text(element)).toContain('Fehler');

    host.sync.set('loading');
    render();
    expect(text(element)).toContain('lädt');

    host.sync.set('saving');
    render();
    expect(text(element)).toContain('speichert');
  });

  it('laesst weg, was die Seite nicht weiss', async () => {
    const { host, element, render } = await setup();

    host.sync.set(null);
    host.weekNumber.set(null);
    host.weekTotal.set(null);
    host.todayTotal.set(null);
    host.shortcuts.set([]);
    render();

    expect(text(element)).not.toContain('KW');
    expect(text(element)).not.toContain('Woche');
    expect(text(element)).not.toContain('Heute');
    expect(text(element)).not.toContain('synchronisiert');
    expect(element.querySelector('kbd')).toBeNull();
    expect(text(element)).toContain('Abmelden');
  });

  it('meldet „Abmelden" nach aussen', async () => {
    const { host, element } = await setup();

    element.querySelector<HTMLButtonElement>('button')!.click();

    expect(host.signedOut).toBe(1);
  });
});
