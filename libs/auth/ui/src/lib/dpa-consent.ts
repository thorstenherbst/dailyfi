import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  model,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { DPA_VERSION, DPA_VERSION_DATE, formatLegalDate } from '@lib/legal/domain';
import { Icon } from '@lib/shared/ui';

/**
 * Pflicht-Checkbox „Ich habe den AV-Vertrag … gelesen und stimme ihm zu" —
 * derselbe Wortlaut auf `/register` und `/zustimmung`. Version und Datum kommen
 * aus `legal/domain`, damit der Text nie eine andere Fassung nennt als die, der
 * zugestimmt wird.
 *
 * Das Label traegt nur den Satz. Ein Link im Label waere zugleich Klickziel
 * der Checkbox und wuerde als Teil ihres Namens vorgelesen. Die Links stehen
 * darunter, sind per `aria-describedby` mit der Checkbox verbunden und oeffnen
 * in einem neuen Tab: ein Wechsel auf `/avv` verwarf sonst, was auf
 * `/register` schon eingetragen ist.
 *
 * Den Fehlertext reicht die Seite herein. Er steht am Feld, solange der Haken
 * fehlt — wer ankreuzt, sieht ihn sofort nicht mehr.
 */
@Component({
  selector: 'app-dpa-consent',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  styleUrl: './dpa-consent.scss',
  template: `
    <div class="field">
      <label class="check" [for]="inputId()">
        <input
          #box
          type="checkbox"
          [id]="inputId()"
          name="dpa-consent"
          required
          [checked]="accepted()"
          [attr.aria-invalid]="shownError() ? 'true' : null"
          [attr.aria-describedby]="describedBy()"
          (change)="accepted.set(read($event))"
        />
        <span
          >Ich habe den AV-Vertrag (Version {{ version }} vom {{ date }}) gelesen und stimme ihm
          zu.</span
        >
      </label>
      <p class="hint links" [id]="inputId() + '-links'">
        <a routerLink="/avv" target="_blank" rel="noopener">AV-Vertrag lesen</a>
        <span aria-hidden="true">·</span>
        <a routerLink="/datenschutz" target="_blank" rel="noopener">Datenschutzerklärung</a>
        <span>(öffnen in neuem Tab)</span>
      </p>
      @if (shownError(); as message) {
        <p class="form-error" [id]="inputId() + '-error'" role="alert">
          <app-icon name="warn" /> {{ message }}
        </p>
      }
    </div>
  `,
})
export class DpaConsent {
  /** Kennung des Kontrollkaestchens; Fehler und Links heissen `<id>-error`, `<id>-links`. */
  readonly inputId = input('dpa-consent');
  readonly accepted = model(false);
  readonly error = input<string | null>(null);

  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  protected readonly version = DPA_VERSION;
  protected readonly date = formatLegalDate(DPA_VERSION_DATE);

  /** Mit Haken gibt es nichts mehr zu bemaengeln. */
  protected readonly shownError = computed(() => (this.accepted() ? null : this.error()));

  protected readonly describedBy = computed(() => {
    const links = `${this.inputId()}-links`;
    return this.shownError() ? `${this.inputId()}-error ${links}` : links;
  });

  /** Fuer die Seite: nach einem Absenden ohne Haken den Fokus hierher. */
  focus(): void {
    this.box().nativeElement.focus();
  }

  protected read(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
