import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EntryFormProblem, EntryFormValues, Project } from '@lib/week/domain';

import { EntryPanel, EntryPanelChange, EntryPanelMode } from './entry-panel';

const PROJECTS: Project[] = [
  { id: 'p1', name: 'Relaunch', color: '#2F5BD3', clientName: 'Sandmann GmbH' },
  { id: 'p2', name: 'Wartung', color: '#1A7A4A', clientName: 'Kessler' },
];

const VALUES: EntryFormValues = {
  dayKey: '2026-09-15',
  from: '09:15',
  to: '11:00',
  projectId: 'p1',
  description: 'Datenmodell',
};

@Component({
  imports: [EntryPanel],
  template: `
    <app-entry-panel
      [mode]="mode()"
      [values]="values()"
      [projects]="projects"
      [dayOptions]="days"
      [problem]="problem()"
      [notice]="notice()"
      [noticeMessage]="noticeMessage()"
      [noticeRevision]="noticeRevision()"
      [busy]="busy()"
      (changed)="log.push(['changed', $event])"
      (save)="log.push(['save'])"
      (cancelled)="log.push(['cancelled'])"
      (remove)="log.push(['remove'])"
      (escape)="log.push(['escape'])"
      (keep)="log.push(['keep'])"
      (discard)="log.push(['discard'])"
    />
  `,
})
class Host {
  readonly mode = signal<EntryPanelMode>('empty');
  readonly values = signal<EntryFormValues | null>(null);
  readonly problem = signal<EntryFormProblem | null>(null);
  readonly notice = signal(false);
  readonly noticeMessage = signal<string | null>(null);
  readonly noticeRevision = signal(0);
  readonly busy = signal(false);
  readonly projects = PROJECTS;
  readonly days = ['2026-09-14', '2026-09-15', '2026-09-16'];
  readonly log: Array<[string, EntryPanelChange?]> = [];
}

function setup(): {
  fixture: ComponentFixture<Host>;
  host: Host;
  element: HTMLElement;
  render(): void;
} {
  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  return {
    fixture,
    host: fixture.componentInstance,
    element: fixture.nativeElement,
    render: () => fixture.detectChanges(),
  };
}

function byLabel(element: HTMLElement, label: string): HTMLElement {
  const target = [...element.querySelectorAll('label')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  const control = target && element.querySelector<HTMLElement>(`#${target.htmlFor}`);
  if (!control) {
    throw new Error(`Kein Feld „${label}"`);
  }
  return control;
}

describe('EntryPanel', () => {
  afterEach(() => (document.body.innerHTML = ''));

  it('ist eine Region mit Ueberschrift und zeigt ohne Auswahl den Hinweis', () => {
    const { element } = setup();
    const region = element.querySelector('aside')!;
    const heading = element.querySelector(`#${region.getAttribute('aria-labelledby')}`);

    expect(heading?.tagName).toBe('H2');
    expect(heading?.textContent?.trim()).toBe('Kein Eintrag gewählt');
    expect(region.textContent).toContain('Block wählen oder im Raster ziehen.');
    expect(element.querySelector('form')).toBeNull();
  });

  it('nennt den Modus in der Ueberschrift und zeigt Loeschen nur beim Bearbeiten', () => {
    const { host, element, render } = setup();
    host.values.set(VALUES);
    host.mode.set('create');
    render();

    const title = (): string => element.querySelector('h2')!.textContent!.trim();
    const buttons = (): string[] =>
      [...element.querySelectorAll('.panel-actions button')].map((b) => b.textContent!.trim());

    expect(title()).toBe('Neuer Eintrag');
    expect(buttons()).toEqual(['Speichern', 'Abbrechen']);

    host.mode.set('edit');
    render();
    expect(title()).toBe('Eintrag bearbeiten');
    expect(buttons()).toEqual(['Speichern', 'Abbrechen', 'Löschen']);
  });

  it('zeigt die Werte und das Projekt mit Farbpunkt und Name', () => {
    const { host, element, render } = setup();
    host.values.set(VALUES);
    host.mode.set('edit');
    render();

    const project = byLabel(element, 'Projekt') as HTMLSelectElement;
    expect(project.value).toBe('p1');
    expect(project.selectedOptions[0].textContent?.trim()).toBe('Relaunch · Sandmann GmbH');
    expect(project.closest('.select-wrap')?.classList).toContain('pc1');
    expect(element.querySelector('.select-wrap .dot')).not.toBeNull();
    expect((byLabel(element, 'Von') as HTMLInputElement).value).toBe('09:15');
    expect((byLabel(element, 'Bis') as HTMLInputElement).value).toBe('11:00');
    expect((byLabel(element, 'Notiz') as HTMLTextAreaElement).value).toBe('Datenmodell');
    expect((byLabel(element, 'Tag') as HTMLSelectElement).value).toBe('2026-09-15');
    expect(element.querySelector('.panel-dur')?.textContent).toContain('1,75 h');
  });

  it('meldet jede Eingabe als Aenderung', () => {
    const { host, element, render } = setup();
    host.values.set(VALUES);
    host.mode.set('edit');
    render();

    const from = byLabel(element, 'Von') as HTMLInputElement;
    from.value = '10:00';
    from.dispatchEvent(new Event('input'));

    expect(host.log).toEqual([['changed', { key: 'from', value: '10:00' }]]);
  });

  it('verbindet Fehler per aria-describedby mit dem Feld', () => {
    const { host, element, render } = setup();
    host.values.set({ ...VALUES, projectId: '' });
    host.mode.set('create');
    host.problem.set({
      field: 'project',
      message: 'Bitte ein Projekt wählen — ohne Projekt lässt sich die Zeit nicht abrechnen.',
      invalid: [],
    });
    render();

    const project = byLabel(element, 'Projekt');
    expect(project.getAttribute('aria-invalid')).toBe('true');
    const described = document.getElementById(project.getAttribute('aria-describedby')!);
    expect(described?.textContent).toContain('Bitte ein Projekt wählen');

    host.problem.set({
      field: 'time',
      message: 'Das Ende liegt vor dem Beginn.',
      invalid: ['to'],
    });
    render();
    const to = byLabel(element, 'Bis');
    const from = byLabel(element, 'Von');
    expect(to.getAttribute('aria-invalid')).toBe('true');
    expect(from.getAttribute('aria-invalid')).toBeNull();
    for (const field of [from, to]) {
      const ids = field.getAttribute('aria-describedby')!.split(' ');
      expect(ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).toContain(
        'Das Ende liegt vor dem Beginn.',
      );
    }
    expect(project.getAttribute('aria-invalid')).toBeNull();
  });

  it('speichert per Absenden und per ⌘/Strg+Enter, Enter in der Notiz auch', () => {
    const { host, element, render } = setup();
    host.values.set(VALUES);
    host.mode.set('edit');
    render();

    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    byLabel(element, 'Tag').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    byLabel(element, 'Notiz').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    // Enter allein auf der Auswahl bleibt bei der Auswahl.
    byLabel(element, 'Projekt').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    expect(host.log).toEqual([['save'], ['save'], ['save']]);
  });

  it('speichert nicht doppelt, solange gespeichert wird', () => {
    const { host, element, render } = setup();
    host.values.set(VALUES);
    host.mode.set('edit');
    host.busy.set(true);
    render();

    element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(host.log).toEqual([]);
    expect(
      element.querySelector('.panel-actions .btn-primary')?.getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('meldet Esc nach oben', () => {
    const { host, element, render } = setup();
    host.values.set(VALUES);
    host.mode.set('edit');
    render();

    byLabel(element, 'Von').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(host.log).toEqual([['escape']]);
  });

  it('zeigt den Hinweistext in einer dauerhaften, hoeflichen Live-Region — die Knoepfe daneben', () => {
    const { host, element, render, fixture } = setup();
    host.values.set(VALUES);
    host.mode.set('edit');
    render();

    const live = element.querySelector('.panel-live')!;
    expect(live.getAttribute('role')).toBe('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent?.trim()).toBe('');

    host.notice.set(true);
    host.noticeMessage.set('Erst speichern oder verwerfen — danach öffnet sich der gewählte Eintrag.');
    render();
    expect(element.querySelector('.panel-live')).toBe(live);
    expect(live.textContent).toContain('Ungespeicherte Änderungen');
    expect(live.textContent).toContain('danach öffnet sich der gewählte Eintrag');
    // Sonst hoerte man „Speichern"/„Verwerfen" zweimal: in der Ansage und beim Fokus.
    expect(live.querySelectorAll('button').length).toBe(0);

    fixture.debugElement
      .query((d) => d.componentInstance instanceof EntryPanel)
      .componentInstance.focusNotice();
    expect(document.activeElement?.textContent?.trim()).toBe('Speichern');

    const [keep, discard] = [...element.querySelectorAll<HTMLButtonElement>('.panel-notice-actions button')];
    keep.click();
    discard.click();
    expect(host.log).toEqual([['keep'], ['discard']]);
  });

  it('sagt den Hinweis bei einer neuen Absicht neu an, auch mit gleichem Text', () => {
    const { host, element, render } = setup();
    host.values.set(VALUES);
    host.mode.set('edit');
    host.notice.set(true);
    host.noticeMessage.set('Erst speichern oder verwerfen — danach geht es zur nächsten Woche.');
    host.noticeRevision.set(1);
    render();
    const first = element.querySelector('.panel-live')!.textContent;

    host.noticeRevision.set(2);
    render();
    expect(element.querySelector('.panel-live')!.textContent).not.toBe(first);
  });

  it('sperrt „Speichern" und „Verwerfen" im Hinweis, solange gespeichert wird', () => {
    const { host, element, render } = setup();
    host.values.set(VALUES);
    host.mode.set('edit');
    host.notice.set(true);
    host.busy.set(true);
    render();

    const buttons = [...element.querySelectorAll<HTMLButtonElement>('.panel-notice-actions button')];
    expect(buttons.map((b) => b.getAttribute('aria-disabled'))).toEqual(['true', 'true']);
    buttons.forEach((b) => b.click());
    expect(host.log).toEqual([]);
  });

  it('nennt im Kopf, was Esc tut: beim Anlegen verwerfen, beim Bearbeiten zurueck', () => {
    const { host, element, render } = setup();
    host.values.set(VALUES);
    host.mode.set('create');
    render();
    expect(element.querySelector('.panel-head .hint')?.textContent).toContain(
      'verwirft den Entwurf',
    );

    host.mode.set('edit');
    render();
    expect(element.querySelector('.panel-head .hint')?.textContent).toContain('zurück zum Raster');
  });

  it('setzt den Fokus auf „Projekt" und auf das Feld mit dem Fehler', () => {
    const { host, element, render, fixture } = setup();
    host.values.set(VALUES);
    host.mode.set('edit');
    host.problem.set({ field: 'time', message: 'x', invalid: ['to'] });
    render();
    const panel: EntryPanel = fixture.debugElement.query(
      (d) => d.componentInstance instanceof EntryPanel,
    ).componentInstance;

    panel.focusFirst();
    expect(document.activeElement).toBe(byLabel(element, 'Projekt'));

    panel.focusProblem('time');
    expect(document.activeElement).toBe(byLabel(element, 'Bis'));
  });

  it('haelt jede Schaltflaeche bei mindestens 24 px Zielgroesse (Klassen der Styles-Lib)', () => {
    const { host, element, render } = setup();
    host.values.set(VALUES);
    host.mode.set('edit');
    host.notice.set(true);
    render();

    // .btn = 44 px, .btn-sm = 32 px (components/_button.scss); jsdom rechnet
    // kein Layout, darum die Klassen.
    for (const button of element.querySelectorAll('button')) {
      expect(button.classList).toContain('btn');
    }
  });
});
