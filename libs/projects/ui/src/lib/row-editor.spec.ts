import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ProjectRecord } from '@lib/projects/domain';

import { NewRow } from './new-row';
import { ProjectRow } from './project-row';
import { RowEditor, RowEditorEvent, RowEditorState } from './row-editor';

const STATE: RowEditorState = {
  values: { name: 'Relaunch', color: '#2F5BD3', rate: '95,00', clientId: 'c1' },
  problem: null,
  notice: false,
  noticeMessage: null,
  noticeRevision: 0,
  busy: false,
  clients: [{ id: 'c1', name: 'Sandmann GmbH', archivedAt: null }],
};

@Component({
  imports: [RowEditor],
  template: `<app-row-editor
    kind="project"
    nameLabel="Projektname"
    [placeholder]="placeholder()"
    [state]="state()"
    (event)="events.push($event)"
  />`,
})
class Host {
  readonly state = signal<RowEditorState | null>(STATE);
  readonly placeholder = signal<string | null>(null);
  readonly events: RowEditorEvent[] = [];
}

function mount() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const element: HTMLElement = fixture.nativeElement;
  return { fixture, element, host: fixture.componentInstance };
}

describe('RowEditor', () => {
  it('zeigt im Bearbeiten-Modus alle Felder mit sichtbaren Labels', () => {
    const { element } = mount();

    expect([...element.querySelectorAll('label.row-label')].map((l) => l.textContent?.trim())).toEqual(
      ['Projektname', 'Stundensatz', 'Kunde'],
    );
    const name = element.querySelector<HTMLInputElement>('[data-field="name"]')!;
    expect(element.querySelector(`label[for="${name.id}"]`)).not.toBeNull();
    expect(name.getAttribute('aria-label')).toBeNull();
    expect(element.querySelector('fieldset legend')?.textContent).toBe('Farbe');
  });

  it('meldet Tippen, Enter (Submit), Abbrechen und Esc nach oben', () => {
    const { element, host, fixture } = mount();
    const name = element.querySelector<HTMLInputElement>('[data-field="name"]')!;

    name.value = 'Neu';
    name.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    [...element.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Abbrechen')!.click();
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(host.events).toEqual([
      { type: 'change', key: 'name', value: 'Neu' },
      { type: 'save' },
      { type: 'cancel' },
      { type: 'escape' },
    ]);
  });

  it('speichert nicht, solange gespeichert wird', () => {
    const { element, host, fixture } = mount();
    host.state.set({ ...STATE, busy: true });
    fixture.detectChanges();

    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(host.events).toEqual([]);
    expect(element.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Speichert …');
  });

  it('verbindet einen Fehler per aria-describedby mit dem Feld', () => {
    const { element, host, fixture } = mount();
    host.state.set({ ...STATE, problem: { field: 'name', message: 'Bitte einen Projektnamen eingeben.' } });
    fixture.detectChanges();

    const name = element.querySelector<HTMLInputElement>('[data-field="name"]')!;
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(element.querySelector(`#${name.getAttribute('aria-describedby')}`)?.textContent).toContain(
      'Bitte einen Projektnamen eingeben.',
    );
  });

  it('zeigt den Hinweis mit Text in der Live-Region und Knoepfen daneben', () => {
    const { element, host, fixture } = mount();
    const live = element.querySelector('[role="status"]')!;
    // Die Region steht schon, bevor der Hinweis kommt.
    expect(live.textContent?.trim()).toBe('');

    host.state.set({
      ...STATE,
      notice: true,
      noticeMessage: 'Erst speichern oder verwerfen — danach endet die Bearbeitung.',
    });
    fixture.detectChanges();

    expect(element.querySelector('[role="status"]')).toBe(live);
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toContain('Ungespeicherte Änderungen');
    expect(live.querySelector('button')).toBeNull();
    [...element.querySelectorAll('.row-notice-actions button')].forEach((b) =>
      (b as HTMLButtonElement).click(),
    );
    expect(host.events).toEqual([{ type: 'keep' }, { type: 'discard' }]);
  });

  it('eingeklappt (Leerzeile): nur das Namensfeld mit aria-label und Platzhalter', () => {
    const { element, host, fixture } = mount();
    host.state.set(null);
    host.placeholder.set('Neues Projekt …');
    fixture.detectChanges();

    const name = element.querySelector<HTMLInputElement>('[data-field="name"]')!;
    expect(name.getAttribute('aria-label')).toBe('Projektname');
    expect(name.placeholder).toBe('Neues Projekt …');
    expect(element.querySelector('fieldset')).toBeNull();
    expect(element.querySelector('[role="status"]')).toBeNull();
  });

  it('behaelt beim Aufklappen dasselbe Namensfeld (Fokus und Getipptes bleiben)', () => {
    const { element, host, fixture } = mount();
    host.state.set(null);
    host.placeholder.set('Neues Projekt …');
    fixture.detectChanges();
    const before = element.querySelector('[data-field="name"]');

    host.state.set(STATE);
    fixture.detectChanges();

    expect(element.querySelector('[data-field="name"]')).toBe(before);
  });
});

@Component({
  imports: [ProjectRow, NewRow],
  template: `<table>
    <tbody>
      <tr app-project-row [project]="project()" (edit)="edits = edits + 1"></tr>
      <tr app-new-row kind="project" label="Neues Projekt für X" rowKey="np:c1"></tr>
    </tbody>
  </table>`,
})
class TableHost {
  readonly project = signal<ProjectRecord>({
    id: 'p1',
    clientId: 'c1',
    name: 'Relaunch',
    color: '#123456',
    hourlyRate: null,
    archivedAt: null,
  });
  edits = 0;
}

describe('ProjectRow und NewRow', () => {
  it('sitzen als echte <tr> in der Tabelle', () => {
    const fixture = TestBed.createComponent(TableHost);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;

    const rows = element.querySelectorAll('tbody > tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-row')).toBe('p:p1');
    expect(rows[1].getAttribute('data-row')).toBe('np:c1');
    expect(rows[0].querySelector('th[scope="row"]')?.textContent).toContain('Relaunch');
  });

  it('nennt eine fremde Farbe als Text und „kein Satz"', () => {
    const fixture = TestBed.createComponent(TableHost);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('.color-name')?.textContent?.trim()).toBe(
      'Graphit (eigener Wert #123456)',
    );
    expect(element.querySelector('.num')?.textContent?.trim()).toBe('kein Satz');
  });

  it('meldet den Stift als Absicht und hat Ziele von 32 px', () => {
    const fixture = TestBed.createComponent(TableHost);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;

    const pencil = element.querySelector<HTMLButtonElement>('.row-edit')!;
    pencil.click();

    expect(fixture.componentInstance.edits).toBe(1);
    // btn-sm + btn-icon: 32 × 32 (≥ 24, WCAG 2.5.8) — Klassen aus components/_button.scss.
    expect(pencil.classList).toContain('btn-sm');
    expect(pencil.classList).toContain('btn-icon');
  });
});
