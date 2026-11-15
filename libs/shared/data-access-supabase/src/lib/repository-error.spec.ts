import { TestBed } from '@angular/core/testing';

import { SUPABASE_CONFIG } from './supabase-config';
import {
  RepositoryError,
  SessionRecovery,
  SessionRecoveryOutcome,
  SupabaseErrorShape,
  classify,
  fail,
  guarded,
  injectGuarded,
  onRepositoryError,
  setVerboseRepositoryLogging,
} from './repository-error';

describe('classify', () => {
  it.each<[string, SupabaseErrorShape, string]>([
    ['PGRST301 (JWT expired)', { code: 'PGRST301', message: 'JWT expired' }, 'session-expired'],
    [
      'PGRST302 (Token fehlt)',
      { code: 'PGRST302', message: 'Anonymous access is disabled' },
      'session-expired',
    ],
    [
      'PGRST303 (Claims ungueltig)',
      { code: 'PGRST303', message: 'JWT claims invalid' },
      'session-expired',
    ],
    ['„Invalid JWT" ohne Code (Gateway)', { message: 'Invalid JWT' }, 'session-expired'],
    [
      '42501',
      { code: '42501', message: 'new row violates row-level security policy' },
      'unauthorized',
    ],
    [
      '„permission denied" ohne Code',
      { message: 'permission denied for table clients' },
      'unauthorized',
    ],
    [
      '23502 mit „JWT" nur im Nutzertext (details)',
      {
        code: '23502',
        message:
          'null value in column "project_id" of relation "time_entries" violates not-null constraint',
        details: 'Failing row contains (…, JWT-Rollout vorbereiten, …).',
      },
      'unknown',
    ],
    [
      '22P02 mit „jwt" nur im zitierten Nutzerwert (message)',
      {
        code: '22P02',
        message: 'invalid input syntax for type uuid: "my-jwt-notes"',
      },
      'unknown',
    ],
    [
      'PGRST301 bleibt Ablauf, auch wenn die Meldung „JWT" enthaelt',
      { code: 'PGRST301', message: 'JWT expired' },
      'session-expired',
    ],
    [
      '23514 mit „foreign key" nur in details',
      {
        code: '23514',
        message: 'new row for relation "projects" violates check constraint "color_hex"',
        details: 'Failing row contains (…, foreign key Workshop, …).',
      },
      'invalid-value',
    ],
    ['TypeError: Failed to fetch', { message: 'TypeError: Failed to fetch' }, 'offline'],
    ['Safari: Load failed', { message: 'Load failed' }, 'offline'],
    [
      'Firefox: NetworkError',
      { message: 'NetworkError when attempting to fetch resource.' },
      'offline',
    ],
    [
      '23503',
      { code: '23503', message: 'update or delete violates foreign key constraint' },
      'in-use',
    ],
    [
      'PGRST116',
      { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      'not-found',
    ],
  ])('%s', (_label, error, expected) => {
    expect(classify(error)).toBe(expected);
  });
});

describe('fail', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => {
    vi.restoreAllMocks();
    setVerboseRepositoryLogging(false);
  });

  const CHECK_VIOLATION: SupabaseErrorShape & { hint: string } = {
    code: '23514',
    message: 'new row for relation "time_entries" violates check constraint "ends_after_start"',
    details:
      'Failing row contains (9b1c…, 5f7e…-user, 4444…, 2026-10-06 10:00:00+00, ' +
      '2026-10-06 09:00:00+00, Angebot Familie Sandmann).',
    hint: 'irgendein Hinweis',
  };

  it('schreibt in Production nur Klasse und Code, keine Zeile und keine Beschreibung', () => {
    setVerboseRepositoryLogging(false);

    expect(() => fail(CHECK_VIOLATION)).toThrow(RepositoryError);

    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(' ');
    expect(logged).toBe('[Dailyfi] Datenzugriff fehlgeschlagen: invalid-range (23514)');
    expect(logged).not.toContain('Failing row');
    expect(logged).not.toContain('Sandmann');
    expect(logged).not.toContain('user');
  });

  it('bleibt ausserhalb von Production ausfuehrlich', () => {
    setVerboseRepositoryLogging(true);

    expect(() => fail(CHECK_VIOLATION)).toThrow(RepositoryError);

    expect(console.error).toHaveBeenCalledWith(
      '[Dailyfi] Datenzugriff fehlgeschlagen:',
      CHECK_VIOLATION,
    );
  });

  it.each([
    [true, false],
    [false, true],
  ])(
    'richtet sich ueber injectGuarded() nach SUPABASE_CONFIG.production (%s)',
    async (production, verbose) => {
      TestBed.configureTestingModule({
        providers: [
          { provide: SUPABASE_CONFIG, useValue: { url: 'x', publishableKey: 'y', production } },
        ],
      });
      const run = TestBed.runInInjectionContext(() => injectGuarded());

      await expect(run(async () => fail(CHECK_VIOLATION))).rejects.toBeInstanceOf(RepositoryError);

      const logged = vi.mocked(console.error).mock.calls.flat();
      expect(logged.includes(CHECK_VIOLATION)).toBe(verbose);
      expect(JSON.stringify(logged).includes('Sandmann')).toBe(verbose);
    },
  );

  it('laesst sich von einem werfenden Zuhoerer nicht den Fehler ersetzen', () => {
    const second = vi.fn();
    const stopFirst = onRepositoryError(() => {
      throw new Error('Zuhoerer kaputt');
    });
    const stopSecond = onRepositoryError(second);

    let thrown: unknown;
    try {
      fail({ code: 'PGRST301', message: 'JWT expired' });
    } catch (error) {
      thrown = error;
    }
    stopFirst();
    stopSecond();

    expect(thrown).toBeInstanceOf(RepositoryError);
    expect((thrown as RepositoryError).code).toBe('session-expired');
    expect(second).toHaveBeenCalledOnce();
  });
});

describe('guarded mit Sitzungsrettung', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  function recovery(outcome: SessionRecoveryOutcome): SessionRecovery & { calls: number } {
    return {
      calls: 0,
      recover() {
        this.calls += 1;
        return Promise.resolve(outcome);
      },
    };
  }

  /** Scheitert die ersten `failures` Male mit 401, danach klappt es. */
  function operation(failures: number): { run: () => Promise<string>; calls: () => number } {
    let calls = 0;
    return {
      calls: () => calls,
      run: async () => {
        calls += 1;
        if (calls <= failures) {
          fail({ code: 'PGRST301', message: 'JWT expired' });
        }
        return 'gespeichert';
      },
    };
  }

  it('wiederholt nach erneuerter Sitzung genau einmal', async () => {
    const hook = recovery('refreshed');
    const op = operation(1);

    await expect(guarded(op.run, hook)).resolves.toBe('gespeichert');

    expect(op.calls()).toBe(2);
    expect(hook.calls).toBe(1);
  });

  it('gibt nach dem zweiten 401 auf, statt endlos zu wiederholen', async () => {
    const hook = recovery('refreshed');
    const op = operation(Infinity);

    await expect(guarded(op.run, hook)).rejects.toMatchObject({ code: 'session-expired' });

    expect(op.calls()).toBe(2);
    expect(hook.calls).toBe(1);
  });

  it('wiederholt nicht, wenn die Sitzung vorbei ist', async () => {
    const op = operation(1);

    await expect(guarded(op.run, recovery('ended'))).rejects.toMatchObject({
      code: 'session-expired',
    });
    expect(op.calls()).toBe(1);
  });

  it('meldet einen Refresh ohne Netz als „offline", nicht als Ablauf', async () => {
    const op = operation(1);

    await expect(guarded(op.run, recovery('offline'))).rejects.toMatchObject({ code: 'offline' });
    expect(op.calls()).toBe(1);
  });

  it('versucht bei anderen Fehlern keine Rettung', async () => {
    const hook = recovery('refreshed');

    await expect(
      guarded(async () => fail({ code: '42501', message: 'permission denied' }), hook),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(hook.calls).toBe(0);
  });

  it('wiederholt ohne Haken nichts (Tests, Bibliothek ohne App)', async () => {
    const op = operation(1);

    await expect(guarded(op.run)).rejects.toMatchObject({ code: 'session-expired' });
    expect(op.calls()).toBe(1);
  });
});
