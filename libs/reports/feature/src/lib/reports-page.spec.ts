import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReportRepository } from '@lib/reports/data-access';
import { ReportEntry } from '@lib/reports/domain';
import { RepositoryError, USER_FEEDBACK } from '@lib/shared/data-access-supabase';
import { ToastService } from '@lib/shared/ui';
import { FileDownload } from '@lib/shared/util-browser';

import { ReportsPage } from './reports-page';

/** Siehe `reports-store.spec.ts`: „jetzt" muss feststehen, sonst wandert der Monat. */
const NOW = new Date('2026-10-06T09:00:00Z');

function entry(partial: Partial<ReportEntry> = {}): ReportEntry {
  return {
    id: 'e1',
    startedAt: new Date('2026-10-01T07:00:00Z'),
    endedAt: new Date('2026-10-01T09:00:00Z'),
    description: 'Konzept',
    projectId: 'p1',
    projectName: 'Relaunch',
    projectArchived: false,
    hourlyRate: 95,
    clientId: 'c1',
    clientName: 'Sandmann GmbH',
    clientArchived: false,
    ...partial,
  };
}

class FakeRepository implements Partial<ReportRepository> {
  entries: ReportEntry[] = [entry()];
  failWith: unknown = null;
  calls = 0;
  /** Haelt das Laden an, bis das Versprechen erfuellt ist. */
  gate: Promise<void> | null = null;

  async listRange(): Promise<ReportEntry[]> {
    this.calls += 1;
    await this.gate;
    if (this.failWith) {
      throw this.failWith;
    }
    return this.entries;
  }
}

/** Haelt fest, was gespeichert werden sollte, ohne einen Download auszuloesen. */
class FakeFileDownload implements Partial<FileDownload> {
  saved: Array<{ filename: string; content: string }> = [];

  save(filename: string, content: string): void {
    this.saved.push({ filename, content });
  }
}

interface Harness {
  fixture: ComponentFixture<ReportsPage>;
  element: HTMLElement;
  repository: FakeRepository;
  download: FakeFileDownload;
  toasts: ToastService;
  settle(): Promise<void>;
  click(selector: string): Promise<void>;
  clickText(label: string): Promise<void>;
  button(label: string): HTMLButtonElement;
  text(selector: string): string;
  rowTexts(): string[];
}

async function setup(configure: (fake: FakeRepository) => void = () => {}): Promise<Harness> {
  const repository = new FakeRepository();
  const download = new FakeFileDownload();
  configure(repository);

  await TestBed.configureTestingModule({
    imports: [ReportsPage],
    providers: [
      { provide: ReportRepository, useValue: repository },
      { provide: FileDownload, useValue: download },
      // Wie in der App: Store-Meldungen landen in den Toasts.
      { provide: USER_FEEDBACK, useExisting: ToastService },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ReportsPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  const element: HTMLElement = fixture.nativeElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  function button(label: string): HTMLButtonElement {
    const found = [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === label,
    );
    if (!found) {
      throw new Error(`Kein Knopf mit Text „${label}"`);
    }
    return found;
  }

  return {
    fixture,
    element,
    repository,
    download,
    toasts: TestBed.inject(ToastService),
    settle,
    button,
    async click(selector: string): Promise<void> {
      element.querySelector<HTMLElement>(selector)!.click();
      await settle();
    },
    async clickText(label: string): Promise<void> {
      button(label).click();
      await settle();
    },
    text(selector: string): string {
      return element.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    },
    rowTexts(): string[] {
      return [...element.querySelectorAll('tbody tr, tfoot tr')].map((row) =>
        row.textContent!.replace(/\s+/g, ' ').trim(),
      );
    },
  };
}

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('zeigt Kunde, Projekt und die Summenzeile', async () => {
    const { element, rowTexts } = await setup((fake) => {
      fake.entries = [
        entry(),
        entry({
          id: 'e2',
          startedAt: new Date('2026-10-02T07:00:00Z'),
          endedAt: new Date('2026-10-02T08:30:00Z'),
          projectId: 'p2',
          projectName: 'Wartung',
          hourlyRate: 80,
        }),
      ];
    });

    expect(element.querySelector('h1')?.textContent).toContain('Reports');
    const rows = rowTexts();
    // Kunde mit beiden Projekten darunter, Projekte alphabetisch.
    expect(rows[0]).toContain('Sandmann GmbH');
    expect(rows[1]).toContain('Relaunch');
    expect(rows[2]).toContain('Wartung');
    // Die Summe geht sichtbar auf: 2,00 + 1,50 = 3,50 h, 190 + 120 = 310 €.
    expect(rows.at(-1)).toContain('Summe Oktober');
    expect(rows.at(-1)).toContain('3,50');
    expect(rows.at(-1)).toContain('310,00 €');
  });

  it('nennt den Stundensatz und zaehlt die Eintraege je Projekt', async () => {
    const { rowTexts } = await setup((fake) => {
      fake.entries = [entry(), entry({ id: 'e2' })];
    });

    const projectRow = rowTexts()[1];
    expect(projectRow).toContain('2×');
    expect(projectRow).toContain('95,00 €');
    expect(projectRow).toContain('380,00 €');
  });

  it('markiert Archiviertes, zeigt es aber weiter', async () => {
    const { element, rowTexts } = await setup((fake) => {
      fake.entries = [entry({ projectArchived: true, clientArchived: true })];
    });

    // Die Stunden sind gearbeitet — ein Bericht, der sie verschweigt, lässt
    // Geld auf dem Tisch liegen.
    expect(rowTexts()[1]).toContain('Relaunch');
    expect(element.querySelectorAll('.tag')).toHaveLength(2);
  });

  it('warnt namentlich, wenn ein Projekt keinen Stundensatz hat', async () => {
    const { element, text, rowTexts } = await setup((fake) => {
      fake.entries = [
        entry(),
        entry({ id: 'e2', projectId: 'p2', projectName: 'Pro bono', hourlyRate: null }),
      ];
    });

    expect(text('.note')).toContain('Pro bono');
    expect(text('.note')).toContain('Beträge sind unvollständig');
    // Kein stillschweigendes 0 € in der Projektzeile, sondern ein Gedankenstrich
    // in Satz und Betrag. Über den Namen gesucht, nicht über die Position: die
    // Projekte stehen alphabetisch, „Pro bono" also vor „Relaunch".
    const gapRow = rowTexts().find((row) => row.includes('Pro bono'))!;
    expect(gapRow).toContain('—');
    expect(gapRow).not.toContain('0,00 €');
    // Der Stern klebt am Betrag — „190,00 €*", nicht „190,00 € *". Das steht
    // hier, weil Prettier die Zeile im Template genau dort umbrechen will und
    // aus dem Umbruch ein Leerzeichen würde (daher `prettier-ignore` dort).
    const clientCell = element.querySelector('.client-row td:last-child')!;
    expect(clientCell.textContent?.trim()).toBe('190,00 €*');
    // Die Fußnote erklärt den Stern.
    expect(element.querySelector('.gap')?.textContent).toBe('*');
    expect(text('.footnote')).toContain('mindestens ein Projekt ohne Stundensatz');
  });

  it('sagt beim leeren Monat, dass nichts erfasst ist', async () => {
    const { element, text } = await setup((fake) => {
      fake.entries = [];
    });

    expect(text('.empty')).toBe('Für Oktober 2026 sind keine Zeiten erfasst.');
    expect(element.querySelector('table')).toBeNull();
    expect(element.querySelector('.note')).toBeNull();
  });

  it('sperrt den Export, solange es nichts zu exportieren gibt', async () => {
    const { button } = await setup((fake) => {
      fake.entries = [];
    });

    expect(button('CSV exportieren').disabled).toBe(true);
  });

  it('uebergibt dem Download Dateiname und fertige CSV', async () => {
    const { clickText, download } = await setup();

    await clickText('CSV exportieren');

    expect(download.saved).toHaveLength(1);
    const [{ filename, content }] = download.saved;
    expect(filename).toBe('dailyfi-2026-10.csv');
    // Nicht die Summen der Seite, sondern die Einzeleinträge mit Beschreibung —
    // die gibt es nur dort, und sie sind der Grund für den Stundennachweis.
    expect(content).toContain('Datum;Von;Bis;Stunden;Kunde;Projekt');
    expect(content).toContain(
      '2026-10-01;09:00;11:00;2,00;Sandmann GmbH;Relaunch;95,00;190,00;Konzept',
    );
    expect(content.startsWith('﻿')).toBe(true);
  });

  it('meldet den Export in der Live-Region, im Singular wenn es einer ist', async () => {
    const { clickText, text } = await setup();

    await clickText('CSV exportieren');

    expect(text('[role="status"]')).toBe('1 Eintrag für Oktober 2026 als CSV heruntergeladen.');
  });

  it('meldet mehrere Eintraege im Plural', async () => {
    const { clickText, text } = await setup((fake) => {
      fake.entries = [entry(), entry({ id: 'e2' })];
    });

    await clickText('CSV exportieren');

    expect(text('[role="status"]')).toBe('2 Einträge für Oktober 2026 als CSV heruntergeladen.');
  });

  it('sperrt „Nächster Monat" im laufenden Monat und gibt ihn danach frei', async () => {
    const { element, click } = await setup();
    const next = element.querySelector<HTMLButtonElement>('[aria-label="Nächster Monat"]')!;

    // Nichts in der Zukunft zu holen — ein Knopf, der nur leere Monate zeigt,
    // sieht wie ein Fehler aus. Gesperrt per aria-disabled, nicht disabled.
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(next.disabled).toBe(false);

    await click('[aria-label="Vorheriger Monat"]');

    expect(next.hasAttribute('aria-disabled')).toBe(false);
    expect(element.querySelector('#report-month')?.textContent?.trim()).toBe('September 2026');
  });

  it('behaelt den Fokus auf „Nächster Monat", wenn er im laufenden Monat ankommt', async () => {
    const { fixture, element, click, settle, repository, text } = await setup();
    document.body.appendChild(fixture.nativeElement); // Fokus nur im Dokument
    await click('[aria-label="Vorheriger Monat"]');
    const next = element.querySelector<HTMLButtonElement>('[aria-label="Nächster Monat"]')!;
    next.focus();

    next.click();
    await settle();

    expect(text('#report-month')).toBe('Oktober 2026');
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(next);

    // Ein weiterer Klick aendert nichts: kein Monat in der Zukunft, kein Laden.
    const listRange = vi.spyOn(repository, 'listRange');
    next.click();
    await settle();

    expect(text('#report-month')).toBe('Oktober 2026');
    expect(listRange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(next);
    fixture.nativeElement.remove();
  });

  it('blaettert zurueck und meldet den neuen Monat ansagbar', async () => {
    const { click, text } = await setup();

    await click('[aria-label="Vorheriger Monat"]');

    expect(text('table caption')).toContain('September 2026');
    expect(text('[role="status"]')).toContain('September 2026');
    expect(text('[role="status"]')).toContain('2,00');
  });

  it('meldet einen leeren Monat eigens, statt 0,00 Stunden vorzulesen', async () => {
    const { click, text } = await setup((fake) => {
      fake.entries = [];
    });

    await click('[aria-label="Vorheriger Monat"]');

    expect(text('[role="status"]')).toBe('September 2026: keine Zeiten erfasst.');
  });

  it('erreicht einen beliebigen frueheren Monat ueber die Pfeile', async () => {
    const { click, text } = await setup();

    // Brief: „‹ Oktober 2026 ›" statt Auswahlliste. Sieben Mal zurueck: März.
    for (let step = 0; step < 7; step++) {
      await click('[aria-label="Vorheriger Monat"]');
    }

    expect(text('#report-month')).toBe('März 2026');
    expect(text('table caption')).toContain('März 2026');
  });

  it('zeigt einen Ladefehler als Fehlerzustand, nie als „keine Zeiten erfasst"', async () => {
    const { element, repository, click, text, toasts } = await setup();

    repository.failWith = new RepositoryError('offline', 'Failed to fetch');
    await click('[aria-label="Vorheriger Monat"]');

    // Der Fehler kommt als Toast …
    expect(toasts.toasts().map((toast) => [toast.kind, toast.message, toast.detail])).toEqual([
      ['error', 'Die Auswertung konnte nicht geladen werden.', 'Keine Verbindung zum Server.'],
    ]);
    // … und die Seite zeigt einen Fehlerzustand statt der falschen Leere.
    expect(element.textContent).not.toContain('keine Zeiten erfasst');
    expect(element.textContent).not.toContain('sind keine Zeiten erfasst');
    expect(text('app-load-error')).toContain('September 2026 konnte nicht geladen werden.');
    expect(text('app-load-error')).toContain('Keine Verbindung zum Server');
    // Die Live-Ansage bleibt.
    expect(text('[role="status"]')).toBe('September 2026: konnte nicht geladen werden.');
    // Keine Tabelle mit den Zahlen des Vormonats unter der neuen Überschrift.
    expect(element.querySelector('table')).toBeNull();
    expect(element.querySelector('.notice')).toBeNull();
  });

  it('laedt per „Erneut laden" denselben Monat neu', async () => {
    const { element, repository, click, clickText, text } = await setup();
    repository.failWith = new RepositoryError('offline', 'Failed to fetch');
    await click('[aria-label="Vorheriger Monat"]');
    const callsBefore = repository.calls;

    repository.failWith = null;
    await clickText('Erneut laden');

    expect(repository.calls).toBe(callsBefore + 1);
    expect(element.querySelector('app-load-error')).toBeNull();
    expect(element.querySelector('table')).not.toBeNull();
    expect(text('#report-month')).toBe('September 2026');
    expect(text('[role="status"]')).toContain('September 2026: 2,00 Stunden');
  });

  it('haelt bei „Erneut laden" Karte und Fokus, bis das Ergebnis da ist', async () => {
    const harness = await setup();
    const { element, repository, toasts } = harness;
    document.body.appendChild(element);
    repository.failWith = new RepositoryError('offline', 'Failed to fetch');
    await harness.click('[aria-label="Vorheriger Monat"]');
    const retry = element.querySelector<HTMLButtonElement>('app-load-error button')!;
    retry.focus();
    const announced = harness.text('[role="status"]');

    let release!: () => void;
    repository.gate = new Promise((resolve) => (release = resolve));
    retry.click();
    harness.fixture.detectChanges();
    expect(element.querySelector('app-load-error button')).toBe(retry);
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(retry.textContent?.trim()).toBe('Lädt …');
    expect(document.activeElement).toBe(retry);

    // Erneut gescheitert: der Toast sagt es (einmal), die Seite schweigt dazu.
    release();
    await harness.settle();
    expect(element.querySelector('app-load-error button')).toBe(retry);
    expect(document.activeElement).toBe(retry);
    expect(toasts.toasts()).toHaveLength(1);
    expect(harness.text('[role="status"]')).toBe(announced);

    repository.gate = null;
    repository.failWith = null;
    retry.click();
    await harness.settle();
    await harness.settle();
    expect(element.querySelector('app-load-error')).toBeNull();
    expect(document.activeElement).toBe(element.querySelector('h1'));
    expect(toasts.toasts()).toEqual([]);
    element.remove();
  });
});
