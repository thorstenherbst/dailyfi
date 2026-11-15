import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import {
  Client,
  PROJECT_COLORS,
  RowFormField,
  RowFormKey,
  RowFormProblem,
  RowFormValues,
  colorName,
  projectColorSlot,
} from '@lib/projects/domain';
import { Icon } from '@lib/shared/ui';

/** Was eine Zeile im Bearbeiten-Modus braucht. `null` heisst: nicht in Bearbeitung. */
export interface RowEditorState {
  readonly values: RowFormValues;
  readonly problem: RowFormProblem | null;
  /** „Ungespeicherte Änderungen" anzeigen. */
  readonly notice: boolean;
  readonly noticeMessage: string | null;
  /** Wechselt mit jeder neuen Absicht: der Hinweis sagt sich neu an. */
  readonly noticeRevision: number;
  /** Speichern laeuft. */
  readonly busy: boolean;
  /** Kunden fuer die Auswahl (Projektzeilen). */
  readonly clients: readonly Client[];
}

/** Alles, was eine Zeile nach oben meldet. Die Seite entscheidet, was es bedeutet. */
export type RowEditorEvent =
  | { readonly type: 'change'; readonly key: RowFormKey; readonly value: string }
  | { readonly type: 'save' }
  | { readonly type: 'cancel' }
  | { readonly type: 'escape' }
  /** Hinweis: „Speichern". */
  | { readonly type: 'keep' }
  /** Hinweis: „Verwerfen". */
  | { readonly type: 'discard' };

let nextId = 0;

/**
 * Inhalt einer Inline-Zeile (Brief „Inline-Zeile"): Name, Farbe, Stundensatz
 * und Kunde bzw. nur der Name, dazu Speichern/Abbrechen und der Hinweis
 * „Ungespeicherte Änderungen". Rein praesentational: Werte rein, Absichten
 * raus (`event`).
 *
 * - Jedes Feld hat ein sichtbares `<label>` bzw. eine `<legend>`; nur die
 *   eingeklappte Leerzeile („Neues Projekt …") traegt ihr Label als
 *   `aria-label`, ihr Platzhalter sagt dasselbe sichtbar.
 * - Die Farbe ist eine native Radiogruppe: Pfeiltasten waehlen, Tab verlaesst
 *   sie. Jeder Punkt hat seinen Namen als Label, der gewaehlte steht zusaetzlich
 *   als Text daneben — die Farbe ist nie die einzige Information. Ein fremder
 *   Wert zeigt Graphit gewaehlt; solange niemand umfaerbt, bleibt er gespeichert.
 * - Fehler stehen als Text unter den Feldern, per `aria-describedby` verbunden.
 * - Enter in einem Feld speichert (Formular-Submit), Esc meldet sich nach oben.
 * - Waehrend des Speicherns sind „Speichern" und die Hinweisknoepfe
 *   `aria-disabled`; „Abbrechen" bleibt bewusst bedienbar und wartet auf das
 *   Ergebnis (wie im Panel der Woche, siehe `ProjectsPage.onCancel`).
 * - Der Hinweistext steht in einer hoeflichen Live-Region, die mit dem
 *   Bearbeiten-Modus entsteht; die Knoepfe daneben (sonst doppelt angesagt).
 */
@Component({
  selector: 'app-row-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  styleUrl: './row-editor.scss',
  template: `
    <form class="row-form" novalidate (submit)="onSubmit($event)" (keydown)="onKeydown($event)">
      <div class="row-fields">
        @if (placeholder()) {
          <app-icon class="row-plus" name="plus" />
        }
        <div class="row-field row-field-name">
          @if (open()) {
            <label class="row-label" [for]="id + '-name'">{{ nameLabel() }}</label>
          }
          <input
            class="input row-name"
            type="text"
            maxlength="120"
            autocomplete="off"
            data-field="name"
            [id]="id + '-name'"
            [attr.aria-label]="open() ? null : nameLabel()"
            [placeholder]="placeholder() ?? ''"
            [value]="state()?.values?.name ?? ''"
            [attr.aria-invalid]="problemAt('name') ? 'true' : null"
            [attr.aria-describedby]="problemAt('name') ? id + '-error' : null"
            (input)="emitChange('name', $event)"
          />
        </div>

        @if (state(); as s) {
          @if (kind() === 'project') {
            <fieldset class="row-field row-colors">
              <legend class="row-label">Farbe</legend>
              <div class="swatches">
                @for (option of colors; track option.value) {
                  <label [class]="'swatch pc' + option.slot">
                    <input
                      type="radio"
                      [name]="id + '-color'"
                      [value]="option.value"
                      [checked]="slot() === option.slot"
                      [attr.data-field]="slot() === option.slot ? 'color' : null"
                      (change)="emitChange('color', $event)"
                    />
                    <span class="sr-only">{{ option.name }}</span>
                    <app-icon class="swatch-check" name="check" />
                  </label>
                }
                <span class="swatch-name" aria-hidden="true">{{ currentColorName() }}</span>
              </div>
            </fieldset>

            <div class="row-field">
              <label class="row-label" [for]="id + '-rate'">Stundensatz</label>
              <span class="unit">
                <input
                  class="input mono row-rate"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  data-field="rate"
                  [id]="id + '-rate'"
                  [value]="s.values.rate"
                  [attr.aria-invalid]="problemAt('rate') ? 'true' : null"
                  [attr.aria-describedby]="
                    (problemAt('rate') ? id + '-error ' : '') + id + '-rate-hint'
                  "
                  (input)="emitChange('rate', $event)"
                />
                <span class="unit-suffix" aria-hidden="true">€/h</span>
              </span>
            </div>

            <div class="row-field">
              <label class="row-label" [for]="id + '-client'">Kunde</label>
              <select
                class="input row-client"
                data-field="client"
                [id]="id + '-client'"
                [attr.aria-invalid]="problemAt('client') ? 'true' : null"
                [attr.aria-describedby]="problemAt('client') ? id + '-error' : null"
                (change)="emitChange('clientId', $event)"
              >
                @if (s.values.clientId === '') {
                  <option value="" selected>Bitte wählen …</option>
                }
                @for (client of s.clients; track client.id) {
                  <option [value]="client.id" [selected]="client.id === s.values.clientId">
                    {{ client.name }}{{ client.archivedAt ? ' (archiviert)' : '' }}
                  </option>
                }
              </select>
            </div>
          }

          <div class="row-actions">
            <button
              class="btn btn-primary btn-sm"
              type="submit"
              [attr.aria-disabled]="s.busy ? 'true' : null"
            >
              {{ s.busy ? 'Speichert …' : 'Speichern' }}
            </button>
            <button class="btn btn-secondary btn-sm" type="button" (click)="emit({ type: 'cancel' })">
              Abbrechen
            </button>
          </div>
        }
      </div>

      @if (state(); as s) {
        @if (s.problem; as problem) {
          <p class="form-error" [id]="id + '-error'">
            <app-icon name="warn" /> {{ problem.message }}
          </p>
        }
        <p class="hint row-hint">
          @if (kind() === 'project') {
            <span [id]="id + '-rate-hint'">
              Satz in Euro pro Stunde, Komma erlaubt; leer lassen, wenn nicht nach Stunden
              abgerechnet wird.
            </span>
          }
          <span aria-hidden="true">
            <kbd class="kbd">↵</kbd> speichern · <kbd class="kbd">Esc</kbd> beenden
          </span>
        </p>

        <div class="row-notice-slot" [class.row-notice]="s.notice">
          <div class="row-live" role="status" aria-live="polite">
            @if (s.notice) {
              <p class="row-notice-text">
                <app-icon name="warn" /><b>Ungespeicherte Änderungen.</b>
                <!-- Fuehrendes Leerzeichen: sonst liest ein Screenreader beides als ein Wort. -->
                <span class="hint">{{ ' ' + announced() }}</span>
              </p>
            }
          </div>
          @if (s.notice) {
            <div class="row-notice-actions">
              <button
                class="btn btn-primary btn-sm row-notice-save"
                type="button"
                [attr.aria-disabled]="s.busy ? 'true' : null"
                (click)="!s.busy && emit({ type: 'keep' })"
              >
                Speichern
              </button>
              <button
                class="btn btn-secondary btn-sm"
                type="button"
                [attr.aria-disabled]="s.busy ? 'true' : null"
                (click)="!s.busy && emit({ type: 'discard' })"
              >
                Verwerfen
              </button>
            </div>
          }
        </div>
      }
    </form>
  `,
})
export class RowEditor {
  readonly kind = input.required<'project' | 'client'>();
  /** Zustand im Bearbeiten-Modus; `null`: eingeklappt (nur bei der Leerzeile). */
  readonly state = input<RowEditorState | null>(null);
  /** Name des Namensfelds, z. B. „Projektname" oder „Neues Projekt für Kessler". */
  readonly nameLabel = input.required<string>();
  /** Nur die Leerzeile: Platzhalter, zugleich Kennzeichen „Anlegen". */
  readonly placeholder = input<string | null>(null);

  readonly event = output<RowEditorEvent>();

  protected readonly id = `row-editor-${++nextId}`;
  protected readonly colors = PROJECT_COLORS;

  protected readonly open = computed(() => this.state() !== null);
  /** Ein fremder oder alter Wert waehlt den Slot, auf den er abgebildet wird. */
  protected readonly slot = computed(() => projectColorSlot(this.state()?.values.color ?? ''));
  protected readonly currentColorName = computed(() => colorName(this.state()?.values.color ?? ''));

  /** Bleibt der Text gleich, aendert ein unsichtbares Zeichen den Inhalt: neu angesagt. */
  protected readonly announced = computed(() => {
    const state = this.state();
    return (state?.noticeMessage ?? '') + ((state?.noticeRevision ?? 0) % 2 ? ' ' : '');
  });

  protected problemAt(field: RowFormField): boolean {
    return this.state()?.problem?.field === field;
  }

  protected emit(event: RowEditorEvent): void {
    this.event.emit(event);
  }

  protected emitChange(key: RowFormKey, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    this.event.emit({ type: 'change', key, value: target.value });
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.state()?.busy) {
      this.event.emit({ type: 'save' });
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.open()) {
      event.preventDefault();
      event.stopPropagation();
      this.event.emit({ type: 'escape' });
    }
  }
}
