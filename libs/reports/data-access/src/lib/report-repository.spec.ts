import { TestBed } from '@angular/core/testing';

import { buildMonthReport, monthRange } from '@lib/reports/domain';
import { RepositoryError, SUPABASE } from '@lib/shared/data-access-supabase';

import { ReportRepository } from './report-repository';

/**
 * **Aufgezeichnete Antwort des laufenden Stacks**, nicht erfunden.
 *
 * Abgefragt am 06.10.2026 gegen das lokale Supabase mit genau dem `select` aus
 * `report-repository.ts`. Der Grund, warum das hier als Datei liegt und nicht
 * nur einmal von Hand angesehen wurde: an der verschachtelten Auswahl
 * (`projects!inner` → `clients!inner`) haengt die Form, die `Row` erwartet, und
 * PostgREST entscheidet selbst, ob eine Beziehung als Objekt oder als Feld
 * zurueckkommt. Faellt das eines Tages auf ein Array um, bricht die Rechnung
 * lautlos — hier bricht stattdessen dieser Test.
 *
 * Drei Eigenschaften, die die Antwort nachweislich hat:
 * - `project` ist ein **Objekt**, kein Array, und `client` darin genauso;
 * - `hourly_rate` kommt als JSON-Zahl, `null` bleibt `null`;
 * - ein **archiviertes** Projekt ist enthalten — der Bericht filtert es
 *   ausdruecklich nicht heraus.
 */
const RECORDED_RESPONSE = [
  {
    id: '30cc4f81-a49d-4c7f-8d0d-265d9a9c1a21',
    started_at: '2026-09-30T22:00:00+00:00',
    ended_at: '2026-10-01T00:00:00+00:00',
    description: 'GRENZE erster Moment des Monats',
    project: {
      id: '44444444-4444-4444-8444-000000000001',
      name: 'Relaunch',
      client: {
        id: '33333333-3333-4333-8333-000000000001',
        name: 'Sandmann GmbH',
        archived_at: null,
      },
      archived_at: null,
      hourly_rate: 95.0,
    },
  },
  {
    id: '1179baa2-2c21-44fc-a45d-e283426eef9b',
    started_at: '2026-10-05T08:00:00+00:00',
    ended_at: '2026-10-05T09:30:00+00:00',
    description: 'ohne Stundensatz',
    project: {
      id: 'ea60f529-b7d2-4d3b-a0e4-ffb60c29c7d4',
      name: 'Pro bono',
      client: {
        id: '33333333-3333-4333-8333-000000000001',
        name: 'Sandmann GmbH',
        archived_at: null,
      },
      archived_at: null,
      hourly_rate: null,
    },
  },
  {
    id: 'ca58ec24-9039-4372-b5aa-6a32bd6017fe',
    started_at: '2026-10-06T08:00:00+00:00',
    ended_at: '2026-10-06T10:00:00+00:00',
    description: 'auf archiviertem Projekt',
    project: {
      id: '5019e8a1-0d2f-4588-bc0b-c8c9551a8693',
      name: 'Altlast',
      client: {
        id: '33333333-3333-4333-8333-000000000002',
        name: 'Nordlicht Medien',
        archived_at: null,
      },
      archived_at: '2026-09-15T10:00:00+00:00',
      hourly_rate: 70.0,
    },
  },
  {
    id: '382c9723-00be-49c0-a284-78991cb830a4',
    started_at: '2026-10-24T23:00:00+00:00',
    ended_at: '2026-10-25T03:00:00+00:00',
    description: 'Zeitumstellung: Wanduhr 01:00-04:00',
    project: {
      id: '44444444-4444-4444-8444-000000000003',
      name: 'Beratung',
      client: {
        id: '33333333-3333-4333-8333-000000000002',
        name: 'Nordlicht Medien',
        archived_at: null,
      },
      archived_at: null,
      hourly_rate: 140.0,
    },
  },
] as const;

interface QueryLog {
  table: string;
  select: string;
  filters: Array<{ operator: string; column: string; value: string }>;
  order: string | null;
}

/**
 * Supabase-Doppel fuer genau die Kette, die das Repository baut. Was hier fehlt,
 * faellt im Test als `undefined is not a function` auf statt still zu nichts zu
 * werden — dieselbe Entscheidung wie in `testing/fake-supabase.ts`.
 */
class FakeDb {
  readonly log: QueryLog[] = [];
  data: unknown = RECORDED_RESPONSE;
  error: { message: string; code?: string } | null = null;
  /** Wirft statt zu antworten — ein abgebrochenes `fetch` sieht so aus. */
  throws: unknown = null;

  from(table: string) {
    const entry: QueryLog = { table, select: '', filters: [], order: null };
    this.log.push(entry);
    const db = this;

    const builder = {
      select(columns: string) {
        entry.select = columns;
        return builder;
      },
      gte(column: string, value: string) {
        entry.filters.push({ operator: 'gte', column, value });
        return builder;
      },
      lt(column: string, value: string) {
        entry.filters.push({ operator: 'lt', column, value });
        return builder;
      },
      order(column: string) {
        entry.order = column;
        return builder;
      },
      // Die Kette wird am Ende `await`-et, nicht abgeschickt.
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        if (db.throws) {
          return Promise.reject(db.throws).then(resolve, reject);
        }
        return Promise.resolve({ data: db.data, error: db.error }).then(resolve, reject);
      },
    };

    return builder;
  }
}

function setup(configure: (db: FakeDb) => void = () => {}): {
  repository: ReportRepository;
  db: FakeDb;
} {
  const db = new FakeDb();
  configure(db);

  TestBed.configureTestingModule({
    providers: [{ provide: SUPABASE, useValue: db }],
  });

  return { repository: TestBed.inject(ReportRepository), db };
}

describe('ReportRepository', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('fragt die Zeitspanne halboffen ab und sortiert nach Beginn', async () => {
    const { repository, db } = setup();
    const { from, to } = monthRange('2026-10');

    await repository.listRange(from, to);

    expect(db.log).toHaveLength(1);
    const [query] = db.log;
    expect(query.table).toBe('time_entries');
    // `gte` und `lt`, nicht `lte`: der letzte Augenblick eines Monats ist der
    // erste des naechsten. Mit `lte` zaehlte ein Eintrag, der genau um
    // Mitternacht beginnt, in beiden Monaten.
    expect(query.filters).toEqual([
      { operator: 'gte', column: 'started_at', value: '2026-09-30T22:00:00.000Z' },
      { operator: 'lt', column: 'started_at', value: '2026-10-31T23:00:00.000Z' },
    ]);
    expect(query.order).toBe('started_at');
  });

  it('holt Projekt und Kunde verschachtelt mit, ohne Archiviertes zu filtern', async () => {
    const { repository, db } = setup();

    await repository.listRange(new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));

    const { select } = db.log[0];
    expect(select).toContain('projects!inner');
    expect(select).toContain('clients!inner');
    // `archived_at` muss mitkommen, sonst kann die Tabelle nichts markieren.
    expect(select).toContain('archived_at');
    expect(select).toContain('hourly_rate');
    // Kein `archived_at=is.null` — anders als `listProjects()` im Raster.
    expect(db.log[0].filters.every((filter) => filter.column === 'started_at')).toBe(true);
  });

  it('bildet die aufgezeichnete Antwort des Servers auf ReportEntry ab', async () => {
    const { repository } = setup();

    const entries = await repository.listRange(
      new Date('2026-09-30T22:00:00Z'),
      new Date('2026-10-31T23:00:00Z'),
    );

    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({
      id: '30cc4f81-a49d-4c7f-8d0d-265d9a9c1a21',
      startedAt: new Date('2026-09-30T22:00:00Z'),
      endedAt: new Date('2026-10-01T00:00:00Z'),
      description: 'GRENZE erster Moment des Monats',
      projectId: '44444444-4444-4444-8444-000000000001',
      projectName: 'Relaunch',
      projectArchived: false,
      hourlyRate: 95,
      clientId: '33333333-3333-4333-8333-000000000001',
      clientName: 'Sandmann GmbH',
      clientArchived: false,
    });

    // Ohne Satz bleibt `null` — nicht 0, sonst sieht die Summe plausibel aus.
    expect(entries[1].hourlyRate).toBeNull();
    // Archiviert wird markiert, aber mitgeliefert.
    expect(entries[2].projectArchived).toBe(true);
    expect(entries[2].projectName).toBe('Altlast');
  });

  it('nimmt einen Stundensatz auch als Zeichenkette an', async () => {
    const { repository } = setup((db) => {
      // `numeric` kommt je nach Weg als Zeichenkette — mit `+` oder blind
      // weitergegeben waere daraus `"95.00"` und jede Rechnung Text.
      db.data = [
        {
          ...RECORDED_RESPONSE[0],
          project: { ...RECORDED_RESPONSE[0].project, hourly_rate: '95.00' },
        },
      ];
    });

    const [entry] = await repository.listRange(new Date(0), new Date(1));

    expect(entry.hourlyRate).toBe(95);
  });

  it('rechnet aus der echten Antwort die Summen, die die Tabelle zeigt', async () => {
    const { repository } = setup();
    const { from, to } = monthRange('2026-10');

    const report = buildMonthReport(await repository.listRange(from, to));

    // 2,00 h Relaunch + 1,50 h Pro bono = 3,50 h bei Sandmann, davon 190,00 €
    // abrechenbar; Pro bono traegt nichts bei und wird als Luecke gemeldet.
    const sandmann = report.clients.find((client) => client.clientName === 'Sandmann GmbH')!;
    expect(sandmann.hours).toBe(3.5);
    expect(sandmann.amount).toBe(190);
    expect(sandmann.hasRateGap).toBe(true);
    expect(report.projectsWithoutRate).toEqual(['Pro bono']);

    // Der Umstellungsblock: Wanduhr 01:00–04:00 am 25.10. sind **vier** echte
    // Stunden, weil die Stunde zweimal laeuft. 4 × 140 € = 560 €, dazu 2 h auf
    // dem archivierten Projekt zu 70 € = 140 €.
    const nordlicht = report.clients.find((client) => client.clientName === 'Nordlicht Medien')!;
    expect(nordlicht.hours).toBe(6);
    expect(nordlicht.amount).toBe(700);

    expect(report.hours).toBe(9.5);
    expect(report.amount).toBe(890);
  });

  it('macht aus einem Serverfehler einen RepositoryError mit Code', async () => {
    const { repository } = setup((db) => {
      db.error = { message: 'JWT expired', code: 'PGRST301' };
    });

    await expect(repository.listRange(new Date(0), new Date(1))).rejects.toMatchObject({
      name: 'RepositoryError',
      code: 'session-expired',
    });
  });

  it('faengt auch ein abgebrochenes fetch ab, das die Bibliothek wirft', async () => {
    const { repository } = setup((db) => {
      db.throws = new TypeError('Failed to fetch');
    });

    const error = await repository.listRange(new Date(0), new Date(1)).catch((reason) => reason);

    expect(error).toBeInstanceOf(RepositoryError);
    expect(error.code).toBe('offline');
  });

  it('liefert eine leere Liste, wenn der Monat leer ist', async () => {
    const { repository } = setup((db) => {
      db.data = null;
    });

    await expect(repository.listRange(new Date(0), new Date(1))).resolves.toEqual([]);
  });
});
