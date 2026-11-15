import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

import { Icon, IconName } from './icon';

let nextId = 0;

/**
 * Warn-Modal vor einem Schritt, der sich nicht zuruecknehmen laesst
 * („Eintrag löschen?"). Eins von genau zwei Modals.
 *
 * - Natives `<dialog>` mit `showModal()`: Fokusfalle und Esc kommen vom
 *   Browser. Esc bricht ab.
 * - Erstfokus auf „Abbrechen": wer Enter drueckt, ohne zu lesen, loescht nichts.
 * - Danach geht der Fokus an den Ausloeser zurueck, sofern es ihn noch gibt.
 *   Gibt es ihn nicht mehr (der geloeschte Block), setzt die Seite ihn selbst.
 *
 * Titel und Knopf kommen von aussen: „Löschen" auf einem Knopf, der
 * archiviert, waere gelogen. `null` als `message` heisst: geschlossen.
 */
@Component({
  selector: 'app-warn-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <dialog
      #dialog
      class="modal"
      role="alertdialog"
      [attr.aria-labelledby]="id + '-title'"
      [attr.aria-describedby]="id + '-text'"
      (close)="onNativeClose()"
    >
      <div class="modal-icon is-danger"><app-icon name="warn" /></div>
      <h2 class="modal-title" [id]="id + '-title'">{{ heading() }}</h2>
      <p class="modal-text" [id]="id + '-text'">
        @if (subject(); as bold) {
          <b>{{ bold }}</b
          ><br />
        }
        {{ message() }}
      </p>
      <div class="modal-actions">
        <button #cancel class="btn btn-secondary" type="button" (click)="cancelled.emit()">
          Abbrechen
        </button>
        <button class="btn btn-danger" type="button" (click)="confirmed.emit()">
          @if (confirmIcon(); as icon) {
            <app-icon [name]="icon" />
          }
          {{ confirmLabel() }}
        </button>
      </div>
    </dialog>
  `,
})
export class WarnDialog {
  /** Null bedeutet: geschlossen. */
  readonly message = input<string | null>(null);
  /** Fett vor dem Text: was genau betroffen ist. */
  readonly subject = input<string | null>(null);
  readonly heading = input('Eintrag löschen?');
  readonly confirmLabel = input('Löschen');
  /** Papierkorb fuers Loeschen; `null`, wo nichts geloescht wird. */
  readonly confirmIcon = input<IconName | null>('trash');
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  protected readonly id = `warn-dialog-${++nextId}`;

  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly cancelRef = viewChild.required<ElementRef<HTMLButtonElement>>('cancel');
  private closing = false;
  private opener: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const message = this.message();
      const dialog = this.dialogRef().nativeElement;

      if (message === null) {
        if (dialog.open) {
          this.closing = true;
          dialog.close();
          this.closing = false;
        }
        // Auch nach Esc: dann hat der Browser schon geschlossen.
        this.returnFocus();
        return;
      }

      if (!dialog.open) {
        const active = document.activeElement;
        this.opener = active instanceof HTMLElement && active !== document.body ? active : null;
        dialog.showModal();
        this.cancelRef().nativeElement.focus();
      }
    });
  }

  /** Esc (oder ein anderes Schliessen von aussen) heisst Abbrechen. */
  protected onNativeClose(): void {
    if (!this.closing && this.message() !== null) {
      this.cancelled.emit();
    }
  }

  private returnFocus(): void {
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) {
      opener.focus();
    }
  }
}
