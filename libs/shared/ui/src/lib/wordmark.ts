import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * „Dailyfi · Beta" — steht links im Seitenkopf jeder Seite (es gibt keine
 * eigene Kopfzeile mehr). Klassen `.wordmark`/`.beta` kommen aus der
 * Styles-Lib (`components/_pagehead.scss`).
 */
@Component({
  selector: 'app-wordmark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'wordmark' },
  template: `Dailyfi <span class="beta">Beta</span>`,
})
export class Wordmark {}
