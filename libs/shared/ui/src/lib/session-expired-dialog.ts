import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

import { Icon } from './icon';

/**
 * Modal „Sitzung abgelaufen". Das zweite und
 * letzte Modal der Anwendung.
 *
 * Mit Absicht ohne Schliessen-X und ohne Abbrechen: hinter dem Modal geht
 * nichts mehr, jeder Klick dort scheiterte am Server. Esc schliesst deshalb
 * nicht (Brief), tut aber auch nicht nichts: der Fokus springt auf
 * „Neu anmelden", den einzigen Weg weiter.
 *
 * Chrome laesst ein zweites Esc ohne Nutzeraktivierung dazwischen trotz
 * `preventDefault()` durch (Close-Watcher-Schutz): `cancel` kommt dann mit
 * `cancelable === false`, der Dialog schliesst, und ein `close`-Ereignis kam
 * im Test nicht verlaesslich an. Darum oeffnet er sich nach so einem `cancel`
 * selbst wieder — und zur Sicherheit auch nach jedem ungewollten `close`.
 *
 * Ein einziger Anmeldeweg: „Neu anmelden" fuehrt nach `/login`, ein
 * E-Mail-Feld im Modal gibt es bewusst nicht.
 * Erstfokus liegt auf „Neu anmelden"; `role="alertdialog"`, weil der Dialog
 * eine Unterbrechung meldet, die eine Antwort verlangt.
 *
 * Kennt weder Auth noch Router: die Shell zeigt ihn und hoert auf `relogin`.
 */
@Component({
  selector: 'app-session-expired-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <dialog
      #dialog
      class="modal"
      role="alertdialog"
      aria-labelledby="session-expired-title"
      aria-describedby="session-expired-text"
      (cancel)="onCancel($event)"
      (close)="onNativeClose()"
    >
      <div class="modal-icon is-info"><app-icon name="lock" /></div>
      <h2 class="modal-title" id="session-expired-title">Sitzung abgelaufen</h2>
      <p class="modal-text" id="session-expired-text">
        Melde dich neu an, um weiterzuarbeiten. Was schon gespeichert ist, bleibt erhalten.
      </p>
      <div class="modal-actions">
        <button #relogin class="btn btn-primary" type="button" (click)="onRelogin()">
          Neu anmelden
        </button>
      </div>
    </dialog>
  `,
})
export class SessionExpiredDialog {
  readonly open = input(false);
  readonly relogin = output<void>();

  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly reloginRef = viewChild.required<ElementRef<HTMLButtonElement>>('relogin');
  private closing = false;

  constructor() {
    effect(() => {
      const dialog = this.dialogRef().nativeElement;
      if (this.open()) {
        if (!dialog.open) {
          this.show();
        }
      } else if (dialog.open) {
        this.closing = true;
        dialog.close();
        this.closing = false;
      }
    });
  }

  protected onCancel(event: Event): void {
    event.preventDefault();
    if (event.cancelable) {
      this.reloginRef().nativeElement.focus();
      return;
    }
    // Nicht aufzuhalten: nach dem Schliessen gleich wieder oeffnen.
    setTimeout(() => this.reopenIfNeeded());
  }

  protected onNativeClose(): void {
    this.reopenIfNeeded();
  }

  private reopenIfNeeded(): void {
    if (!this.closing && this.open() && !this.dialogRef().nativeElement.open) {
      this.show();
    }
  }

  protected onRelogin(): void {
    this.relogin.emit();
  }

  private show(): void {
    this.dialogRef().nativeElement.showModal();
    this.reloginRef().nativeElement.focus();
  }
}
