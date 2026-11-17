/**
 * Fassungen der Rechtstexte. Eine neue Fassung des AV-Vertrags heisst: neue
 * Version **und** neues Datum. Die Zustimmung im Konto haengt an `DPA_VERSION`;
 * wer einer aelteren Version zugestimmt hat, wird erneut gefragt.
 *
 * Daten als ISO-Datum (`JJJJ-MM-TT`), angezeigt ueber `formatLegalDate`.
 */
export const DPA_VERSION = '1.0';
export const DPA_VERSION_DATE = '2026-11-17';

/** Stand der Datenschutzerklaerung. */
export const PRIVACY_POLICY_DATE = '2026-11-17';

const FORMAT = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  // Ein Kalendertag, kein Zeitpunkt: in UTC lesen und ausgeben, sonst rutscht
  // er westlich von Greenwich auf den Vortag.
  timeZone: 'UTC',
});

/** `2026-11-17` → „17. November 2026". */
export function formatLegalDate(isoDate: string): string {
  return FORMAT.format(new Date(`${isoDate}T00:00:00Z`));
}
