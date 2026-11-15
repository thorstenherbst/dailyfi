import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Client } from '@lib/projects/domain';
import { Icon, Tooltip } from '@lib/shared/ui';

import { RowEditor, RowEditorEvent, RowEditorState } from './row-editor';

/**
 * Kopfzeile einer Kundengruppe: Name (als Kopf der Gruppe, `scope="rowgroup"`)
 * und Aktionen, oder (mit `editor`) Umbenennen direkt in der Zeile.
 * Praesentational, als Attribut-Komponente auf `<tr>`.
 */
@Component({
  selector: 'tr[app-client-row]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Tooltip, RowEditor],
  styleUrl: './rows.scss',
  host: {
    class: 'group-row',
    '[class.editing]': 'editor() !== null',
    '[class.archived]': 'archived()',
    '[attr.data-row]': "'c:' + client().id",
  },
  template: `
    @if (editor(); as state) {
      <td colspan="4" class="editing-cell">
        <app-row-editor
          kind="client"
          [nameLabel]="'Kundenname'"
          [state]="state"
          (event)="editorEvent.emit($event)"
        />
      </td>
    } @else {
      <th scope="rowgroup" colspan="3">
        <span class="namecell">
          {{ client().name }}
          @if (archived()) {
            <span class="tag">archiviert</span>
          }
        </span>
      </th>
      <td class="actions tooltip-group">
        <button
          class="btn btn-icon btn-sm row-edit"
          type="button"
          appTooltip="Umbenennen"
          [attr.aria-label]="'Kunde ' + client().name + ' umbenennen'"
          (click)="edit.emit()"
        >
          <app-icon name="pencil" />
        </button>
        @if (archived()) {
          <button
            class="btn btn-icon btn-sm row-restore"
            type="button"
            appTooltip="Zurückholen"
            [attr.aria-label]="'Kunde ' + client().name + ' zurückholen'"
            (click)="restore.emit($event)"
          >
            <app-icon name="restore" />
          </button>
        } @else {
          <button
            class="btn btn-icon btn-sm row-archive"
            type="button"
            appTooltip="Archivieren"
            [attr.aria-label]="'Kunde ' + client().name + ' archivieren'"
            (click)="archive.emit($event)"
          >
            <app-icon name="archive" />
          </button>
        }
      </td>
    }
  `,
})
export class ClientRow {
  readonly client = input.required<Client>();
  readonly editor = input<RowEditorState | null>(null);

  readonly edit = output<void>();
  readonly archive = output<Event>();
  /** Mit Ereignis: die Seite fuehrt danach den Fokus (siehe `archive`). */
  readonly restore = output<Event>();
  readonly editorEvent = output<RowEditorEvent>();

  protected readonly archived = computed(() => this.client().archivedAt !== null);
}
