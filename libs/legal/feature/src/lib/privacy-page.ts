import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PRIVACY_POLICY_DATE, PROVIDER, SUBPROCESSORS, formatLegalDate } from '@lib/legal/domain';

import { LegalLayout } from './legal-layout';
import { ProviderField } from './provider-field';

/**
 * Datenschutzerklaerung nach Art. 13 DSGVO. Beschreibt, was die Anwendung
 * tatsaechlich speichert und an wen es geht — aendert sich das Datenmodell,
 * ein Dienstleister oder die Speicherung im Browser, muss dieser Text mit.
 */
@Component({
  selector: 'app-privacy-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LegalLayout, ProviderField, RouterLink],
  templateUrl: './privacy-page.html',
})
export class PrivacyPage {
  protected readonly provider = PROVIDER;
  protected readonly subprocessors = SUBPROCESSORS;
  protected readonly meta = `Stand: ${formatLegalDate(PRIVACY_POLICY_DATE)}`;
}
