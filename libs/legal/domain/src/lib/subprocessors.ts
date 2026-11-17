/**
 * Dienstleister, die Daten im Auftrag verarbeiten. Dieselbe Liste steht in der
 * Datenschutzerklaerung (Empfaenger) und in Anlage 2 des AV-Vertrags — eine
 * Aenderung hier ist eine Aenderung an beiden und braucht eine neue
 * `DPA_VERSION`.
 */
export interface Subprocessor {
  readonly name: string;
  readonly seat: string;
  readonly service: string;
  /** Wo die Daten liegen bzw. verarbeitet werden. */
  readonly location: string;
  /** Grundlage fuer die Uebermittlung in ein Drittland. */
  readonly transferBasis: string;
}

export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: 'Supabase Pte. Ltd.',
    seat: 'Singapur',
    service: 'Datenbank, Anmeldung und Versand der Anmelde-Mails (Hosting der gespeicherten Daten)',
    location:
      'Datenbank in Frankfurt am Main (Rechenzentrumsregion eu-central-1); Zugriffe aus ' +
      'Singapur und den USA sind möglich',
    transferBasis: 'EU-Standardvertragsklauseln (Durchführungsbeschluss (EU) 2021/914)',
  },
  {
    name: 'Vercel Inc.',
    seat: 'USA',
    service: 'Auslieferung der Anwendung über ein Content Delivery Network (CDN)',
    location: 'weltweites Auslieferungsnetz, Sitz des Unternehmens in den USA',
    transferBasis:
      'Angemessenheitsbeschluss zum EU-U.S. Data Privacy Framework (Vercel ist zertifiziert), ' +
      'zusätzlich EU-Standardvertragsklauseln',
  },
];
