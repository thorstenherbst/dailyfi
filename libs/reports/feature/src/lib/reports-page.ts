import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';

import { ReportsStore } from '@lib/reports/data-access';
import { buildCsv, csvFilename, formatAmount, formatMonth } from '@lib/reports/domain';
import { Icon, LoadError, Wordmark, publishShellStatus } from '@lib/shared/ui';
import { FileDownload } from '@lib/shared/util-browser';
import { formatHours } from '@lib/shared/util-time';

/**
 * Summen pro Kunde, Projekt und Monat, dazu der CSV-Export.
 *
 * Die Seite rechnet nichts selbst. Die Rundungsregeln stehen in
 * `report-model.ts`, das Dateiformat in `csv.ts` — beide ohne Angular, weil an
 * ihnen die Rechnung haengt und sie sich als Wertetabelle pruefen lassen muessen.
 */
@Component({
  selector: 'app-reports-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LoadError, Wordmark],
  providers: [ReportsStore],
  templateUrl: './reports-page.html',
  styleUrl: './reports-page.scss',
})
export class ReportsPage implements OnInit {
  protected readonly store = inject(ReportsStore);
  private readonly download = inject(FileDownload);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly announcement = signal('');

  protected readonly formatMonth = formatMonth;
  protected readonly formatHours = formatHours;
  protected readonly formatAmount = formatAmount;

  /** „Oktober" fuer die Summenzeile („Summe Oktober"). */
  protected monthName(): string {
    return formatMonth(this.store.month()).split(' ')[0];
  }

  constructor() {
    publishShellStatus(() => ({
      sync: this.store.loading() ? 'loading' : this.store.syncError() ? 'error' : 'synced',
    }));
  }

  ngOnInit(): void {
    void this.store.load();
  }

  /** „Erneut laden" im Fehlerzustand. Klappt es, geht der Fokus zum Seitentitel. */
  protected async onRetryLoad(): Promise<void> {
    await this.store.load();
    // Scheitert es erneut, sagt das der Fehler-Toast — einmal, nicht doppelt.
    if (!this.store.loadError()) {
      this.announceMonth();
      afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('h1')?.focus(), {
        injector: this.injector,
      });
    }
  }

  protected async onPreviousMonth(): Promise<void> {
    await this.store.shiftMonth(-1);
    this.announceMonth();
  }

  protected async onNextMonth(): Promise<void> {
    // Gesperrt per aria-disabled: Nichts in der Zukunft zu holen.
    if (this.store.isCurrentMonth()) {
      return;
    }
    await this.store.shiftMonth(1);
    this.announceMonth();
  }

  /**
   * Der Export nimmt die Einzeleintraege, nicht die Summen der Tabelle: die
   * Beschreibungen gibt es nur dort, und sie sind der Grund, warum ein Kunde
   * einen Stundennachweis ueberhaupt lesen will.
   */
  protected onExport(): void {
    const month = this.store.month();
    const count = this.store.entries().length;
    this.download.save(csvFilename(month), buildCsv(this.store.entries()));
    this.announcement.set(
      `${count} ${count === 1 ? 'Eintrag' : 'Einträge'} für ${formatMonth(month)} ` +
        'als CSV heruntergeladen.',
    );
  }

  private announceMonth(): void {
    const report = this.store.report();
    // Beim Ladefehler spricht der Fehler-Toast; eine Summe waere hier falsch.
    if (this.store.loadError()) {
      this.announcement.set(`${formatMonth(this.store.month())}: konnte nicht geladen werden.`);
      return;
    }
    this.announcement.set(
      report.entryCount === 0
        ? `${formatMonth(this.store.month())}: keine Zeiten erfasst.`
        : `${formatMonth(this.store.month())}: ${formatHours(report.hours)} Stunden, ` +
            `${formatAmount(report.amount)}.`,
    );
  }
}
