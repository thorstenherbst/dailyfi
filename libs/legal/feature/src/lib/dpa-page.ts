import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  DPA_VERSION,
  DPA_VERSION_DATE,
  PROVIDER,
  SUBPROCESSORS,
  formatLegalDate,
} from '@lib/legal/domain';

import { LegalLayout } from './legal-layout';
import { ProviderField } from './provider-field';

/**
 * Vertrag zur Auftragsverarbeitung nach Art. 28 Abs. 3 DSGVO. Version und
 * Datum stehen oben und kommen aus `legal/domain` — an `DPA_VERSION` haengt die
 * Zustimmung im Konto. Jede inhaltliche Aenderung hier braucht eine neue
 * Version.
 *
 * Anlage 1 (TOM) beschreibt nur, was tatsaechlich umgesetzt ist.
 */
@Component({
  selector: 'app-dpa-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LegalLayout, ProviderField, RouterLink],
  templateUrl: './dpa-page.html',
})
export class DpaPage {
  protected readonly provider = PROVIDER;
  protected readonly subprocessors = SUBPROCESSORS;
  protected readonly meta = `Version ${DPA_VERSION} vom ${formatLegalDate(DPA_VERSION_DATE)}`;
}
