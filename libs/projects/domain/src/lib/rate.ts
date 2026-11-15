/**
 * Stundensatz zwischen Eingabefeld und Datenbank.
 *
 * Ein deutscher Freelancer tippt „95,50" — mit Komma. `Number('95,50')` ist
 * `NaN`, und ohne diese Uebersetzung landete entweder eine Fehlermeldung oder,
 * schlimmer, ein falscher Betrag in der Rechnung. Beide Schreibweisen gehen.
 */
/**
 * Hoechster Satz: die Spalte ist `numeric(10, 2)` (initial_schema.sql), also
 * acht Stellen vor dem Komma. Darueber lehnte die Datenbank ab — hier gibt es
 * stattdessen eine Meldung am Feld.
 */
export const MAX_RATE = 99_999_999.99;

/** Warum ein Satz nicht geht: keine Zahl, negativ, zu gross. */
export type RateProblem = 'format' | 'negative' | 'too-large';

export type RateResult =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly problem: RateProblem };

export function parseRate(input: string): RateResult {
  // Nur ein Euro-Zeichen am Rand fliegt raus, und Leerzeichen nur aussen.
  // Alles wegzuraeumen war ein Fehler: aus „95€50" wurde „9550", also 9550 €
  // statt einer Fehlermeldung — ein stiller Falschbetrag in der Rechnung.
  const text = input.trim().replace(/^€/, '').replace(/€$/, '').trim();
  if (text === '') {
    // Leer ist erlaubt: nicht jedes Projekt wird nach Stunden abgerechnet.
    return { ok: true, value: null };
  }

  // Ein Minus vorne ist eine Zahl, nur eben keine erlaubte — eigene Meldung.
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1).trim() : text;

  // Tausenderpunkte nur, wenn es auch ein Dezimalkomma gibt („1.250,50").
  const normalized = unsigned.includes(',')
    ? unsigned.replace(/\./g, '').replace(',', '.')
    : unsigned;

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return { ok: false, problem: 'format' };
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return { ok: false, problem: 'format' };
  }
  if (negative && value > 0) {
    return { ok: false, problem: 'negative' };
  }
  if (value > MAX_RATE) {
    return { ok: false, problem: 'too-large' };
  }
  return { ok: true, value };
}

/** Betrag fuers Eingabefeld — deutsche Schreibweise, ohne Waehrungszeichen. */
export function formatRateInput(value: number | null): string {
  if (value === null) {
    return '';
  }
  return value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Betrag zum Anzeigen, mit Euro. */
export function formatRate(value: number | null): string {
  if (value === null) {
    return 'kein Satz';
  }
  return `${formatRateInput(value)} €/h`;
}
