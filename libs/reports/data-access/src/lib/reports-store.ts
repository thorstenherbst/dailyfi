import { Injectable, PendingTasks, computed, inject, signal } from '@angular/core';

import {
  MonthKey,
  ReportEntry,
  buildMonthReport,
  currentMonthKey,
  monthRange,
  shiftMonth,
} from '@lib/reports/domain';
import {
  RepositoryError,
  RepositoryErrorCode,
  TransientErrorFeedback,
  USER_FEEDBACK,
  isSyncFailure,
} from '@lib/shared/data-access-supabase';

import { ReportRepository } from './report-repository';

const ERROR_TEXTS: Record<RepositoryErrorCode, string> = {
  offline: 'Keine Verbindung zum Server.',
  'session-expired': 'Die Anmeldung war abgelaufen.',
  unauthorized: 'Dafür fehlt die Berechtigung.',
  'invalid-range': 'Dieser Zeitraum lässt sich nicht abfragen.',
  'invalid-value': 'Diese Angabe nimmt der Server nicht an.',
  'in-use': 'Das hat nicht geklappt.',
  'not-found': 'Dazu gibt es keine Daten mehr.',
  unknown: 'Das hat nicht geklappt.',
};

function describeError(error: unknown): string {
  if (error instanceof RepositoryError) {
    return ERROR_TEXTS[error.code];
  }
  console.error('[Dailyfi] Unerwarteter Fehler:', error);
  return ERROR_TEXTS.unknown;
}

/**
 * Zustand der Auswertung. Haelt die Eintraege des gewaehlten Monats und leitet
 * daraus den Bericht ab — die Rechnung selbst steht in `report-model.ts` und
 * kennt weder Angular noch Supabase.
 */
@Injectable()
export class ReportsStore {
  private readonly repository = inject(ReportRepository);
  private readonly tasks = inject(PendingTasks);
  private readonly feedback = inject(USER_FEEDBACK);
  /** Der Toast zum letzten Ladefehler — weg damit, sobald wieder geladen ist. */
  private readonly loadErrorToast = new TransientErrorFeedback(this.feedback);

  readonly month = signal<MonthKey>(currentMonthKey());
  readonly entries = signal<readonly ReportEntry[]>([]);
  readonly loading = signal(false);
  /**
   * Laden gescheitert (deutscher Grund). Die Seite zeigt dann einen
   * Fehlerzustand mit „Erneut laden" — **nicht** „keine Zeiten erfasst".
   */
  readonly loadError = signal<string | null>(null);
  /** Der Server war nicht erreichbar o. ae. — fuer die Statusleiste. */
  readonly syncError = signal(false);

  readonly report = computed(() => buildMonthReport(this.entries()));
  readonly isCurrentMonth = computed(() => this.month() === currentMonthKey());

  load(): Promise<void> {
    const done = this.tasks.add();
    return this.doLoad().finally(done);
  }

  async showMonth(monthKey: MonthKey): Promise<void> {
    this.month.set(monthKey);
    await this.load();
  }

  async shiftMonth(delta: number): Promise<void> {
    await this.showMonth(shiftMonth(this.month(), delta));
  }

  async goToCurrentMonth(): Promise<void> {
    await this.showMonth(currentMonthKey());
  }

  private async doLoad(): Promise<void> {
    // `loadError` bleibt bis zum Ergebnis stehen: „Erneut laden" behaelt so
    // seine Karte und den Fokus, statt auf `body` zu fallen.
    this.loading.set(true);
    try {
      const { from, to } = monthRange(this.month());
      this.entries.set(await this.repository.listRange(from, to));
      this.syncError.set(false);
      this.loadError.set(null);
      this.loadErrorToast.dismiss();
    } catch (error) {
      // Bei einem Fehler bleibt nichts Halbes stehen: eine Auswertung, die
      // zufaellig den Vormonat zeigt, waere schlimmer als eine leere.
      this.entries.set([]);
      const reason = describeError(error);
      this.loadError.set(reason);
      this.syncError.set(isSyncFailure(error));
      this.loadErrorToast.error('Die Auswertung konnte nicht geladen werden.', { detail: reason });
    } finally {
      this.loading.set(false);
    }
  }
}
