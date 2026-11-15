import { TestBed } from '@angular/core/testing';

import {
  SESSION_RECOVERY,
  SUPABASE,
  SessionRecoveryOutcome,
  USER_FEEDBACK,
} from '@lib/shared/data-access-supabase';
import { RecordingFeedback } from '@lib/shared/data-access-supabase/testing';
import { movePlacement, wallToInstant } from '@lib/shared/util-time';
import { placementOf } from '@lib/week/domain';

import { TimeEntryRepository } from './time-entry-repository';
import { WeekStore } from './week-store';

interface Call {
  readonly table: string;
  readonly ops: ReadonlyArray<readonly [string, unknown[]]>;
}

const ROW = {
  id: 'e1',
  project_id: 'p1',
  started_at: wallToInstant('2026-09-15', 555).toISOString(), // Di 9:15
  ended_at: wallToInstant('2026-09-15', 660).toISOString(), // bis 11:00
  description: 'Datenmodell',
};

const JWT_EXPIRED = { code: 'PGRST301', message: 'JWT expired', details: null };

/**
 * Supabase-Doppel auf Ebene der Abfragekette: jede Methode haengt sich an, und
 * `await` liefert, was `respond` fuer diese Kette sagt. So laeuft der echte
 * `TimeEntryRepository` samt `guarded()` — genau dort sitzt die Wiederholung.
 */
class FakeDb {
  readonly calls: Call[] = [];
  /** So viele Schreibvorgaenge scheitern zuerst mit 401. */
  rejectWrites = 0;

  from(table: string): unknown {
    const ops: Array<readonly [string, unknown[]]> = [];
    const chain: Record<string, unknown> = {};
    for (const name of [
      'select',
      'insert',
      'update',
      'delete',
      'eq',
      'is',
      'gte',
      'lt',
      'order',
      'single',
    ]) {
      chain[name] = (...args: unknown[]) => {
        ops.push([name, args]);
        return chain;
      };
    }
    chain['then'] = (resolve: (value: unknown) => void) => {
      const call = { table, ops: [...ops] };
      this.calls.push(call);
      resolve(this.respond(call));
    };
    return chain;
  }

  writes(): Call[] {
    return this.calls.filter((call) => call.ops.some(([name]) => name === 'update'));
  }

  private respond(call: Call): { data: unknown; error: unknown } {
    if (call.table === 'projects') {
      return {
        data: [{ id: 'p1', name: 'Relaunch', color: '#A8412A', client: { name: 'Sandmann GmbH' } }],
        error: null,
      };
    }
    const update = call.ops.find(([name]) => name === 'update');
    if (!update) {
      return { data: [ROW], error: null };
    }
    if (this.rejectWrites > 0) {
      this.rejectWrites -= 1;
      return { data: null, error: JWT_EXPIRED };
    }
    return { data: { ...ROW, ...(update[1][0] as object) }, error: null };
  }
}

async function setup(outcome: SessionRecoveryOutcome): Promise<{
  store: WeekStore;
  db: FakeDb;
  feedback: RecordingFeedback;
  recoveries: () => number;
}> {
  const db = new FakeDb();
  const feedback = new RecordingFeedback();
  let recoveries = 0;
  TestBed.configureTestingModule({
    providers: [
      WeekStore,
      TimeEntryRepository,
      { provide: SUPABASE, useValue: db },
      { provide: USER_FEEDBACK, useValue: feedback },
      {
        provide: SESSION_RECOVERY,
        useValue: {
          recover: async () => {
            recoveries += 1;
            return outcome;
          },
        },
      },
    ],
  });
  const store = TestBed.inject(WeekStore);
  await store.showWeekOf('2026-09-15');
  return { store, db, feedback, recoveries: () => recoveries };
}

describe('Abgelaufenes Token beim Schreiben', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('wiederholt nach erneuerter Sitzung genau einmal und behaelt die Aenderung', async () => {
    const { store, db, feedback, recoveries } = await setup('refreshed');
    db.rejectWrites = 1;
    const target = movePlacement(placementOf(store.entries()[0]), 60);

    await store.moveEntry('e1', target);

    expect(db.writes()).toHaveLength(2);
    expect(recoveries()).toBe(1);
    // Gespeichert, nicht zurueckgerollt, und kein Fehler-Toast.
    expect(placementOf(store.entries()[0])).toEqual(target);
    expect(feedback.texts('error')).toEqual([]);
    expect(store.syncError()).toBe(false);
    expect(store.saving()).toBe(false);
  });

  it('rollt zurueck, wenn auch die Wiederholung abgelehnt wird — ohne Endlosschleife', async () => {
    const { store, db, feedback } = await setup('refreshed');
    db.rejectWrites = 99;
    const before = placementOf(store.entries()[0]);

    await store.moveEntry('e1', movePlacement(before, 60));

    expect(db.writes()).toHaveLength(2);
    expect(placementOf(store.entries()[0])).toEqual(before);
    expect(feedback.texts('error')).toEqual([
      'Die Änderung konnte nicht gespeichert werden. Die Anmeldung war abgelaufen.',
    ]);
  });

  it('wiederholt nicht, wenn die Sitzung wirklich vorbei ist', async () => {
    const { store, db } = await setup('ended');
    db.rejectWrites = 1;
    const before = placementOf(store.entries()[0]);

    await store.moveEntry('e1', movePlacement(before, 60));

    expect(db.writes()).toHaveLength(1);
    expect(placementOf(store.entries()[0])).toEqual(before);
  });

  it('meldet einen Refresh ohne Netz als „Keine Verbindung" und rollt zurueck', async () => {
    const { store, db, feedback } = await setup('offline');
    db.rejectWrites = 1;
    const before = placementOf(store.entries()[0]);

    await store.moveEntry('e1', movePlacement(before, 60));

    expect(placementOf(store.entries()[0])).toEqual(before);
    expect(feedback.texts('error')).toEqual([
      'Die Änderung konnte nicht gespeichert werden. Keine Verbindung zum Server.',
    ]);
    expect(store.syncError()).toBe(true);
  });
});
