import { TestBed } from '@angular/core/testing';

import { ReportEntry } from '@lib/reports/domain';
import { RepositoryError, USER_FEEDBACK } from '@lib/shared/data-access-supabase';
import { RecordingFeedback } from '@lib/shared/data-access-supabase/testing';

import { ReportRepository } from './report-repository';
import { ReportsStore } from './reports-store';

/**
 * „Jetzt" steht fest: `currentMonthKey()` fragt die Uhr, und ein Test, der im
 * Dezember etwas anderes behauptet als im Januar, ist keiner. Nur `Date` wird
 * ersetzt — die Zeitgeber bleiben echt, sonst stolpert `whenStable()`.
 */
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
  ranges: Array<{ from: string; to: string }> = [];

  async listRange(from: Date, to: Date): Promise<ReportEntry[]> {
    this.ranges.push({ from: from.toISOString(), to: to.toISOString() });
    if (this.failWith) {
      throw this.failWith;
    }
    return this.entries;
  }
}

function setup(configure: (fake: FakeRepository) => void = () => {}): {
  store: ReportsStore;
  repository: FakeRepository;
  feedback: RecordingFeedback;
} {
  const repository = new FakeRepository();
  const feedback = new RecordingFeedback();
  configure(repository);

  TestBed.configureTestingModule({
    providers: [
      ReportsStore,
      { provide: ReportRepository, useValue: repository },
      { provide: USER_FEEDBACK, useValue: feedback },
    ],
  });

  return { store: TestBed.inject(ReportsStore), repository, feedback };
}

describe('ReportsStore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('beginnt im laufenden Monat', () => {
    const { store } = setup();

    expect(store.month()).toBe('2026-10');
    expect(store.isCurrentMonth()).toBe(true);
  });

  it('fragt genau die Monatsgrenzen in Berliner Zeit ab', async () => {
    const { store, repository } = setup();

    await store.load();

    // Sommerzeit bis zum 25.10.: der Oktober beginnt am 30.09. um 22:00 UTC und
    // endet am 31.10. um 23:00 UTC. Mit `new Date(2026, 9, 1)` auf einem
    // Rechner in Sydney griffe die Abfrage in den Vormonat.
    expect(repository.ranges).toEqual([
      { from: '2026-09-30T22:00:00.000Z', to: '2026-10-31T23:00:00.000Z' },
    ]);
  });

  it('leitet den Bericht aus den geladenen Eintraegen ab', async () => {
    const { store } = setup((fake) => {
      fake.entries = [
        entry(),
        entry({
          id: 'e2',
          startedAt: new Date('2026-10-02T07:00:00Z'),
          endedAt: new Date('2026-10-02T08:30:00Z'),
        }),
      ];
    });

    await store.load();

    expect(store.report().entryCount).toBe(2);
    expect(store.report().hours).toBe(3.5);
    expect(store.report().amount).toBe(332.5);
    expect(store.loadError()).toBeNull();
    expect(store.loading()).toBe(false);
  });

  it('blaettert zurueck und laedt den neuen Monat', async () => {
    const { store, repository } = setup();

    await store.shiftMonth(-1);

    expect(store.month()).toBe('2026-09');
    expect(store.isCurrentMonth()).toBe(false);
    expect(repository.ranges).toHaveLength(1);
    expect(repository.ranges[0]).toEqual({
      from: '2026-08-31T22:00:00.000Z',
      to: '2026-09-30T22:00:00.000Z',
    });
  });

  it('blaettert ueber die Jahresgrenze', async () => {
    const { store } = setup();

    await store.shiftMonth(-10);

    expect(store.month()).toBe('2025-12');
  });

  it('springt auf einen gewaehlten Monat und von dort zurueck in den laufenden', async () => {
    const { store, repository } = setup();

    await store.showMonth('2026-03');
    expect(store.month()).toBe('2026-03');

    await store.goToCurrentMonth();

    expect(store.month()).toBe('2026-10');
    expect(store.isCurrentMonth()).toBe(true);
    expect(repository.ranges).toHaveLength(2);
  });

  it('meldet einen Fehler in deutscher Sprache und laesst keine fremden Zahlen stehen', async () => {
    const { store, repository, feedback } = setup();
    await store.load();
    expect(store.report().entryCount).toBe(1);

    repository.failWith = new RepositoryError('offline', 'Failed to fetch');
    await store.shiftMonth(-1);

    expect(store.loadError()).toBe('Keine Verbindung zum Server.');
    expect(feedback.texts('error')).toEqual([
      'Die Auswertung konnte nicht geladen werden. Keine Verbindung zum Server.',
    ]);
    expect(store.syncError()).toBe(true);
    // Entscheidend: nicht die Zahlen des Vormonats unter der neuen Überschrift
    // stehen lassen. Eine leere Auswertung ist ehrlich, eine falsche nicht.
    expect(store.entries()).toEqual([]);
    expect(store.report().entryCount).toBe(0);
    expect(store.loading()).toBe(false);
  });

  it('nennt eine abgelaufene Anmeldung beim Namen', async () => {
    const { store } = setup((fake) => {
      fake.failWith = new RepositoryError('session-expired', 'JWT expired');
    });

    await store.load();

    expect(store.loadError()).toContain('Anmeldung war abgelaufen');
  });

  it('faengt auch einen Fehler ab, der kein RepositoryError ist', async () => {
    const { store, feedback } = setup((fake) => {
      fake.failWith = new TypeError('kaputt');
    });

    await store.load();

    expect(store.loadError()).toBe('Das hat nicht geklappt.');
    expect(feedback.texts('error')).toEqual([
      'Die Auswertung konnte nicht geladen werden. Das hat nicht geklappt.',
    ]);
    // Der technische Wortlaut bleibt für die Fehlersuche in der Konsole.
    expect(console.error).toHaveBeenCalled();
  });

  it('raeumt die Fehlermeldung beim naechsten Laden weg', async () => {
    const { store, repository } = setup((fake) => {
      fake.failWith = new RepositoryError('unknown', 'irgendwas');
    });
    await store.load();
    expect(store.loadError()).not.toBeNull();
    expect(store.syncError()).toBe(true);

    repository.failWith = null;
    await store.load();

    expect(store.loadError()).toBeNull();
    expect(store.syncError()).toBe(false);
    expect(store.report().entryCount).toBe(1);
  });
});
