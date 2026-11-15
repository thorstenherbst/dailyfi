import { TestBed } from '@angular/core/testing';

import { RepositoryError, USER_FEEDBACK } from '@lib/shared/data-access-supabase';
import { RecordingFeedback } from '@lib/shared/data-access-supabase/testing';
import {
  durationHours,
  formatHours,
  movePlacement,
  resizePlacement,
  wallToInstant,
} from '@lib/shared/util-time';
import {
  Project,
  TimeEntry,
  TimeEntryDraft,
  effectivePlacement,
  instantsOf,
  placementOf,
} from '@lib/week/domain';

import { TimeEntryRepository } from './time-entry-repository';
import { WeekStore } from './week-store';

const PROJECTS: Project[] = [
  { id: 'p1', name: 'Relaunch', color: '#A8412A', clientName: 'Sandmann GmbH' },
];

function entry(id: string, day: string, from: number, to: number): TimeEntry {
  return {
    id,
    projectId: 'p1',
    startedAt: wallToInstant(day, from),
    endedAt: wallToInstant(day, to),
    description: 'Datenmodell',
  };
}

/** Doppel statt Supabase: der Store kennt nur noch dieses schmale Gegenüber. */
class FakeRepository implements Partial<TimeEntryRepository> {
  rows: TimeEntry[] = [entry('e1', '2026-09-15', 555, 660)]; // Di 9:15–11:00
  updates: Array<{ id: string; patch: Partial<TimeEntryDraft> }> = [];
  removed: string[] = [];
  failNext = false;
  failWith: RepositoryError = new RepositoryError('offline', 'TypeError: Failed to fetch');
  failLoad: unknown = null;
  /** Haelt Schreibvorgaenge an, bis `release()` laeuft — fuer „speichert …". */
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;

  hold(): void {
    this.gate = new Promise((resolve) => (this.open = resolve));
  }

  release(): void {
    this.open?.();
    this.gate = null;
  }

  projects: Project[] = [...PROJECTS];
  projectLoads = 0;

  async listProjects(): Promise<Project[]> {
    this.projectLoads += 1;
    return this.projects;
  }

  async listRange(): Promise<TimeEntry[]> {
    if (this.failLoad) {
      throw this.failLoad;
    }
    return this.rows;
  }

  async create(draft: TimeEntryDraft): Promise<TimeEntry> {
    if (this.failNext) {
      throw this.failWith;
    }
    return { id: 'neu-aus-der-datenbank', ...draft };
  }

  async update(id: string, patch: Partial<TimeEntryDraft>): Promise<TimeEntry> {
    await this.gate;
    if (this.failNext) {
      throw this.failWith;
    }
    this.updates.push({ id, patch });
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) {
      throw new Error('unbekannt');
    }
    return { ...row, ...patch } as TimeEntry;
  }

  async remove(id: string): Promise<void> {
    if (this.failNext) {
      throw this.failWith;
    }
    this.removed.push(id);
  }
}

async function setup(): Promise<{
  store: WeekStore;
  repository: FakeRepository;
  feedback: RecordingFeedback;
}> {
  const repository = new FakeRepository();
  const feedback = new RecordingFeedback();
  TestBed.configureTestingModule({
    providers: [
      WeekStore,
      { provide: TimeEntryRepository, useValue: repository },
      { provide: USER_FEEDBACK, useValue: feedback },
    ],
  });
  const store = TestBed.inject(WeekStore);
  await store.showWeekOf('2026-09-15');
  return { store, repository, feedback };
}

describe('WeekStore', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('holt die Projekte bei jedem Laden neu', async () => {
    const { store, repository } = await setup();
    expect(repository.projectLoads).toBe(1);

    // Ein Projekt kommt dazu; danach wird die Woche gewechselt.
    repository.projects = [
      ...PROJECTS,
      { id: 'p2', name: 'Neues Projekt', color: '#3F6B4C', clientName: 'Nordlicht Medien' },
    ];
    await store.shiftWeek(1);

    // Frueher lag hier ein Zwischenspeicher pro Instanz: das neue Projekt
    // erschien erst nach einem Neuladen der Seite in der Auswahl.
    expect(repository.projectLoads).toBe(2);
    expect(store.projects().map((project) => project.id)).toEqual(['p1', 'p2']);
    expect(store.projectName('p2')).toBe('Neues Projekt');
  });

  it('laedt die Woche ab Montag', async () => {
    const { store } = await setup();
    expect(store.weekStart()).toBe('2026-09-14');
    expect(store.days()).toHaveLength(7);
    expect(store.weekNumber()).toBe(38);
    expect(store.entries()).toHaveLength(1);
  });

  it('rechnet die Wochensumme aus den geladenen Eintraegen', async () => {
    const { store } = await setup();
    expect(formatHours(store.totalHours())).toBe('1,75');
  });

  describe('Tastaturbedienung', () => {
    it('verschiebt einen Block um 15 Minuten nach oben und sagt es an', async () => {
      const { store, repository, feedback } = await setup();
      const before = placementOf(store.entries()[0]);

      // Was die Taste ↑ auf einem Block ausloest:
      await store.moveEntry('e1', movePlacement(before, -15));

      const after = placementOf(store.entries()[0]);
      expect(after).toEqual({ dayKey: '2026-09-15', startMinutes: 540, endMinutes: 645 });
      expect(store.announcement()).toContain('Relaunch, Dienstag 9:00 bis 10:45');
      expect(repository.updates).toHaveLength(1);
      expect(repository.updates[0].patch.startedAt?.toISOString()).toBe(
        wallToInstant('2026-09-15', 540).toISOString(),
      );
      // Verschieben bekommt keinen Toast: das sagt die Live-Region des Rasters.
      expect(feedback.messages).toEqual([]);
    });

    it('aendert mit ⇧ + ↓ die Dauer statt der Lage', async () => {
      const { store } = await setup();
      const before = placementOf(store.entries()[0]);

      await store.moveEntry('e1', resizePlacement(before, 15));

      expect(placementOf(store.entries()[0])).toEqual({
        dayKey: '2026-09-15',
        startMinutes: 555,
        endMinutes: 675,
      });
      expect(formatHours(store.totalHours())).toBe('2,00');
    });
  });

  it('zeigt den neuen Eintrag sofort und ersetzt ihn durch die gespeicherte Zeile', async () => {
    const { store } = await setup();

    await store.createEntry(
      { dayKey: '2026-09-16', startMinutes: 600, endMinutes: 660 },
      'p1',
      'Architektur-Call',
    );

    expect(store.entries()).toHaveLength(2);
    expect(store.entries()[1].id).toBe('neu-aus-der-datenbank');
    expect(formatHours(store.totalHours())).toBe('2,75');
  });

  it('meldet den gespeicherten neuen Eintrag als Erfolg, mit der echten Zeit', async () => {
    const { store, feedback } = await setup();

    await store.createEntry(
      { dayKey: '2026-09-16', startMinutes: 600, endMinutes: 660 },
      'p1',
      'Architektur-Call',
    );

    expect(feedback.messages).toEqual([
      {
        id: 1,
        kind: 'success',
        message: 'Eintrag gespeichert',
        detail: 'Relaunch, Mittwoch 10:00 bis 11:00',
      },
    ]);
  });

  // Aenderung aus dem Panel. Das Ergebnis ist das,
  // an dem das Panel entscheidet, ob es stehen bleibt.
  it('meldet eine Aenderung aus dem Panel als Erfolg und gibt true zurueck', async () => {
    const { store, feedback } = await setup();

    const ok = await store.editEntry(
      'e1',
      { dayKey: '2026-09-15', startMinutes: 555, endMinutes: 660 },
      'p1',
      'Neu beschrieben',
    );

    expect(ok).toBe(true);
    expect(feedback.texts('success')).toEqual([
      'Eintrag geändert Relaunch, Dienstag 9:15 bis 11:00',
    ]);
  });

  it('gibt bei einer gescheiterten Aenderung aus dem Panel false zurueck und rollt zurueck', async () => {
    const { store, repository, feedback } = await setup();
    const before = store.entries()[0];
    repository.failNext = true;

    const ok = await store.editEntry(
      'e1',
      { dayKey: '2026-09-15', startMinutes: 600, endMinutes: 720 },
      'p1',
      'Neu beschrieben',
    );

    expect(ok).toBe(false);
    expect(store.entries()[0]).toEqual(before);
    expect(feedback.texts('success')).toEqual([]);
    expect(feedback.texts('error')).toHaveLength(1);
  });

  it('sagt beim gescheiterten Panel-Speichern, dass die Eingaben noch im Panel stehen', async () => {
    const { store, repository, feedback } = await setup();
    repository.failNext = true;

    await store.editEntry(
      'e1',
      { dayKey: '2026-09-15', startMinutes: 600, endMinutes: 720 },
      'p1',
      'Neu beschrieben',
    );

    const detail = feedback.texts('error').join(' ');
    expect(detail).toContain('Deine Eingaben stehen noch im Panel.');
    expect(detail).not.toContain('Die Ansicht wurde zurückgesetzt.');
  });

  it('meldet einen nicht mehr vorhandenen Eintrag, statt still nichts zu tun', async () => {
    const { store, feedback } = await setup();

    const ok = await store.editEntry(
      'weg',
      { dayKey: '2026-09-15', startMinutes: 600, endMinutes: 720 },
      'p1',
      '',
    );

    expect(ok).toBe(false);
    expect(feedback.texts('error')[0]).toContain('Diesen Eintrag gibt es nicht mehr');
  });

  it('rollt eine gescheiterte Aenderung zurueck und meldet den Fehler als Toast', async () => {
    const { store, repository, feedback } = await setup();
    const before = placementOf(store.entries()[0]);
    repository.failNext = true;

    await store.moveEntry('e1', movePlacement(before, 60));

    expect(placementOf(store.entries()[0])).toEqual(before);
    // Der Toast sagt, warum; wohin der Block zurueckgesprungen ist, sagt die
    // Live-Region des Rasters — nicht beide dasselbe.
    expect(feedback.messages).toEqual([
      {
        id: 1,
        kind: 'error',
        message: 'Die Änderung konnte nicht gespeichert werden.',
        detail: 'Keine Verbindung zum Server.',
      },
    ]);
    expect(store.announcement()).toContain('Zurückgesetzt: Relaunch, Dienstag 9:15 bis 11:00');
  });

  it('sagt nach einer gescheiterten Tastaturbewegung die zurueckgesetzte Zeit an', async () => {
    vi.useFakeTimers();
    try {
      const { store, repository } = await setup();
      const before = placementOf(store.entries()[0]);
      repository.failNext = true;

      store.nudgeEntry('e1', movePlacement(before, 15));
      expect(store.announcement()).toContain('Relaunch, Dienstag 9:30 bis 11:15');
      await vi.advanceTimersByTimeAsync(400);

      expect(placementOf(store.entries()[0])).toEqual(before);
      expect(store.announcement()).toContain('Zurückgesetzt: Relaunch, Dienstag 9:15 bis 11:00');
    } finally {
      vi.useRealTimers();
    }
  });

  describe('Fehlertexte', () => {
    it('zeigt nie den Wortlaut der Datenbank', async () => {
      const { repository, store, feedback } = await setup();
      repository.failNext = true;
      repository.failWith = new RepositoryError(
        'invalid-range',
        'new row violates check constraint "time_entries_ends_after_start"',
      );

      await store.moveEntry('e1', { dayKey: '2026-09-15', startMinutes: 60, endMinutes: 120 });

      const message = feedback.texts('error').join(' ');
      expect(message).not.toContain('check constraint');
      expect(message).not.toContain('time_entries');
      expect(message).toContain('das Ende muss nach dem Beginn liegen');
    });

    it('macht aus einem abgebrochenen fetch einen deutschen Satz', async () => {
      const { store, repository, feedback } = await setup();
      repository.failNext = true;
      repository.failWith = new RepositoryError('offline', 'TypeError: Failed to fetch');

      await store.deleteEntry('e1');

      const message = feedback.texts('error').join(' ');
      expect(message).not.toContain('TypeError');
      expect(message).toContain('Keine Verbindung zum Server');
    });
  });

  it('rollt ein gescheitertes Loeschen zurueck', async () => {
    const { store, repository, feedback } = await setup();
    repository.failNext = true;

    await store.deleteEntry('e1');

    expect(store.entries()).toHaveLength(1);
    expect(feedback.texts('error')[0]).toContain('nicht gelöscht');
    expect(feedback.texts('success')).toEqual([]);
  });

  it('loescht sonst und meldet es als Erfolgs-Toast', async () => {
    const { store, repository, feedback } = await setup();

    await store.deleteEntry('e1');

    expect(store.entries()).toHaveLength(0);
    expect(repository.removed).toEqual(['e1']);
    expect(feedback.texts('success')).toEqual([
      'Eintrag gelöscht Relaunch, Dienstag 9:15 bis 11:00',
    ]);
  });

  describe('Ladefehler', () => {
    it('zeigt statt eines leeren Rasters einen Fehler und meldet ihn als Toast', async () => {
      const { store, repository, feedback } = await setup();
      repository.failLoad = new RepositoryError('offline', 'Failed to fetch');

      await store.shiftWeek(1);

      expect(store.loadError()).toBe('Keine Verbindung zum Server.');
      expect(store.entries()).toEqual([]);
      expect(store.syncError()).toBe(true);
      expect(feedback.texts('error')).toEqual([
        'Die Woche konnte nicht geladen werden. Keine Verbindung zum Server.',
      ]);
    });

    it('raeumt den Fehler beim erfolgreichen Neuladen weg', async () => {
      const { store, repository } = await setup();
      repository.failLoad = new RepositoryError('offline', 'Failed to fetch');
      await store.load();
      repository.failLoad = null;

      await store.load();

      expect(store.loadError()).toBeNull();
      expect(store.syncError()).toBe(false);
      expect(store.entries()).toHaveLength(1);
    });

    it('laesst die Fehlerkarte stehen, solange erneut geladen wird', async () => {
      const { store, repository } = await setup();
      repository.failLoad = new RepositoryError('offline', 'Failed to fetch');
      await store.load();
      repository.failLoad = null;

      const retry = store.load();

      // Waehrend des Ladens: Karte bleibt (Knopf „Lädt …"), Fokus faellt nicht.
      expect(store.loading()).toBe(true);
      expect(store.loadError()).toBe('Keine Verbindung zum Server.');
      await retry;
      expect(store.loadError()).toBeNull();
    });

    it('nimmt den Ladefehler-Toast nach erfolgreichem Neuladen weg', async () => {
      const { store, repository, feedback } = await setup();
      repository.failLoad = new RepositoryError('offline', 'Failed to fetch');
      await store.load();
      expect(feedback.open('error')).toHaveLength(1);
      repository.failLoad = null;

      await store.load();

      expect(feedback.open('error')).toEqual([]);
    });
  });

  describe('Sync-Signal fuer die Statusleiste', () => {
    it('speichert …, solange geschrieben wird, und ist danach synchron', async () => {
      const { store, repository } = await setup();
      repository.hold();

      const writing = store.moveEntry('e1', movePlacement(placementOf(store.entries()[0]), 15));
      await Promise.resolve();
      expect(store.saving()).toBe(true);

      repository.release();
      await writing;
      expect(store.saving()).toBe(false);
      expect(store.syncError()).toBe(false);
    });

    it('zaehlt auch die Tastaturbewegung, die noch auf ihre Ruhepause wartet', async () => {
      const { store } = await setup();

      store.nudgeEntry('e1', movePlacement(placementOf(store.entries()[0]), 15));
      expect(store.saving()).toBe(true);

      await store.flushPending();
      expect(store.saving()).toBe(false);
    });

    it('steht nach einem Netzfehler auf Fehler, bis wieder etwas durchgeht', async () => {
      const { store, repository } = await setup();
      repository.failNext = true;
      await store.moveEntry('e1', movePlacement(placementOf(store.entries()[0]), 15));
      expect(store.syncError()).toBe(true);
      expect(store.saving()).toBe(false);

      repository.failNext = false;
      await store.moveEntry('e1', movePlacement(placementOf(store.entries()[0]), 15));
      expect(store.syncError()).toBe(false);
    });

    it('ist kein Sync-Fehler, wenn der Server nur die Eingabe ablehnt', async () => {
      const { store, repository } = await setup();
      repository.failNext = true;
      repository.failWith = new RepositoryError('invalid-range', 'ends_after_start');

      await store.moveEntry('e1', movePlacement(placementOf(store.entries()[0]), 15));

      expect(store.syncError()).toBe(false);
    });
  });

  describe('Zeitumstellung', () => {
    it('speichert einen Block in der Luecke mit erhaltener Dauer statt gar nicht', () => {
      // 29.03.2026: 02:00 bis 03:00 gibt es als Wandzeit nicht.
      const { startedAt, endedAt } = instantsOf({
        dayKey: '2026-03-29',
        startMinutes: 120,
        endMinutes: 180,
      });

      expect(endedAt.getTime()).toBeGreaterThan(startedAt.getTime());
      expect(durationHours(startedAt, endedAt)).toBe(1);
    });

    it('nennt die tatsaechlich gespeicherte Zeit, nicht die eingegebene', async () => {
      const { store, feedback } = await setup();

      // 02:15–02:45 am 29.03. wurde still
      // verschoben, angesagt wurde aber weiter „2:15 bis 2:45".
      const eingegeben = { dayKey: '2026-03-29', startMinutes: 135, endMinutes: 165 };
      expect(effectivePlacement(eingegeben)).not.toEqual(eingegeben);

      await store.createEntry(eingegeben, 'p1', 'In der Luecke');

      const gespeichert = effectivePlacement(eingegeben);
      const toast = feedback.texts('success').join(' ');
      expect(toast).toContain('3:00 bis 3:30');
      expect(gespeichert.startMinutes).toBe(180);
      expect(toast).not.toContain('2:15');
    });

    it('laesst einen Block ueber die Rueckstellung vier Stunden lang sein', () => {
      const { startedAt, endedAt } = instantsOf({
        dayKey: '2026-10-25',
        startMinutes: 60,
        endMinutes: 240,
      });
      expect(durationHours(startedAt, endedAt)).toBe(4);
    });
  });

  describe('Altdaten über Mitternacht', () => {
    async function setupOvernight(): Promise<{
      store: WeekStore;
      repository: FakeRepository;
      feedback: RecordingFeedback;
    }> {
      const repository = new FakeRepository();
      const feedback = new RecordingFeedback();
      repository.rows = [
        {
          id: 'nacht',
          projectId: 'p1',
          startedAt: wallToInstant('2026-09-15', 22 * 60),
          endedAt: wallToInstant('2026-09-16', 2 * 60),
          description: 'Nachtschicht',
        },
      ];
      TestBed.configureTestingModule({
        providers: [
          WeekStore,
          { provide: TimeEntryRepository, useValue: repository },
          { provide: USER_FEEDBACK, useValue: feedback },
        ],
      });
      const store = TestBed.inject(WeekStore);
      await store.showWeekOf('2026-09-15');
      return { store, repository, feedback };
    }

    it('haelt einen Block bis 24:00 nicht faelschlich fuer einen Nachtblock', async () => {
      const { store, repository, feedback } = await setup();

      // 23:00–24:00 endet *auf* Mitternacht und ist ein ganz normaler Block.
      await store.moveEntry('e1', {
        dayKey: '2026-09-15',
        startMinutes: 23 * 60,
        endMinutes: 24 * 60,
      });

      expect(feedback.texts('error')).toEqual([]);
      expect(repository.updates).toHaveLength(1);
      expect(placementOf(store.entries()[0])).toEqual({
        dayKey: '2026-09-15',
        startMinutes: 1380,
        endMinutes: 1440,
      });
    });

    it('zeigt einen echten Nachtblock gekuerzt bis Mitternacht', async () => {
      const { store } = await setupOvernight();
      expect(placementOf(store.entries()[0])).toEqual({
        dayKey: '2026-09-15',
        startMinutes: 22 * 60,
        endMinutes: 24 * 60,
      });
    });

    it('schreibt die gekuerzte Fassung aber nie zurueck', async () => {
      const { store, repository, feedback } = await setupOvernight();

      await store.moveEntry('nacht', { dayKey: '2026-09-15', startMinutes: 60, endMinutes: 180 });

      expect(repository.updates).toHaveLength(0);
      expect(store.entries()[0].endedAt.toISOString()).toBe(
        wallToInstant('2026-09-16', 2 * 60).toISOString(),
      );
      expect(feedback.texts('error')[0]).toContain('über Mitternacht');
      // Eine abgelehnte Eingabe ist kein Sync-Fehler.
      expect(store.syncError()).toBe(false);
    });
  });

  describe('Entprellte Tastaturbewegung', () => {
    it('bewegt sofort im Raster, schreibt aber erst nach der Ruhepause einmal', async () => {
      const { store, repository } = await setup();

      // Gehaltene Pfeiltaste: vier Schritte in schneller Folge.
      for (let step = 0; step < 4; step++) {
        store.nudgeEntry('e1', movePlacement(placementOf(store.entries()[0]), 15));
      }

      // Im Raster ist die Bewegung sofort sichtbar …
      expect(placementOf(store.entries()[0]).startMinutes).toBe(555 + 4 * 15);
      // … geschrieben wurde noch nichts.
      expect(repository.updates).toHaveLength(0);

      await store.flushPending();

      expect(repository.updates).toHaveLength(1);
      expect(repository.updates[0].patch.startedAt?.toISOString()).toBe(
        wallToInstant('2026-09-15', 615).toISOString(),
      );
    });

    it('schreibt gar nicht, wenn die Bewegung am Ende wieder am Anfang steht', async () => {
      const { store, repository } = await setup();

      store.nudgeEntry('e1', movePlacement(placementOf(store.entries()[0]), 15));
      store.nudgeEntry('e1', movePlacement(placementOf(store.entries()[0]), -15));
      await store.flushPending();

      expect(repository.updates).toHaveLength(0);
      expect(placementOf(store.entries()[0]).startMinutes).toBe(555);
    });

    it('rollt bei einem Fehlschlag auf den Stand vor der ganzen Serie zurueck', async () => {
      const { store, repository, feedback } = await setup();

      for (let step = 0; step < 3; step++) {
        store.nudgeEntry('e1', movePlacement(placementOf(store.entries()[0]), 15));
      }
      repository.failNext = true;
      await store.flushPending();

      expect(placementOf(store.entries()[0]).startMinutes).toBe(555);
      expect(feedback.texts('error')[0]).toContain('Keine Verbindung');
    });
  });
});
