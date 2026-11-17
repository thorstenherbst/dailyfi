import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PROVIDER } from '@lib/legal/domain';

import { LegalLayout } from './legal-layout';
import { ProviderField } from './provider-field';

/**
 * Impressum nach § 5 DDG fuer ein Einzelunternehmen. Kein Link auf die
 * EU-Plattform zur Online-Streitbeilegung: die Plattform ist eingestellt, die
 * Pflicht dazu entfallen. Der Hinweis nach § 36 VSBG steht freiwillig da.
 */
@Component({
  selector: 'app-imprint-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LegalLayout, ProviderField, RouterLink],
  template: `
    <app-legal-layout heading="Impressum">
      <h2>Angaben gemäß § 5 DDG</h2>
      <address>
        @if (provider.company) {
          <app-provider-field [value]="provider.company" /><br />
          Inhaber:
        }
        <app-provider-field [value]="provider.name" /><br />
        <app-provider-field [value]="provider.street" /><br />
        <app-provider-field [value]="provider.city" /><br />
        Deutschland
      </address>

      <h2>Kontakt</h2>
      <dl>
        <dt>E-Mail</dt>
        <dd><app-provider-field [value]="provider.email" link="mail" /></dd>
        @if (provider.phone) {
          <dt>Telefon</dt>
          <dd><app-provider-field [value]="provider.phone" link="tel" /></dd>
        }
      </dl>

      <h2>Umsatzsteuer</h2>
      <p><app-provider-field [value]="provider.vatId" /></p>

      <h2>Verbraucherstreitbeilegung</h2>
      <p>
        Der Anbieter ist nicht verpflichtet und nicht bereit, an einem Streitbeilegungsverfahren vor
        einer Verbraucherschlichtungsstelle teilzunehmen.
      </p>

      <h2>Datenschutz</h2>
      <p>
        Wie Dailyfi mit personenbezogenen Daten umgeht, steht in der
        <a routerLink="/datenschutz">Datenschutzerklärung</a>. Für Daten Dritter, die Sie in Dailyfi
        eintragen, gilt der <a routerLink="/avv">Vertrag zur Auftragsverarbeitung</a>.
      </p>
    </app-legal-layout>
  `,
})
export class ImprintPage {
  protected readonly provider = PROVIDER;
}
