import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { RepositoryError, USER_FEEDBACK } from '@lib/shared/data-access-supabase';
import { LEAVE_WITHOUT_ASKING } from '@lib/shared/util-edit';
import { ShellStatus, ToastService } from '@lib/shared/ui';
import { wallToInstant } from '@lib/shared/util-time';
import { TimeEntryRepository } from '@lib/week/data-access';
import { Project, TimeEntry, TimeEntryDraft } from '@lib/week/domain';

import { WeekPage } from './week-page';

const PROJECTS: Project[] = [
  { id: 'p1', name: 'Relaunch', color: '#A8412A', clientName: 'Sandmann GmbH' },
];

/** Dienstag, 17.–19.03.2026 gibt es nicht — wir bleiben in der ruhigen KW 38. */
const ENTRY: TimeEntry = {
  id: 'e1',
  projectId: 'p1',
  startedAt: wallToInstant('2026-09-15', 555), // Di 9:15
  endedAt: wallToInstant('2026-09-15', 660), // bis 11:00
  description: 'Datenmodell',
};

class FakeRepository implements Partial<TimeEntryRepository> {
  rows: TimeEntry[] = [ENTRY];
  updates: Array<{ id: string; patch: Partial<TimeEntryDraft> }> = [];
  created: TimeEntryDraft[] = [];
  removed: string[] = [];
  failLoad: unknown = null;
  failWrite: unknown = null;
  /** Haelt das Laden an, bis das Versprechen erfuellt ist. */
  loadGate: Promise<void> | null = null;
  /** Haelt Schreibzugriffe an (laufendes Speichern). */
  writeGate: Promise<void> | null = null;

  async listProjects(): Promise<Project[]> {
    return PROJECTS;
  }
  async listRange(): Promise<TimeEntry[]> {
    await this.loadGate;
    if (this.failLoad) {
      throw this.failLoad;
    }
    return this.rows;
  }
  async update(id: string, patch: Partial<TimeEntryDraft>): Promise<TimeEntry> {
    this.updates.push({ id, patch });
    await this.writeGate;
    if (this.failWrite) {
      throw this.failWrite;
    }
    return { ...(this.rows.find((row) => row.id === id) ?? ENTRY), ...patch };
  }
  async create(draft: TimeEntryDraft): Promise<TimeEntry> {
    this.created.push(draft);
    if (this.failWrite) {
      throw this.failWrite;
    }
    return { id: `n${this.created.length}`, ...draft };
  }
  async remove(id: string): Promise<void> {
    this.removed.push(id);
  }
}

async function setup(
  rows: TimeEntry[] = [ENTRY],
  week = '2026-09-15',
): Promise<{
  fixture: ComponentFixture<WeekPage>;
  repository: FakeRepository;
  element: HTMLElement;
}> {
  const repository = new FakeRepository();
  repository.rows = rows;
  await TestBed.configureTestingModule({
    imports: [WeekPage],
    providers: [
      { provide: TimeEntryRepository, useValue: repository },
      // Wie in der App: Store-Meldungen landen in den Toasts.
      { provide: USER_FEEDBACK, useExisting: ToastService },
      // Wie in der App: Anmeldeseiten ohne Rueckfrage.
      { provide: LEAVE_WITHOUT_ASKING, useValue: (url: string) => url.startsWith('/login') },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(WeekPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  // Die Wochenansicht startet auf „heute" — fuer den Test auf eine feste Woche.
  const store = fixture.componentInstance['store'];
  await store.showWeekOf(week);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, repository, element: fixture.nativeElement as HTMLElement };
}

function blockOf(element: HTMLElement, id: string): HTMLButtonElement {
  const block = element.querySelector<HTMLButtonElement>(`[data-entry-id="${id}"]`);
  if (!block) {
    throw new Error(`Kein Block mit der Kennung ${id} im Raster`);
  }
  return block;
}

function liveRegionText(element: HTMLElement): string {
  return element.querySelector('[aria-live]')?.textContent?.trim() ?? '';
}

async function press(
  fixture: ComponentFixture<WeekPage>,
  target: HTMLElement,
  key: string,
  shiftKey = false,
): Promise<void> {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('WeekPage: Tastaturbedienung im gerenderten Raster', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('zeigt den Block als Knopf mit sprechender Beschriftung', async () => {
    const { element } = await setup();
    expect(blockOf(element, 'e1').getAttribute('aria-label')).toBe(
      'Relaunch, Dienstag 9:15 bis 11:00, Datenmodell',
    );
  });

  it('verschiebt mit ↑ um eine Viertelstunde, sagt es an und behaelt den Fokus', async () => {
    const { fixture, element } = await setup();
    const block = blockOf(element, 'e1');
    block.focus();

    await press(fixture, block, 'ArrowUp');

    expect(blockOf(element, 'e1').getAttribute('aria-label')).toContain(
      'Relaunch, Dienstag 9:00 bis 10:45',
    );
    expect(liveRegionText(element)).toContain('Relaunch, Dienstag 9:00 bis 10:45');
    expect(document.activeElement?.getAttribute('data-entry-id')).toBe('e1');
  });

  it('aendert mit ⇧ + ↓ die Dauer statt der Lage', async () => {
    const { fixture, element } = await setup();
    const block = blockOf(element, 'e1');
    block.focus();

    await press(fixture, block, 'ArrowDown', true);

    expect(blockOf(element, 'e1').getAttribute('aria-label')).toContain('9:15 bis 11:15');
  });

  /**
   * Regressionstest: Beim Tageswechsel zieht der
   * Block in eine andere Spalte um und wird neu erzeugt. Faellt der Fokus dabei
   * auf `body`, bricht die Tastaturbedienung mitten in der Arbeit ab.
   */
  it('behaelt den Fokus, wenn ← den Tag wechselt', async () => {
    const { fixture, element } = await setup();
    const block = blockOf(element, 'e1');
    block.focus();

    await press(fixture, block, 'ArrowLeft');

    expect(blockOf(element, 'e1').getAttribute('aria-label')).toContain('Montag 9:15 bis 11:00');
    expect(document.activeElement?.getAttribute('data-entry-id')).toBe('e1');
    expect(document.activeElement).not.toBe(document.body);
  });

  it('meldet den Wochenrand, statt still zu scheitern', async () => {
    const { fixture, element } = await setup();
    const block = blockOf(element, 'e1');
    block.focus();

    // Dienstag → Montag → Wochenanfang
    await press(fixture, block, 'ArrowLeft');
    await press(fixture, blockOf(element, 'e1'), 'ArrowLeft');

    expect(liveRegionText(element)).toContain('Ende der Woche erreicht');
    expect(blockOf(element, 'e1').getAttribute('aria-label')).toContain('Montag');
  });

  it('schreibt am Tagesrand nichts und sagt den Rand an', async () => {
    const { fixture, element, repository } = await setup();
    const block = blockOf(element, 'e1');
    block.focus();

    // Erst ans Tagesende, dort erzeugt ein weiteres ↓ keine Aenderung mehr.
    const store = fixture.componentInstance['store'];
    store.nudgeEntry('e1', { dayKey: '2026-09-15', startMinutes: 1335, endMinutes: 1440 });
    await store.flushPending();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const writesBefore = repository.updates.length;
    await press(fixture, blockOf(element, 'e1'), 'ArrowDown');

    expect(repository.updates).toHaveLength(writesBefore);
    expect(liveRegionText(element)).toContain('Ende des Tages erreicht');
  });

  it('oeffnet mit Entf die Rueckfrage und gibt den Fokus danach weiter', async () => {
    const { fixture, element } = await setup();
    const block = blockOf(element, 'e1');
    block.focus();

    await press(fixture, block, 'Delete');

    const warn = element.querySelector('app-warn-dialog dialog');
    expect(warn?.hasAttribute('open')).toBe(true);
    expect(warn?.textContent).toContain('Eintrag löschen?');
    expect(warn?.textContent).toContain('Relaunch, Dienstag 9:15 bis 11:00');
    // Brief: Erstfokus auf „Abbrechen", wer blind Enter drueckt, loescht nichts.
    expect(document.activeElement?.textContent?.trim()).toBe('Abbrechen');
  });

  it('zeigt bei einem Ladefehler einen Fehlerzustand statt eines leeren Rasters', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fixture, repository, element } = await setup();
    repository.failLoad = new RepositoryError('offline', 'Failed to fetch');

    await fixture.componentInstance['store'].shiftWeek(1);
    fixture.detectChanges();

    expect(element.querySelector('.week')?.hasAttribute('hidden')).toBe(true);
    expect(element.querySelector('app-load-error')?.textContent).toContain(
      'Die Woche konnte nicht geladen werden.',
    );

    repository.failLoad = null;
    [...element.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Erneut laden')!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('app-load-error')).toBeNull();
    expect(element.querySelector('.week')?.hasAttribute('hidden')).toBe(false);
    vi.restoreAllMocks();
  });

  it('haelt bei „Erneut laden" Karte und Fokus, bis das Ergebnis da ist', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fixture, repository, element } = await setup();
    const toasts = TestBed.inject(ToastService);
    document.body.appendChild(element);
    repository.failLoad = new RepositoryError('offline', 'Failed to fetch');
    await fixture.componentInstance['store'].shiftWeek(1);
    fixture.detectChanges();
    const retry = element.querySelector<HTMLButtonElement>('app-load-error button')!;
    retry.focus();
    const settle = async (): Promise<void> => {
      await fixture.whenStable();
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();
    };

    let release!: () => void;
    repository.loadGate = new Promise((resolve) => (release = resolve));
    retry.click();
    fixture.detectChanges();
    expect(element.querySelector('app-load-error button')).toBe(retry);
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(retry.textContent?.trim()).toBe('Lädt …');
    expect(document.activeElement).toBe(retry);

    release();
    await settle();
    expect(element.querySelector('app-load-error button')).toBe(retry);
    expect(document.activeElement).toBe(retry);
    expect(toasts.toasts()).toHaveLength(1);

    repository.loadGate = null;
    repository.failLoad = null;
    retry.click();
    await settle();
    expect(element.querySelector('app-load-error')).toBeNull();
    expect(document.activeElement).toBe(element.querySelector('h1'));
    expect(toasts.toasts()).toEqual([]);
    element.remove();
    vi.restoreAllMocks();
  });
});

/* ======================================================================== */
/* Detail-Panel                                                             */
/* ======================================================================== */

/** Lage von ENTRY: Dienstag 9:15–11:00. */
function placementTue() {
  return { dayKey: '2026-09-15' as const, startMinutes: 555, endMinutes: 660 };
}

/** Zweiter Block am selben Dienstag, spaeter: 13:00–14:00. */
const LATER: TimeEntry = {
  id: 'e2',
  projectId: 'p1',
  startedAt: wallToInstant('2026-09-15', 780),
  endedAt: wallToInstant('2026-09-15', 840),
  description: '',
};

/** Wie `NUDGE_DELAY_MS` in week-store.ts: so lange sammelt das Raster Schritte. */
const NUDGE_DELAY_MS = 400;

async function settle(fixture: ComponentFixture<WeekPage>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  // Eine Makrotask weiter; mit Fake Timers, ohne die Uhr vorzustellen.
  await (vi.isFakeTimers()
    ? vi.advanceTimersByTimeAsync(0)
    : new Promise((resolve) => setTimeout(resolve)));
  fixture.detectChanges();
}

function panelOf(element: HTMLElement): HTMLElement {
  return element.querySelector<HTMLElement>('app-entry-panel aside')!;
}

function panelTitle(element: HTMLElement): string {
  return panelOf(element).querySelector('h2')!.textContent!.trim();
}

function field<T extends HTMLElement = HTMLInputElement>(element: HTMLElement, label: string): T {
  const target = [...panelOf(element).querySelectorAll('label')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  const control = target && panelOf(element).querySelector<T>(`#${target.htmlFor}`);
  if (!control) {
    throw new Error(`Kein Feld „${label}" im Panel`);
  }
  return control;
}

async function fill(
  fixture: ComponentFixture<WeekPage>,
  element: HTMLElement,
  label: string,
  value: string,
): Promise<void> {
  const control = field<HTMLInputElement | HTMLSelectElement>(element, label);
  control.value = value;
  control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input'));
  await settle(fixture);
}

async function submit(fixture: ComponentFixture<WeekPage>, element: HTMLElement): Promise<void> {
  panelOf(element)
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { cancelable: true }));
  await settle(fixture);
}

function button(scope: HTMLElement, text: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!found) {
    throw new Error(`Kein Knopf „${text}"`);
  }
  return found;
}

function notice(element: HTMLElement): HTMLElement | null {
  return panelOf(element).querySelector<HTMLElement>('.panel-notice');
}

async function open(
  fixture: ComponentFixture<WeekPage>,
  element: HTMLElement,
  id = 'e1',
): Promise<void> {
  // Enter und Leertaste loesen auf einem <button> den Klick aus.
  blockOf(element, id).click();
  await settle(fixture);
}

describe('WeekPage: Detail-Panel', () => {
  let toasts: ToastService;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  async function mounted(rows?: TimeEntry[], week?: string) {
    const result = await setup(rows, week);
    document.body.appendChild(result.element);
    toasts = TestBed.inject(ToastService);
    return result;
  }

  describe('Zustaende', () => {
    it('steht ohne Auswahl leer da, als Region mit Ueberschrift und Hinweis', async () => {
      const { element } = await mounted();

      expect(panelOf(element).getAttribute('aria-labelledby')).toBeTruthy();
      expect(panelTitle(element)).toBe('Kein Eintrag gewählt');
      expect(panelOf(element).textContent).toContain('Block wählen oder im Raster ziehen.');
    });

    it('steht im DOM hinter dem Raster (Tab: Seitenkopf → Raster → Panel)', async () => {
      const { element } = await mounted();
      const order = [
        element.querySelector('.pagehead'),
        element.querySelector('.week-scroll'),
        element.querySelector('app-entry-panel'),
      ];

      for (let index = 1; index < order.length; index++) {
        expect(
          order[index - 1]!.compareDocumentPosition(order[index]!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    });

    it('oeffnet einen Block per Klick/Enter zum Bearbeiten, Fokus auf „Projekt"', async () => {
      const { fixture, element } = await mounted();
      blockOf(element, 'e1').focus();

      await open(fixture, element);

      expect(panelTitle(element)).toBe('Eintrag bearbeiten');
      expect(document.activeElement).toBe(field(element, 'Projekt'));
      expect(field<HTMLSelectElement>(element, 'Projekt').value).toBe('p1');
      expect(field(element, 'Von').value).toBe('09:15');
      expect(field(element, 'Bis').value).toBe('11:00');
      expect(field<HTMLTextAreaElement>(element, 'Notiz').value).toBe('Datenmodell');
      expect(liveRegionText(element)).toContain('Im Panel: Relaunch, Dienstag 9:15 bis 11:00');
    });

    it('markiert den ausgewaehlten Block mit Ring-Klasse und aria-current', async () => {
      const { fixture, element } = await mounted([ENTRY, LATER]);
      await open(fixture, element);

      expect(blockOf(element, 'e1').getAttribute('aria-current')).toBe('true');
      expect(blockOf(element, 'e1').classList).toContain('is-selected');
      expect(blockOf(element, 'e2').getAttribute('aria-current')).toBeNull();
      expect(blockOf(element, 'e2').classList).not.toContain('is-selected');
    });

    it('legt ueber „Zeit eintragen" an: Entwurfsblock im Raster, ohne Projektvorauswahl', async () => {
      const { fixture, element } = await mounted();

      element.querySelector<HTMLButtonElement>('.pagehead .btn-primary')!.click();
      await settle(fixture);

      expect(panelTitle(element)).toBe('Neuer Eintrag');
      expect(field<HTMLSelectElement>(element, 'Projekt').value).toBe('');
      expect(document.activeElement).toBe(field(element, 'Projekt'));
      expect(element.querySelectorAll('.block.draft')).toHaveLength(1);
      expect(button(panelOf(element), 'Abbrechen')).toBeTruthy();
      expect(() => button(panelOf(element), 'Löschen')).toThrow();
    });

    it('legt nach dem Aufziehen mit den gezogenen Zeiten an', async () => {
      const { fixture, element } = await mounted();
      fixture.componentInstance.drawn({ dayKey: '2026-09-16', startMinutes: 600, endMinutes: 690 });
      await settle(fixture);

      expect(panelTitle(element)).toBe('Neuer Eintrag');
      expect(field<HTMLSelectElement>(element, 'Tag').value).toBe('2026-09-16');
      expect(field(element, 'Von').value).toBe('10:00');
      expect(field(element, 'Bis').value).toBe('11:30');
      const draft = element.querySelector<HTMLElement>('.block.draft')!;
      expect(draft.style.top).toBe('600px');
      expect(draft.style.height).toBe('90px');
    });

    it('zieht den Entwurfsblock mit, wenn die Zeiten im Panel geaendert werden', async () => {
      const { fixture, element } = await mounted();
      fixture.componentInstance.drawn({ dayKey: '2026-09-16', startMinutes: 600, endMinutes: 690 });
      await settle(fixture);

      await fill(fixture, element, 'Bis', '12:00');

      expect(element.querySelector<HTMLElement>('.block.draft')!.style.height).toBe('120px');
    });
  });

  describe('Speichern', () => {
    it('speichert eine Aenderung, meldet per Toast und bleibt mit dem Eintrag offen', async () => {
      const { fixture, element, repository } = await mounted();
      await open(fixture, element);

      await fill(fixture, element, 'Von', '09:00');
      await fill(fixture, element, 'Notiz', 'Neu');
      await submit(fixture, element);

      expect(repository.updates.at(-1)?.patch.description).toBe('Neu');
      expect(toasts.toasts().map((toast) => toast.message)).toEqual(['Eintrag geändert']);
      expect(panelTitle(element)).toBe('Eintrag bearbeiten');
      expect(field(element, 'Von').value).toBe('09:00');
      expect(blockOf(element, 'e1').getAttribute('aria-current')).toBe('true');
      // Erfolg nur als Toast — die Raster-Region wiederholt ihn nicht.
      expect(liveRegionText(element)).not.toContain('geändert');
    });

    it('legt an und haelt danach den neuen Eintrag ausgewaehlt', async () => {
      const { fixture, element, repository } = await mounted();
      fixture.componentInstance.drawn({ dayKey: '2026-09-16', startMinutes: 600, endMinutes: 690 });
      await settle(fixture);

      await fill(fixture, element, 'Projekt', 'p1');
      await submit(fixture, element);

      expect(repository.created).toHaveLength(1);
      expect(toasts.toasts().map((toast) => toast.message)).toEqual(['Eintrag gespeichert']);
      expect(panelTitle(element)).toBe('Eintrag bearbeiten');
      expect(blockOf(element, 'n1').getAttribute('aria-current')).toBe('true');
      expect(element.querySelector('.block.draft')).toBeNull();
      expect(button(panelOf(element), 'Löschen')).toBeTruthy();
    });

    it('laesst bei einem Schreibfehler die Eingaben stehen (Toast, Panel bleibt)', async () => {
      const { fixture, element, repository } = await mounted();
      await open(fixture, element);
      repository.failWrite = new RepositoryError('offline', 'Failed to fetch');

      await fill(fixture, element, 'Notiz', 'Nicht verlieren');
      await submit(fixture, element);

      expect(toasts.toasts()[0].kind).toBe('error');
      expect(panelTitle(element)).toBe('Eintrag bearbeiten');
      expect(field<HTMLTextAreaElement>(element, 'Notiz').value).toBe('Nicht verlieren');
    });

    it('laesst beim Anlegen nach einem Schreibfehler den Entwurf stehen', async () => {
      const { fixture, element, repository } = await mounted();
      repository.failWrite = new RepositoryError('offline', 'Failed to fetch');
      fixture.componentInstance.drawn({ dayKey: '2026-09-16', startMinutes: 600, endMinutes: 690 });
      await settle(fixture);

      await fill(fixture, element, 'Projekt', 'p1');
      await submit(fixture, element);

      expect(toasts.toasts()[0].kind).toBe('error');
      expect(panelTitle(element)).toBe('Neuer Eintrag');
      expect(field<HTMLSelectElement>(element, 'Projekt').value).toBe('p1');
      expect(element.querySelectorAll('.block.draft')).toHaveLength(1);
    });

    // Validierungen wie im frueheren Dialog — Text am Feld, aria-describedby.
    it('zeigt „kein Projekt" am Feld und setzt den Fokus dorthin', async () => {
      const { fixture, element, repository } = await mounted();
      fixture.componentInstance.drawn({ dayKey: '2026-09-16', startMinutes: 600, endMinutes: 690 });
      await settle(fixture);

      await submit(fixture, element);

      const project = field<HTMLSelectElement>(element, 'Projekt');
      expect(repository.created).toEqual([]);
      expect(project.getAttribute('aria-invalid')).toBe('true');
      expect(
        document.getElementById(project.getAttribute('aria-describedby')!)?.textContent,
      ).toContain('Bitte ein Projekt wählen — ohne Projekt lässt sich die Zeit nicht abrechnen.');
      expect(document.activeElement).toBe(project);
    });

    it('rundet sichtbar auf Viertelstunden und speichert erst beim zweiten Mal', async () => {
      const { fixture, element, repository } = await mounted();
      await open(fixture, element);

      await fill(fixture, element, 'Von', '09:08');
      await submit(fixture, element);

      expect(repository.updates).toEqual([]);
      expect(field(element, 'Von').value).toBe('09:15');
      expect(panelOf(element).textContent).toContain(
        'Auf Viertelstunden gerundet: 09:15 bis 11:00.',
      );

      await submit(fixture, element);
      expect(repository.updates).toHaveLength(1);
    });

    it('lehnt ein Ende vor dem Beginn am Feld „Bis" ab', async () => {
      const { fixture, element, repository } = await mounted();
      await open(fixture, element);

      await fill(fixture, element, 'Bis', '09:00');
      await submit(fixture, element);

      const to = field(element, 'Bis');
      expect(repository.updates).toEqual([]);
      expect(to.getAttribute('aria-invalid')).toBe('true');
      expect(panelOf(element).textContent).toContain('Das Ende liegt vor dem Beginn.');
      expect(document.activeElement).toBe(to);
    });

    /**
     * Fruehjahrsumstellung: 02:00–03:00 am 29.03.2026 gibt es nicht. Gespeichert
     * wird hinter dem Sprung, und das Panel zeigt danach genau diese Zeit — nicht
     * die eingegebene.
     */
    it('zeigt nach dem Speichern in der Umstellungsluecke die tatsaechlich gespeicherte Zeit', async () => {
      const { fixture, element, repository } = await mounted([], '2026-03-29');
      fixture.componentInstance.drawn({ dayKey: '2026-03-29', startMinutes: 120, endMinutes: 180 });
      await settle(fixture);

      await fill(fixture, element, 'Projekt', 'p1');
      await submit(fixture, element);

      expect(repository.created).toHaveLength(1);
      expect(field(element, 'Von').value).toBe('03:00');
      expect(field(element, 'Bis').value).toBe('04:00');
      expect(toasts.toasts()[0].detail).toBe('Relaunch, Sonntag 3:00 bis 4:00');
    });

    it('speichert einen Eintrag ueber Mitternacht nicht und laesst die Eingabe stehen', async () => {
      const overnight: TimeEntry = {
        id: 'e9',
        projectId: 'p1',
        startedAt: wallToInstant('2026-09-15', 1380),
        endedAt: wallToInstant('2026-09-16', 60),
        description: '',
      };
      const { fixture, element, repository } = await mounted([overnight]);
      await open(fixture, element, 'e9');

      await fill(fixture, element, 'Notiz', 'Spaet');
      await submit(fixture, element);

      expect(repository.updates).toEqual([]);
      expect(toasts.toasts()[0].message).toBe('Dieser Eintrag reicht über Mitternacht hinaus.');
      expect(field<HTMLTextAreaElement>(element, 'Notiz').value).toBe('Spaet');
    });
  });

  describe('Fokus und Esc', () => {
    it('Esc im Panel fuehrt beim Bearbeiten zurueck auf den Block, der ausgewaehlt bleibt', async () => {
      const { fixture, element } = await mounted();
      await open(fixture, element);

      await press(fixture, field(element, 'Von'), 'Escape');
      await settle(fixture);

      expect(document.activeElement).toBe(blockOf(element, 'e1'));
      expect(blockOf(element, 'e1').getAttribute('aria-current')).toBe('true');
      expect(panelTitle(element)).toBe('Eintrag bearbeiten');
    });

    it('ein zweites Esc auf dem Block hebt die Auswahl auf', async () => {
      const { fixture, element } = await mounted();
      await open(fixture, element);
      await press(fixture, field(element, 'Von'), 'Escape');
      await settle(fixture);

      await press(fixture, blockOf(element, 'e1'), 'Escape');
      await settle(fixture);

      expect(panelTitle(element)).toBe('Kein Eintrag gewählt');
      expect(blockOf(element, 'e1').getAttribute('aria-current')).toBeNull();
      expect(document.activeElement).toBe(blockOf(element, 'e1'));
      expect(liveRegionText(element)).toContain('Auswahl aufgehoben');
    });

    it('Esc beim Anlegen verwirft den Entwurf und fuehrt zum Ausloeser zurueck', async () => {
      const { fixture, element } = await mounted();
      const add = element.querySelector<HTMLButtonElement>('.pagehead .btn-primary')!;
      add.focus();
      add.click();
      await settle(fixture);

      await press(fixture, field(element, 'Von'), 'Escape');
      await settle(fixture);

      expect(panelTitle(element)).toBe('Kein Eintrag gewählt');
      expect(element.querySelector('.block.draft')).toBeNull();
      expect(document.activeElement).toBe(add);
    });

    it('Esc nach dem Aufziehen fuehrt zurueck ins Raster', async () => {
      const { fixture, element } = await mounted();
      fixture.componentInstance.drawn({ dayKey: '2026-09-16', startMinutes: 600, endMinutes: 690 });
      await settle(fixture);

      await press(fixture, field(element, 'Von'), 'Escape');
      await settle(fixture);

      expect(document.activeElement).toBe(element.querySelector('.week-scroll'));
    });

    it('Esc beim Anlegen mit Getipptem fragt erst (Hinweis, Fokus auf „Speichern")', async () => {
      const { fixture, element } = await mounted();
      fixture.componentInstance.drawn({ dayKey: '2026-09-16', startMinutes: 600, endMinutes: 690 });
      await settle(fixture);
      await fill(fixture, element, 'Notiz', 'Angefangen');

      await press(fixture, field(element, 'Notiz'), 'Escape');
      await settle(fixture);

      expect(panelTitle(element)).toBe('Neuer Eintrag');
      expect(notice(element)).not.toBeNull();
      expect(document.activeElement?.textContent?.trim()).toBe('Speichern');
    });

    it('„Abbrechen" verwirft ausdruecklich ohne Rueckfrage', async () => {
      const { fixture, element, repository } = await mounted();
      await open(fixture, element);
      await fill(fixture, element, 'Notiz', 'Weg damit');

      button(panelOf(element), 'Abbrechen').click();
      await settle(fixture);

      expect(panelTitle(element)).toBe('Kein Eintrag gewählt');
      expect(repository.updates).toEqual([]);
      expect(document.activeElement).toBe(blockOf(element, 'e1'));
    });

    it('setzt nach dem Loeschen den Fokus auf den naechsten Block desselben Tages', async () => {
      const { fixture, element, repository } = await mounted([ENTRY, LATER]);
      await open(fixture, element);

      button(panelOf(element), 'Löschen').click();
      await settle(fixture);
      const warn = element.querySelector<HTMLElement>('app-warn-dialog dialog')!;
      expect(warn.textContent).toContain('Relaunch, Dienstag 9:15 bis 11:00');
      button(warn, 'Löschen').click();
      await settle(fixture);

      expect(repository.removed).toEqual(['e1']);
      expect(panelTitle(element)).toBe('Kein Eintrag gewählt');
      expect(document.activeElement).toBe(blockOf(element, 'e2'));
      expect(toasts.toasts().map((toast) => toast.message)).toEqual(['Eintrag gelöscht']);
    });

    it('setzt nach dem Loeschen des letzten Blocks des Tages den Fokus auf das Raster', async () => {
      const { fixture, element } = await mounted();
      blockOf(element, 'e1').focus();
      await press(fixture, blockOf(element, 'e1'), 'Delete');

      button(element.querySelector('app-warn-dialog dialog')!, 'Löschen').click();
      await settle(fixture);

      expect(document.activeElement).toBe(element.querySelector('.week-scroll'));
      expect(document.activeElement).not.toBe(element.querySelector('.pagehead .btn-primary'));
    });
  });

  describe('Ungespeicherte Aenderungen', () => {
    async function dirtyOnE1() {
      const result = await mounted([ENTRY, LATER]);
      await open(result.fixture, result.element);
      await fill(result.fixture, result.element, 'Notiz', 'Halb fertig');
      return result;
    }

    it('wechselt die Auswahl nicht, sondern zeigt den Hinweis und fokussiert „Speichern"', async () => {
      const { fixture, element } = await dirtyOnE1();

      await open(fixture, element, 'e2');

      expect(blockOf(element, 'e1').getAttribute('aria-current')).toBe('true');
      expect(field<HTMLTextAreaElement>(element, 'Notiz').value).toBe('Halb fertig');
      expect(notice(element)?.textContent).toContain('Ungespeicherte Änderungen');
      const live = notice(element)!.querySelector('[aria-live="polite"]')!;
      expect(live.textContent).toContain('danach öffnet sich der gewählte Eintrag');
      expect(live.querySelector('button')).toBeNull();
      expect(document.activeElement?.textContent?.trim()).toBe('Speichern');
    });

    it('„Verwerfen" fuehrt danach die gewuenschte Auswahl aus', async () => {
      const { fixture, element, repository } = await dirtyOnE1();
      await open(fixture, element, 'e2');

      button(notice(element)!, 'Verwerfen').click();
      await settle(fixture);

      expect(repository.updates).toEqual([]);
      expect(blockOf(element, 'e2').getAttribute('aria-current')).toBe('true');
      expect(field<HTMLTextAreaElement>(element, 'Notiz').value).toBe('');
      expect(notice(element)).toBeNull();
      expect(document.activeElement).toBe(field(element, 'Projekt'));
    });

    it('„Speichern" speichert und fuehrt danach die Aktion aus', async () => {
      const { fixture, element, repository } = await dirtyOnE1();
      await open(fixture, element, 'e2');

      button(notice(element)!, 'Speichern').click();
      await settle(fixture);

      expect(repository.updates.at(-1)).toMatchObject({
        id: 'e1',
        patch: { description: 'Halb fertig' },
      });
      expect(blockOf(element, 'e2').getAttribute('aria-current')).toBe('true');
      expect(notice(element)).toBeNull();
    });

    it('haelt alles an, wenn das Speichern aus dem Hinweis scheitert', async () => {
      const { fixture, element, repository } = await dirtyOnE1();
      await open(fixture, element, 'e2');
      repository.failWrite = new RepositoryError('offline', 'Failed to fetch');

      button(notice(element)!, 'Speichern').click();
      await settle(fixture);

      expect(blockOf(element, 'e1').getAttribute('aria-current')).toBe('true');
      expect(field<HTMLTextAreaElement>(element, 'Notiz').value).toBe('Halb fertig');
      expect(notice(element)).not.toBeNull();
      expect(toasts.toasts()[0].kind).toBe('error');
    });

    it('legt auch per Aufziehen und „Zeit eintragen" nicht still neu an', async () => {
      const { fixture, element } = await dirtyOnE1();

      fixture.componentInstance.drawn({ dayKey: '2026-09-16', startMinutes: 600, endMinutes: 690 });
      await settle(fixture);
      expect(panelTitle(element)).toBe('Eintrag bearbeiten');

      button(notice(element)!, 'Verwerfen').click();
      await settle(fixture);
      expect(panelTitle(element)).toBe('Neuer Eintrag');
      expect(field(element, 'Von').value).toBe('10:00');
    });

    it('wechselt die Woche erst nach „Speichern"/„Verwerfen"', async () => {
      const { fixture, element } = await dirtyOnE1();
      const store = fixture.componentInstance['store'];

      element.querySelector<HTMLButtonElement>('[aria-label="Nächste Woche"]')!.click();
      await settle(fixture);
      expect(store.weekStart()).toBe('2026-09-14');
      expect(notice(element)).not.toBeNull();

      button(notice(element)!, 'Verwerfen').click();
      await settle(fixture);
      expect(store.weekStart()).toBe('2026-09-21');
      expect(panelTitle(element)).toBe('Kein Eintrag gewählt');
    });

    it('haelt beim Verlassen der Route an und navigiert nach „Verwerfen"', async () => {
      const { fixture, element } = await dirtyOnE1();
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      const page = fixture.componentInstance;

      expect(page.canLeave('/projects')).toBe(false);
      await settle(fixture);
      expect(notice(element)).not.toBeNull();
      expect(document.activeElement?.textContent?.trim()).toBe('Speichern');

      button(notice(element)!, 'Verwerfen').click();
      await settle(fixture);
      expect(navigate).toHaveBeenCalledWith('/projects');
      expect(page.canLeave('/projects')).toBe(true);
    });

    it('laesst ohne Aenderungen und beim Abmelden sofort gehen', async () => {
      const { fixture, element } = await mounted();
      const page = fixture.componentInstance;
      expect(page.canLeave('/reports')).toBe(true);

      await open(fixture, element);
      await fill(fixture, element, 'Notiz', 'x');
      expect(page.canLeave('/login')).toBe(true);
    });
  });

  describe('Raster ↔ Panel', () => {
    it('uebernimmt Von/Bis, wenn der Block per Tastatur verschoben wird', async () => {
      const { fixture, element } = await mounted();
      await open(fixture, element);

      blockOf(element, 'e1').focus();
      await press(fixture, blockOf(element, 'e1'), 'ArrowUp');
      await settle(fixture);

      expect(field(element, 'Von').value).toBe('09:00');
      expect(field(element, 'Bis').value).toBe('10:45');
      expect(notice(element)).toBeNull();
      // Der Fokus bleibt beim Verschieben auf dem Block.
      expect(document.activeElement).toBe(blockOf(element, 'e1'));
    });

    it('uebernimmt den Tag, wenn der Block mit der Maus verschoben wird', async () => {
      const { fixture, element } = await mounted();
      await open(fixture, element);

      fixture.componentInstance.moved('e1', {
        dayKey: '2026-09-16',
        startMinutes: 600,
        endMinutes: 705,
      });
      await settle(fixture);

      expect(field<HTMLSelectElement>(element, 'Tag').value).toBe('2026-09-16');
      expect(field(element, 'Von').value).toBe('10:00');
    });

    it('Notiz getippt, Block verschoben: kein Hinweis, Speichern schreibt Notiz und neue Lage', async () => {
      const { fixture, element, repository } = await mounted();
      await open(fixture, element);
      await fill(fixture, element, 'Notiz', 'Getippt');

      blockOf(element, 'e1').focus();
      await press(fixture, blockOf(element, 'e1'), 'ArrowUp');
      await settle(fixture);

      expect(notice(element)).toBeNull();
      expect(field(element, 'Von').value).toBe('09:00');
      expect(field<HTMLTextAreaElement>(element, 'Notiz').value).toBe('Getippt');
      expect(document.activeElement).toBe(blockOf(element, 'e1'));

      await submit(fixture, element);
      expect(repository.updates.at(-1)).toEqual({
        id: 'e1',
        patch: {
          projectId: 'p1',
          description: 'Getippt',
          startedAt: wallToInstant('2026-09-15', 540),
          endedAt: wallToInstant('2026-09-15', 645),
        },
      });
    });

    async function conflictOnTo() {
      const result = await mounted();
      const { fixture, element } = result;
      await open(fixture, element);
      await fill(fixture, element, 'Bis', '11:30');
      blockOf(element, 'e1').focus();
      await press(fixture, blockOf(element, 'e1'), 'ArrowDown', true);
      await settle(fixture);
      return result;
    }

    it('Bis getippt, ⇧↓ im Raster: Hinweis sagt, was Speichern und Verwerfen tun — Fokus bleibt am Block', async () => {
      const { element } = await conflictOnTo();

      expect(field(element, 'Bis').value).toBe('11:30');
      expect(notice(element)?.textContent).toContain(
        'Die Zeit wurde im Raster geändert (jetzt 9:15–11:15). ' +
          'Speichern übernimmt deine Eingabe 9:15–11:30, Verwerfen behält das Raster.',
      );
      expect(document.activeElement).toBe(blockOf(element, 'e1'));
    });

    it('Konflikt „Speichern" schreibt die getippte Zeit und gibt den Fokus an den Block zurueck', async () => {
      const { fixture, element, repository } = await conflictOnTo();

      const save = button(notice(element)!, 'Speichern');
      save.focus();
      save.click();
      await settle(fixture);

      expect(repository.updates.at(-1)).toMatchObject({
        id: 'e1',
        patch: { endedAt: wallToInstant('2026-09-15', 690) },
      });
      expect(notice(element)).toBeNull();
      expect(field(element, 'Bis').value).toBe('11:30');
      expect(document.activeElement).toBe(blockOf(element, 'e1'));
    });

    it('Konflikt „Verwerfen" behaelt die Rasterzeit; der Fokus geht zurueck an den Block', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { fixture, element, repository } = await conflictOnTo();

      const discard = button(notice(element)!, 'Verwerfen');
      discard.focus();
      discard.click();
      await settle(fixture);
      await vi.advanceTimersByTimeAsync(NUDGE_DELAY_MS);
      await settle(fixture);

      expect(field(element, 'Bis').value).toBe('11:15');
      expect(notice(element)).toBeNull();
      expect(repository.updates.at(-1)).toMatchObject({
        id: 'e1',
        patch: { endedAt: wallToInstant('2026-09-15', 675) },
      });
      expect(document.activeElement).toBe(blockOf(element, 'e1'));
    });

    it('Tag getippt, → im Raster: Konflikt; Speichern schreibt den getippten Tag', async () => {
      const { fixture, element, repository } = await mounted();
      await open(fixture, element);
      await fill(fixture, element, 'Tag', '2026-09-17');
      blockOf(element, 'e1').focus();
      await press(fixture, blockOf(element, 'e1'), 'ArrowRight');
      await settle(fixture);

      expect(field<HTMLSelectElement>(element, 'Tag').value).toBe('2026-09-17');
      expect(notice(element)?.textContent).toContain(
        'Der Tag wurde im Raster geändert (jetzt Mittwoch). ' +
          'Speichern übernimmt deine Eingabe Donnerstag, Verwerfen behält das Raster.',
      );

      button(notice(element)!, 'Speichern').click();
      await settle(fixture);
      expect(repository.updates.at(-1)).toMatchObject({
        id: 'e1',
        patch: { startedAt: wallToInstant('2026-09-17', 555) },
      });
    });

    it('Tag getippt, → im Raster: Verwerfen behaelt den Rastertag; Fokus aufs erste Feld, wenn er nicht am Block war', async () => {
      const { fixture, element } = await mounted();
      await open(fixture, element);
      await fill(fixture, element, 'Tag', '2026-09-17');
      fixture.componentInstance.moved('e1', { ...placementTue(), dayKey: '2026-09-16' });
      await settle(fixture);
      field(element, 'Notiz').focus();

      button(notice(element)!, 'Verwerfen').click();
      await settle(fixture);

      expect(field<HTMLSelectElement>(element, 'Tag').value).toBe('2026-09-16');
      expect(document.activeElement).toBe(field(element, 'Projekt'));
    });
  });

  describe('Overlay-Randfaelle', () => {
    it('Bis getippt, ⇧↓ holt es genau ein: nicht mehr ungespeichert, der naechste Block oeffnet ohne Hinweis', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { fixture, element, repository } = await mounted([ENTRY, LATER]);
      await open(fixture, element);
      await fill(fixture, element, 'Bis', '11:15');
      blockOf(element, 'e1').focus();
      await press(fixture, blockOf(element, 'e1'), 'ArrowDown', true);
      await settle(fixture);
      await vi.advanceTimersByTimeAsync(NUDGE_DELAY_MS);
      await settle(fixture);
      const writes = repository.updates.length;

      await open(fixture, element, 'e2');

      expect(notice(element)).toBeNull();
      expect(fixture.componentInstance['panel'].entryId()).toBe('e2');
      // Kein zweiter, identischer Schreibzugriff.
      expect(repository.updates).toHaveLength(writes);
    });
  });

  // Ein fremdes optimistisches Update holt das Getippte
  // ein, scheitert dann und rollt zurueck — das Getippte bleibt.
  describe('Fremder Schreibvorgang mit Rollback', () => {
    it('Bis 11:15 getippt, ⇧↓ auf 11:15, Schreiben scheitert: 11:15 steht noch im Panel', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { fixture, element, repository } = await mounted();
      await open(fixture, element);
      await fill(fixture, element, 'Bis', '11:15');
      repository.failWrite = new RepositoryError('offline', 'Failed to fetch');

      blockOf(element, 'e1').focus();
      await press(fixture, blockOf(element, 'e1'), 'ArrowDown', true);
      await settle(fixture);
      // Optimistisch genau der getippte Wert — noch nicht bestaetigt.
      expect(field(element, 'Bis').value).toBe('11:15');
      expect(fixture.componentInstance['panel'].dirty()).toBe(true);

      await vi.advanceTimersByTimeAsync(NUDGE_DELAY_MS);
      await settle(fixture);

      // Das Raster steht wieder auf 11:00, das Getippte ist noch da.
      expect(blockOf(element, 'e1').getAttribute('aria-label')).toContain('11:00');
      expect(field(element, 'Bis').value).toBe('11:15');
      expect(fixture.componentInstance['panel'].dirty()).toBe(true);
    });

    it('… und gelingt es, ist das Feld bestaetigt und nicht mehr ungespeichert', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { fixture, element } = await mounted();
      await open(fixture, element);
      await fill(fixture, element, 'Bis', '11:15');

      blockOf(element, 'e1').focus();
      await press(fixture, blockOf(element, 'e1'), 'ArrowDown', true);
      await vi.advanceTimersByTimeAsync(NUDGE_DELAY_MS);
      await settle(fixture);

      expect(field(element, 'Bis').value).toBe('11:15');
      expect(fixture.componentInstance['panel'].dirty()).toBe(false);
    });
  });

  // Kann ein Block bei ungespeichertem Panel ueber die
  // Wochengrenze? Nein — Tastatur und Maus bleiben in der Woche. Diese Tests
  // halten das fest, damit das Getippte nie still mit dem Block verschwindet.
  describe('Wochengrenze bei ungespeichertem Panel', () => {
    const SUNDAY: TimeEntry = {
      ...ENTRY,
      id: 'e7',
      startedAt: wallToInstant('2026-09-20', 555),
      endedAt: wallToInstant('2026-09-20', 660),
    };

    it('→ am Sonntag bleibt in der Woche, sagt den Rand an und behaelt das Getippte', async () => {
      const { fixture, element, repository } = await mounted([SUNDAY]);
      await open(fixture, element, 'e7');
      await fill(fixture, element, 'Notiz', 'Getippt');
      blockOf(element, 'e7').focus();

      await press(fixture, blockOf(element, 'e7'), 'ArrowRight');
      await settle(fixture);

      expect(liveRegionText(element)).toContain('Ende der Woche erreicht');
      expect(repository.updates).toEqual([]);
      expect(panelTitle(element)).toBe('Eintrag bearbeiten');
      expect(field<HTMLTextAreaElement>(element, 'Notiz').value).toBe('Getippt');
      expect(fixture.componentInstance['panel'].dirty()).toBe(true);
    });

    it('← am Montag ebenso', async () => {
      const MONDAY: TimeEntry = {
        ...ENTRY,
        id: 'e8',
        startedAt: wallToInstant('2026-09-14', 555),
        endedAt: wallToInstant('2026-09-14', 660),
      };
      const { fixture, element, repository } = await mounted([MONDAY]);
      await open(fixture, element, 'e8');
      await fill(fixture, element, 'Notiz', 'Getippt');

      await press(fixture, blockOf(element, 'e8'), 'ArrowLeft');
      await settle(fixture);

      expect(liveRegionText(element)).toContain('Ende der Woche erreicht');
      expect(repository.updates).toEqual([]);
      expect(field<HTMLTextAreaElement>(element, 'Notiz').value).toBe('Getippt');
    });

    it('mit der Maus haelt die Zielspalte am Rand der Woche fest', async () => {
      const { fixture } = await mounted();
      const page = fixture.componentInstance;

      // Weit rechts bzw. links neben dem Raster: Sonntag bzw. Montag derselben Woche.
      expect(page.dayAt(1e6)).toBe('2026-09-20');
      expect(page.dayAt(-1e6)).toBe('2026-09-14');
    });
  });

  describe('Absichten waehrend des Speicherns', () => {
    async function savingE1() {
      const result = await mounted([ENTRY, LATER]);
      const { fixture, element, repository } = result;
      await open(fixture, element);
      await fill(fixture, element, 'Notiz', 'Halb fertig');
      let release!: () => void;
      repository.writeGate = new Promise((resolve) => (release = resolve));
      // Enter im Feld: speichert, der Server antwortet noch nicht.
      await submit(fixture, element);
      return { ...result, release };
    }

    it('Enter speichert, sofort Klick auf Block B: nach dem Erfolg ist B gewaehlt, ohne Hinweis und ohne Ruecksprung', async () => {
      const { fixture, element, release } = await savingE1();

      await open(fixture, element, 'e2');
      expect(notice(element)).toBeNull();
      expect(blockOf(element, 'e1').getAttribute('aria-current')).toBe('true');

      release();
      await settle(fixture);
      await settle(fixture);

      expect(blockOf(element, 'e2').getAttribute('aria-current')).toBe('true');
      expect(blockOf(element, 'e1').getAttribute('aria-current')).toBeNull();
      expect(notice(element)).toBeNull();
      expect(document.activeElement).toBe(field(element, 'Projekt'));
    });

    it('Wochenwechsel waehrend des Speicherns: danach die naechste Woche, Fokus auf dem Knopf', async () => {
      const { fixture, element, release } = await savingE1();
      const store = fixture.componentInstance['store'];
      const next = element.querySelector<HTMLButtonElement>('[aria-label="Nächste Woche"]')!;

      next.focus();
      next.click();
      await settle(fixture);
      expect(store.weekStart()).toBe('2026-09-14');
      expect(notice(element)).toBeNull();

      release();
      await settle(fixture);
      await settle(fixture);
      expect(store.weekStart()).toBe('2026-09-21');
      expect(notice(element)).toBeNull();
      expect(document.activeElement).toBe(next);
    });

    it('Route verlassen waehrend des Speicherns: danach wird navigiert', async () => {
      const { fixture, element, release } = await savingE1();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      const page = fixture.componentInstance;

      expect(page.canLeave('/projects')).toBe(false);
      await settle(fixture);
      expect(notice(element)).toBeNull();

      release();
      await settle(fixture);
      await settle(fixture);
      expect(navigate).toHaveBeenCalledWith('/projects');
    });

    it('scheitert das Speichern, bleibt die Absicht geparkt und der Hinweis erscheint', async () => {
      const { fixture, element, repository, release } = await savingE1();
      repository.failWrite = new RepositoryError('offline', 'Failed to fetch');

      await open(fixture, element, 'e2');
      release();
      await settle(fixture);
      await settle(fixture);

      expect(blockOf(element, 'e1').getAttribute('aria-current')).toBe('true');
      expect(notice(element)?.textContent).toContain('danach öffnet sich der gewählte Eintrag');
      expect(document.activeElement?.textContent?.trim()).toBe('Speichern');
      // Der Toast passt zum Panel: dort ist nichts zurueckgesetzt.
      expect(toasts.toasts()[0].detail).toContain('Deine Eingaben stehen noch im Panel.');
      expect(toasts.toasts()[0].detail).not.toContain('zurückgesetzt');
    });

    it('sperrt „Verwerfen" im Hinweis, solange gespeichert wird', async () => {
      const { fixture, element, repository } = await mounted([ENTRY, LATER]);
      await open(fixture, element);
      await fill(fixture, element, 'Notiz', 'Halb fertig');
      await open(fixture, element, 'e2');
      let release!: () => void;
      repository.writeGate = new Promise((resolve) => (release = resolve));

      const save = button(notice(element)!, 'Speichern');
      save.focus();
      save.click();
      await settle(fixture);
      // Der Hinweis bleibt stehen (der Fokus faellt nicht ins Leere), gesperrt.
      expect(document.activeElement).toBe(save);
      const discard = button(notice(element)!, 'Verwerfen');
      expect(save.getAttribute('aria-disabled')).toBe('true');
      expect(discard.getAttribute('aria-disabled')).toBe('true');
      discard.click();
      await settle(fixture);
      expect(fixture.componentInstance['panel'].busy()).toBe(true);

      release();
      await settle(fixture);
      await settle(fixture);
      expect(repository.updates.at(-1)).toMatchObject({ patch: { description: 'Halb fertig' } });
      expect(blockOf(element, 'e2').getAttribute('aria-current')).toBe('true');
    });
  });

  describe('Fokus nach dem Hinweis', () => {
    it('nach Wochenwechsel per Hinweis: auf den Knopf, der die Woche wechseln wollte', async () => {
      const { fixture, element } = await mounted();
      await open(fixture, element);
      await fill(fixture, element, 'Notiz', 'x');
      const previous = element.querySelector<HTMLButtonElement>('[aria-label="Vorherige Woche"]')!;
      previous.focus();
      previous.click();
      await settle(fixture);
      expect(document.activeElement?.textContent?.trim()).toBe('Speichern');

      button(notice(element)!, 'Verwerfen').click();
      await settle(fixture);

      expect(fixture.componentInstance['store'].weekStart()).toBe('2026-09-07');
      expect(document.activeElement).toBe(previous);
    });

    it('ohne Ausloeser auf die Wochenueberschrift', async () => {
      const { fixture, element } = await mounted();
      await open(fixture, element);
      await fill(fixture, element, 'Notiz', 'x');
      fixture.componentInstance['onNextWeek']();
      await settle(fixture);

      button(notice(element)!, 'Speichern').click();
      await settle(fixture);
      await settle(fixture);

      expect(document.activeElement).toBe(element.querySelector('h1'));
    });
  });

  describe('Browser-Zurueck mit ungespeichertem Panel', () => {
    it('geht nach „Verwerfen" im Verlauf dorthin, statt einen neuen Eintrag anzulegen', async () => {
      const { fixture, element } = await mounted();
      await open(fixture, element);
      await fill(fixture, element, 'Notiz', 'x');
      const page = fixture.componentInstance;
      const router = TestBed.inject(Router);
      const location = TestBed.inject(Location);
      page['routeLeave']['here'] = 3;
      vi.spyOn(router, 'currentNavigation').mockReturnValue({ trigger: 'popstate' } as never);
      vi.spyOn(location, 'getState').mockReturnValue({ navigationId: 7, ɵrouterPageId: 2 });
      const go = vi.spyOn(location, 'historyGo').mockImplementation(() => undefined);
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      expect(page.canLeave('/projects')).toBe(false);
      await settle(fixture);
      button(notice(element)!, 'Verwerfen').click();
      await settle(fixture);

      expect(go).toHaveBeenCalledWith(-1);
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('Toasts neben dem Panel', () => {
    it('setzt das Panel-Merkmal am <html>, solange die Seite steht', async () => {
      const { fixture } = await mounted();
      expect(document.documentElement.hasAttribute('data-side-panel')).toBe(true);

      fixture.destroy();
      expect(document.documentElement.hasAttribute('data-side-panel')).toBe(false);
    });
  });

  it('nennt in der Statusleiste Enter als „im Panel"', async () => {
    const { fixture } = await mounted();
    const status = TestBed.inject(ShellStatus).snapshot();
    fixture.detectChanges();

    expect(status.shortcuts?.find((shortcut) => shortcut.keys[0] === 'Enter')?.label).toBe(
      'im Panel',
    );
  });
});
