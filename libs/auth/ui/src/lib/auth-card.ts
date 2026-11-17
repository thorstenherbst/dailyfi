import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { LegalLinks, Wordmark } from '@lib/shared/ui';

/**
 * Die schmale zentrierte Karte. Traegt die `h1` der Seite,
 * damit jede Auth-Seite genau eine Ueberschrift hat und nicht jede Seite ihre
 * eigene Variante der Karte baut. Die Wortmarke steht oben in der Karte — auf
 * diesen Seiten gibt es weder Menue noch Statusleiste. Darum stehen auch die
 * Links zu den Rechtstexten hier, unter der Karte.
 */
@Component({
  selector: 'app-auth-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LegalLinks, Wordmark],
  styleUrl: './auth-card.scss',
  template: `
    <section aria-labelledby="auth-heading">
      <app-wordmark />
      <h1 id="auth-heading">{{ heading() }}</h1>
      @if (lead(); as text) {
        <p class="lead">{{ text }}</p>
      }
      <ng-content />
    </section>
    <app-legal-links class="legal" />
  `,
})
export class AuthCard {
  readonly heading = input.required<string>();
  readonly lead = input<string | null>(null);
}
