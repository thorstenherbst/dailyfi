import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Icon, IconName } from './icon';
import { Shortcut, SyncState } from './shell-status';

const SYNC: Record<SyncState, { icon: IconName; label: string }> = {
  synced: { icon: 'ok', label: 'synchronisiert' },
  loading: { icon: 'sync', label: 'lädt …' },
  saving: { icon: 'sync', label: 'speichert …' },
  error: { icon: 'warn', label: 'Fehler, siehe Meldung' },
};

/**
 * Statusleiste unten (32 px, immer sichtbar). Rein praesentational: die
 * App-Shell reicht die Werte durch und hoert auf `signOut`.
 *
 * Was `null` ist, wird nicht gezeigt — die Leiste behauptet nichts, was die
 * aktuelle Seite nicht weiss. Der Sync-Zustand steht als Symbol **und** Wort.
 */
@Component({
  selector: 'app-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { role: 'contentinfo', 'aria-label': 'Statusleiste' },
  styleUrl: './status-bar.scss',
  template: `
    @if (syncView(); as view) {
      <span [class]="'sync is-' + sync()"> <app-icon [name]="view.icon" />{{ view.label }} </span>
    }
    @if (weekNumber() !== null) {
      <span class="mono">KW {{ weekNumber() }}</span>
    }
    @if (weekTotal(); as total) {
      <span
        >Woche <b class="mono">{{ total }}</b></span
      >
    }
    @if (todayTotal(); as total) {
      <span
        >Heute <b class="mono">{{ total }}</b></span
      >
    }
    @if (shortcuts().length > 0) {
      <span class="shortcuts">
        @for (shortcut of shortcuts(); track shortcut.label) {
          <span class="shortcut">
            @for (key of shortcut.keys; track $index) {
              <kbd class="kbd">{{ key }}</kbd>
            }
            {{ shortcut.label }}
          </span>
        }
      </span>
    }
    <span class="right">
      @if (email(); as address) {
        <span class="email">{{ address }}</span>
      }
      <button class="btn-link" type="button" (click)="signOut.emit()">Abmelden</button>
    </span>
  `,
})
export class StatusBar {
  readonly sync = input<SyncState | null>(null);
  readonly weekNumber = input<number | null>(null);
  /** Fertig formatiert („24,25 h") — die Seite kennt das Zahlenformat. */
  readonly weekTotal = input<string | null>(null);
  readonly todayTotal = input<string | null>(null);
  readonly shortcuts = input<readonly Shortcut[]>([]);
  readonly email = input<string | null>(null);

  readonly signOut = output<void>();

  protected readonly syncView = computed(() => {
    const state = this.sync();
    return state ? SYNC[state] : null;
  });
}
