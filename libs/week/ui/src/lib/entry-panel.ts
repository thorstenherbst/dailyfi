import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';

import { NO_PROJECT_COLOR_CLASS, projectColorClass } from '@lib/shared/domain';
import { Icon } from '@lib/shared/ui';
import { DayKey, durationHours, formatDuration, formatWeekdayLong } from '@lib/shared/util-time';
import {
  EntryFormField,
  EntryFormKey,
  EntryFormProblem,
  EntryFormValues,
  Project,
  formPlacement,
  instantsOf,
} from '@lib/week/domain';

export type EntryPanelMode = 'empty' | 'create' | 'edit';

export interface EntryPanelChange {
  readonly key: EntryFormKey;
  readonly value: string;
}

let nextId = 0;

/**
 * Detail-Panel der Woche (Brief „Detail-Panel"): bündige Spalte rechts, nicht
 * modal. Kopf / scrollender Inhalt / Aktionsleiste unten.
 *
 * Rein praesentational: Werte rein, Absichten raus. Ob gespeichert werden
 * darf, was „ungespeichert" heisst und wohin der Fokus danach geht,
 * entscheidet die Seite (`week-page`, Zustand in `week-panel.ts`).
 *
 * - Eine Region mit Ueberschrift, die den Modus nennt.
 * - Fehler stehen als Text am Feld und sind per `aria-describedby` verbunden.
 * - Enter in einem Feld speichert, ⌘/Strg+Enter ueberall im Formular.
 * - Esc meldet sich nach oben (`escape`); was es bedeutet, haengt vom Modus ab.
 * - Der Text des Hinweises „Ungespeicherte Änderungen" steht in einer
 *   dauerhaft vorhandenen, hoeflichen Live-Region, die Knoepfe daneben.
 *   Waehrend gespeichert wird, sind beide gesperrt (`aria-disabled`).
 */
@Component({
  selector: 'app-entry-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { class: 'panel-host', '(keydown)': 'onKeydown($event)' },
  template: `
    <aside class="panel" [attr.aria-labelledby]="id + '-title'">
      <div class="panel-head">
        <h2 class="panel-title" [id]="id + '-title'">{{ title() }}</h2>
        @if (escHint(); as hint) {
          <span class="hint"><kbd class="kbd">Esc</kbd> {{ hint }}</span>
        }
      </div>

      <!-- Nur der Text steht in der Live-Region; die Knoepfe daneben. Sonst
           hoerte man sie zweimal: einmal als Ansage, einmal beim Fokus auf
           „Speichern". Die Region bleibt immer im DOM (leer ohne Hoehe). -->
      <div class="panel-notice-slot" [class.panel-notice]="notice()">
        <div class="panel-live" role="status" aria-live="polite">
          @if (notice()) {
            <p class="panel-notice-text">
              <app-icon name="warn" /><b>Ungespeicherte Änderungen</b>
            </p>
            <p class="hint panel-notice-message">{{ announcedMessage() }}</p>
          }
        </div>
        @if (notice()) {
          <div class="panel-notice-actions">
            <button
              #noticeSave
              class="btn btn-primary btn-sm"
              type="button"
              [attr.aria-disabled]="busy() ? 'true' : null"
              (click)="!busy() && keep.emit()"
            >
              Speichern
            </button>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              [attr.aria-disabled]="busy() ? 'true' : null"
              (click)="!busy() && discard.emit()"
            >
              Verwerfen
            </button>
          </div>
        }
      </div>

      @if (form(); as v) {
        <!-- novalidate: Fehler stehen als Text am Feld, nicht als Browser-Blase. -->
        <form class="panel-form" novalidate (submit)="onSubmit($event)">
          <div class="panel-body">
            <div class="field">
              <label class="label" [for]="id + '-project'">Projekt</label>
              <span [class]="dotClass()">
                <span class="dot" aria-hidden="true"></span>
                <select
                  #first
                  class="input"
                  [id]="id + '-project'"
                  required
                  [value]="v.projectId"
                  [attr.aria-invalid]="problemAt('project') ? 'true' : null"
                  [attr.aria-describedby]="problemAt('project') ? id + '-project-error' : null"
                  (change)="emit('projectId', $event)"
                >
                  <option value="" [selected]="v.projectId === ''">Bitte wählen …</option>
                  @for (project of projects(); track project.id) {
                    <option [value]="project.id" [selected]="project.id === v.projectId">
                      {{ project.name }} · {{ project.clientName }}
                    </option>
                  }
                </select>
              </span>
              @if (problemAt('project'); as message) {
                <p class="form-error" [id]="id + '-project-error'">
                  <app-icon name="warn" />{{ message }}
                </p>
              }
            </div>

            <div class="field">
              <label class="label" [for]="id + '-day'">Tag</label>
              <select
                class="input"
                [id]="id + '-day'"
                [value]="v.dayKey"
                [attr.aria-invalid]="problemAt('day') ? 'true' : null"
                [attr.aria-describedby]="problemAt('day') ? id + '-day-error' : null"
                (change)="emit('dayKey', $event)"
              >
                @for (day of dayOptions(); track day) {
                  <option [value]="day" [selected]="day === v.dayKey">{{ dayLabel(day) }}</option>
                }
              </select>
              @if (problemAt('day'); as message) {
                <p class="form-error" [id]="id + '-day-error'">
                  <app-icon name="warn" />{{ message }}
                </p>
              }
            </div>

            <div class="panel-row2">
              <div class="field">
                <label class="label" [for]="id + '-from'">Von</label>
                <input
                  class="input mono"
                  [id]="id + '-from'"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  [value]="v.from"
                  [attr.aria-invalid]="timeInvalid('from') ? 'true' : null"
                  [attr.aria-describedby]="timeDescribedBy()"
                  (input)="emit('from', $event)"
                />
              </div>
              <div class="field">
                <label class="label" [for]="id + '-to'">Bis</label>
                <input
                  class="input mono"
                  [id]="id + '-to'"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  [value]="v.to"
                  [attr.aria-invalid]="timeInvalid('to') ? 'true' : null"
                  [attr.aria-describedby]="timeDescribedBy()"
                  (input)="emit('to', $event)"
                />
              </div>
            </div>
            @if (problemAt('time'); as message) {
              <p class="form-error" [id]="id + '-time-error'">
                <app-icon name="warn" />{{ message }}
              </p>
            }
            <p class="hint" [id]="id + '-time-hint'">
              Uhrzeit als <span class="mono">HH:MM</span>, auf Viertelstunden.
            </p>

            @if (duration(); as hours) {
              <p class="panel-dur">
                <span>Dauer</span><b class="mono">{{ hours }}</b>
              </p>
            }

            <div class="field">
              <label class="label" [for]="id + '-note'">Notiz</label>
              <textarea
                class="input"
                [id]="id + '-note'"
                rows="3"
                maxlength="2000"
                placeholder="Woran hast du gearbeitet?"
                [value]="v.description"
                (input)="emit('description', $event)"
              ></textarea>
            </div>

            <p class="panel-kbd hint">
              <span><kbd class="kbd">↵</kbd> speichern</span>
              <span><kbd class="kbd">Esc</kbd> {{ escShort() }}</span>
            </p>
          </div>

          <div class="panel-actions">
            <button
              class="btn btn-primary"
              type="submit"
              [attr.aria-disabled]="busy() ? 'true' : null"
            >
              <app-icon name="check" />Speichern
            </button>
            <button class="btn btn-secondary" type="button" (click)="cancelled.emit()">
              Abbrechen
            </button>
            @if (mode() === 'edit') {
              <button class="btn btn-ghost-danger" type="button" (click)="remove.emit()">
                <app-icon name="trash" />Löschen
              </button>
            }
          </div>
        </form>
      } @else {
        <div class="panel-empty">
          <p><b>Block wählen oder im Raster ziehen.</b></p>
          <p>Ein Klick oder <kbd class="kbd">Enter</kbd> auf einen Block öffnet ihn hier.</p>
          <p>Neu: im Raster aufziehen oder „Zeit eintragen" oben.</p>
          <p class="panel-kbd">
            <span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> verschieben</span>
            <span
              ><kbd class="kbd">⇧</kbd><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> Dauer</span
            >
            <span><kbd class="kbd">Entf</kbd> löschen</span>
          </p>
        </div>
      }
    </aside>
  `,
})
export class EntryPanel {
  readonly mode = input<EntryPanelMode>('empty');
  readonly values = input<EntryFormValues | null>(null);
  readonly projects = input<readonly Project[]>([]);
  readonly dayOptions = input<readonly DayKey[]>([]);
  readonly problem = input<EntryFormProblem | null>(null);
  /** „Ungespeicherte Änderungen" anzeigen. */
  readonly notice = input(false);
  /** Was der Hinweis sagt (wozu er steht, was die Knoepfe tun). */
  readonly noticeMessage = input<string | null>(null);
  /**
   * Wechselt mit jeder neuen Absicht. Bleibt der Text gleich, sagt der Hinweis
   * sich trotzdem neu an (ein unsichtbares Zeichen am Ende aendert den Inhalt).
   */
  readonly noticeRevision = input(0);
  /** Speichern laeuft. */
  readonly busy = input(false);

  readonly changed = output<EntryPanelChange>();
  readonly save = output<void>();
  readonly cancelled = output<void>();
  readonly remove = output<void>();
  readonly escape = output<void>();
  /** Hinweis: „Speichern". */
  readonly keep = output<void>();
  /** Hinweis: „Verwerfen". */
  readonly discard = output<void>();

  protected readonly id = `entry-panel-${++nextId}`;

  private readonly firstRef = viewChild<ElementRef<HTMLSelectElement>>('first');
  private readonly noticeSaveRef = viewChild<ElementRef<HTMLButtonElement>>('noticeSave');

  protected readonly announcedMessage = computed(
    () => (this.noticeMessage() ?? '') + (this.noticeRevision() % 2 ? '\u00a0' : ''),
  );

  /** Esc verwirft beim Anlegen den Entwurf, beim Bearbeiten geht nichts verloren. */
  protected readonly escHint = computed(() => {
    switch (this.mode()) {
      case 'create':
        return 'verwirft den Entwurf';
      case 'edit':
        return 'zurück zum Raster';
      default:
        return null;
    }
  });
  protected readonly escShort = computed(() =>
    this.mode() === 'create' ? 'verwerfen' : 'zurück',
  );

  protected readonly form = computed(() => (this.mode() === 'empty' ? null : this.values()));

  protected readonly title = computed(() => {
    switch (this.mode()) {
      case 'create':
        return 'Neuer Eintrag';
      case 'edit':
        return 'Eintrag bearbeiten';
      default:
        return 'Kein Eintrag gewählt';
    }
  });

  protected readonly dotClass = computed(() => {
    const projectId = this.values()?.projectId;
    const project = this.projects().find((candidate) => candidate.id === projectId);
    return `select-wrap ${project ? projectColorClass(project.color) : NO_PROJECT_COLOR_CLASS}`;
  });

  /** Abgerechnete Dauer — am Umstelltag weicht sie von der Rasterhoehe ab. */
  protected readonly duration = computed(() => {
    const values = this.values();
    const placement = values ? formPlacement(values) : null;
    if (!placement) {
      return null;
    }
    try {
      const { startedAt, endedAt } = instantsOf(placement);
      return formatDuration(durationHours(startedAt, endedAt));
    } catch {
      return null;
    }
  });

  protected readonly timeDescribedBy = computed(() =>
    this.problemAt('time') ? `${this.id}-time-error ${this.id}-time-hint` : `${this.id}-time-hint`,
  );

  /** Fokus auf „Projekt" — nach Klick/Enter auf einen Block und beim Anlegen. */
  focusFirst(): void {
    this.firstRef()?.nativeElement.focus();
  }

  /** Fokus auf „Speichern" im Hinweis. */
  focusNotice(): void {
    this.noticeSaveRef()?.nativeElement.focus();
  }

  /** Fokus auf das Feld mit dem Fehler. */
  focusProblem(field: EntryFormField): void {
    const suffix = field === 'time' ? this.timeTarget() : field;
    document.getElementById(`${this.id}-${suffix}`)?.focus();
  }

  protected problemAt(field: EntryFormField): string | null {
    const problem = this.problem();
    return problem?.field === field ? problem.message : null;
  }

  protected timeInvalid(which: 'from' | 'to'): boolean {
    return this.problem()?.invalid.includes(which) ?? false;
  }

  protected dayLabel(day: DayKey): string {
    const [, month, dayOfMonth] = day.split('-');
    return `${formatWeekdayLong(day)}, ${Number(dayOfMonth)}.${Number(month)}.`;
  }

  protected emit(key: EntryFormKey, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    this.changed.emit({ key, value: target.value });
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.busy()) {
      this.save.emit();
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.escape.emit();
      return;
    }
    if (event.key !== 'Enter' || this.mode() === 'empty') {
      return;
    }
    const target = event.target as HTMLElement;
    // ⌘/Strg+Enter speichert ueberall; Enter allein in der Notiz auch (sie ist
    // einzeilig gemeint), in Auswahllisten und auf Knoepfen bleibt Enter beim
    // Element.
    if (event.metaKey || event.ctrlKey || target.tagName === 'TEXTAREA') {
      event.preventDefault();
      if (!this.busy()) {
        this.save.emit();
      }
    }
  }

  private timeTarget(): 'from' | 'to' {
    return this.problem()?.invalid[0] ?? 'from';
  }
}
