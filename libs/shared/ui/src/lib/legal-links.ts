import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * „Impressum · Datenschutz · AV-Vertrag". Steht unter der Auth-Karte und auf
 * jeder Rechtsseite; die Statusleiste hat nur einen Link „Rechtliches", sonst
 * reicht ihr Platz bei 1024 px nicht. Die aktuelle Seite traegt
 * `aria-current="page"`. Schriftgroesse und Farbe erbt die Liste vom Ort, an
 * dem sie steht.
 */
@Component({
  selector: 'app-legal-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  styleUrl: './legal-links.scss',
  template: `
    <nav aria-label="Rechtliches">
      <ul>
        @for (link of links; track link.path) {
          <li>
            <a [routerLink]="link.path" routerLinkActive="is-current" ariaCurrentWhenActive="page">
              {{ link.label }}
            </a>
          </li>
        }
      </ul>
    </nav>
  `,
})
export class LegalLinks {
  protected readonly links = [
    { path: '/impressum', label: 'Impressum' },
    { path: '/datenschutz', label: 'Datenschutz' },
    { path: '/avv', label: 'AV-Vertrag' },
  ] as const;
}
