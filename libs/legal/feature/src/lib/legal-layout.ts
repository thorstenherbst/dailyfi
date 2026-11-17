import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Icon, LegalLinks, Wordmark } from '@lib/shared/ui';

/**
 * Rahmen der drei Rechtstexte: Seitenkopf mit Wortmarke und Rueckweg, darunter
 * eine Lesespalte (`.prose` aus der Styles-Lib) mit der `h1` und einer
 * Zeile fuer Stand oder Version. Im Fuss die drei Rechtstexte, die aktuelle
 * Seite markiert.
 *
 * Der Rueckweg fuehrt nach `/`: angemeldet landet man in der Woche, abgemeldet
 * schickt der Guard zur Anmeldung.
 */
@Component({
  selector: 'app-legal-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, LegalLinks, RouterLink, Wordmark],
  styleUrl: './legal-layout.scss',
  template: `
    <header class="pagehead">
      <app-wordmark />
      <a class="back" routerLink="/"><app-icon name="left" />Zurück zu Dailyfi</a>
    </header>
    <article class="prose" aria-labelledby="legal-heading">
      <h1 id="legal-heading" tabindex="-1">{{ heading() }}</h1>
      @if (meta(); as text) {
        <p class="prose-meta">{{ text }}</p>
      }
      <ng-content />
    </article>
    <footer>
      <app-legal-links />
    </footer>
  `,
})
export class LegalLayout {
  readonly heading = input.required<string>();
  /** „Stand: …" oder „Version …" unter der Ueberschrift. */
  readonly meta = input<string | null>(null);
}
