import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { RowEditor, RowEditorEvent, RowEditorState } from './row-editor';

/**
 * Anlege-Leerzeile (Brief: „Leerzeile zum Anlegen am Ende jeder Kundengruppe,
 * eine für neue Kunden"). Eingeklappt nur ein Namensfeld mit Platzhalter; wer
 * hineintippt, beginnt die Anlage — dann klappt die Zeile auf (Farbe, Satz,
 * Speichern), und zwar um **dasselbe** Feld herum: der Fokus und das schon
 * Getippte bleiben, wo sie sind. Hat eine andere Zeile Ungespeichertes, bleibt
 * sie eingeklappt, und das Getippte bleibt einfach im Feld stehen, bis sie
 * aufgeht (die Seite entscheidet das).
 */
@Component({
  selector: 'tr[app-new-row]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RowEditor],
  styleUrl: './rows.scss',
  host: {
    class: 'new-row',
    '[class.editing]': 'editor() !== null',
    '[attr.data-row]': 'rowKey()',
  },
  template: `
    <td colspan="4" class="editing-cell">
      <app-row-editor
        [kind]="kind()"
        [nameLabel]="label()"
        [placeholder]="label() + ' …'"
        [state]="editor()"
        (event)="editorEvent.emit($event)"
      />
    </td>
  `,
})
export class NewRow {
  readonly kind = input.required<'project' | 'client'>();
  /** „Neues Projekt für Kessler Haustechnik" bzw. „Neuer Kunde". */
  readonly label = input.required<string>();
  /** Kennung fuer die Fokusfuehrung der Seite (`data-row`). */
  readonly rowKey = input.required<string>();
  readonly editor = input<RowEditorState | null>(null);

  readonly editorEvent = output<RowEditorEvent>();

}
