import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { Icon } from './icon';

/**
 * Sichtbarer Fehlerzustand, wenn eine Seite ihre Daten nicht laden konnte —
 * statt eines leeren Zustands, der „hier ist nichts" behauptet. Der Toast
 * meldet den Fehler einmal; diese Karte bleibt stehen und bietet den Weg
 * zurueck.
 *
 * Waehrend erneut geladen wird, bleibt der Knopf stehen (`aria-disabled`,
 * nicht `disabled`): sonst fiele der Fokus auf `body`.
 */
@Component({
  selector: 'app-load-error',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { class: 'load-error' },
  template: `
    <app-icon class="load-error-icon" name="error" />
    <div class="load-error-body">
      <p class="load-error-title">{{ title() }}</p>
      @if (detail(); as text) {
        <p class="load-error-detail">{{ text }}</p>
      }
      <button
        class="btn btn-secondary btn-sm"
        type="button"
        [attr.aria-disabled]="busy() ? 'true' : null"
        (click)="onRetry()"
      >
        <app-icon name="sync" />
        {{ busy() ? 'Lädt …' : 'Erneut laden' }}
      </button>
    </div>
  `,
})
export class LoadError {
  readonly title = input.required<string>();
  readonly detail = input<string | null>(null);
  readonly busy = input(false);
  readonly retry = output<void>();

  protected onRetry(): void {
    if (!this.busy()) {
      this.retry.emit();
    }
  }
}
