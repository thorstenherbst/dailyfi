import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { ProjectRecord, colorName, formatRate, projectColorClass } from '@lib/projects/domain';
import { Icon, Tooltip } from '@lib/shared/ui';

import { RowEditor, RowEditorEvent, RowEditorState } from './row-editor';

/**
 * Eine Projektzeile der Tabelle in /projects: anzeigen oder (mit `editor`)
 * direkt in der Zeile bearbeiten. Praesentational — was „bearbeiten" heisst
 * und ob es gerade darf, entscheidet die Seite.
 *
 * Als Attribut-Komponente auf `<tr>`, damit die Tabellensemantik stimmt (ein
 * eigenes Element zwischen `<tbody>` und `<tr>` braeche sie).
 */
@Component({
  selector: 'tr[app-project-row]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Tooltip, RowEditor],
  styleUrl: './rows.scss',
  host: {
    '[class.editing]': 'editor() !== null',
    '[class.archived]': 'archived()',
    '[attr.data-row]': "'p:' + project().id",
  },
  template: `
    @if (editor(); as state) {
      <td colspan="4" class="editing-cell">
        <app-row-editor
          kind="project"
          [nameLabel]="'Projektname'"
          [state]="state"
          (event)="editorEvent.emit($event)"
        />
      </td>
    } @else {
      <th scope="row" class="name-cell">
        <span class="namecell">
          <span [class]="'dot ' + colorClass()" aria-hidden="true"></span>
          {{ project().name }}
          @if (archived()) {
            <span class="tag">archiviert</span>
          }
        </span>
      </th>
      <!-- Die Farbe steht zusaetzlich als Text da: sie darf nie die einzige
           Information sein. -->
      <td class="color-name">{{ colorLabel() }}</td>
      <td class="num">{{ rate() }}</td>
      <td class="actions tooltip-group">
        <button
          class="btn btn-icon btn-sm row-edit"
          type="button"
          appTooltip="Bearbeiten"
          [attr.aria-label]="'Projekt ' + project().name + ' bearbeiten'"
          (click)="edit.emit()"
        >
          <app-icon name="pencil" />
        </button>
        @if (archived()) {
          <button
            class="btn btn-icon btn-sm row-restore"
            type="button"
            appTooltip="Zurückholen"
            [attr.aria-label]="'Projekt ' + project().name + ' zurückholen'"
            (click)="restore.emit($event)"
          >
            <app-icon name="restore" />
          </button>
        } @else {
          <button
            class="btn btn-icon btn-sm row-archive"
            type="button"
            appTooltip="Archivieren"
            [attr.aria-label]="'Projekt ' + project().name + ' archivieren'"
            (click)="archive.emit($event)"
          >
            <app-icon name="archive" />
          </button>
        }
      </td>
    }
  `,
})
export class ProjectRow {
  readonly project = input.required<ProjectRecord>();
  /** Bearbeiten-Modus, sonst `null`. */
  readonly editor = input<RowEditorState | null>(null);

  readonly edit = output<void>();
  /** Das Ereignis geht mit: die Seite merkt sich den Knopf fuer die Fokus-Rueckgabe. */
  readonly archive = output<Event>();
  /** Mit Ereignis: die Seite fuehrt danach den Fokus (siehe `archive`). */
  readonly restore = output<Event>();
  readonly editorEvent = output<RowEditorEvent>();

  protected readonly archived = computed(() => this.project().archivedAt !== null);
  protected readonly colorClass = computed(() => projectColorClass(this.project().color));
  protected readonly colorLabel = computed(() => colorName(this.project().color));
  protected readonly rate = computed(() => formatRate(this.project().hourlyRate));
}
