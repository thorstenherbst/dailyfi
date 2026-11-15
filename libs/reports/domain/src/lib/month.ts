import { DayKey, addDays, instantToWall, toDayKey, wallToInstant } from '@lib/shared/util-time';

/** `YYYY-MM`. Wie `DayKey`: eine Zeichenkette, die sich sortieren laesst. */
export type MonthKey = string;

function partsOf(monthKey: MonthKey): { year: number; month: number } {
  const [year, month] = monthKey.split('-').map(Number);
  return { year, month };
}

export function toMonthKey(year: number, month: number): MonthKey {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function monthKeyOf(instant: Date): MonthKey {
  // Ueber die Wandzeit in Europe/Berlin, nicht ueber `getMonth()`: ein Eintrag
  // am 1. um 00:30 gehoert sonst auf einem Rechner in Sydney in den Vormonat.
  const { dayKey } = instantToWall(instant);
  return dayKey.slice(0, 7);
}

export function currentMonthKey(now: Date = new Date()): MonthKey {
  return monthKeyOf(now);
}

export function shiftMonth(monthKey: MonthKey, delta: number): MonthKey {
  const { year, month } = partsOf(monthKey);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return toMonthKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
}

export function firstDayOf(monthKey: MonthKey): DayKey {
  const { year, month } = partsOf(monthKey);
  return toDayKey(year, month, 1);
}

export function lastDayOf(monthKey: MonthKey): DayKey {
  return addDays(firstDayOf(shiftMonth(monthKey, 1)), -1);
}

/**
 * Der Monat als halboffener Zeitraum `[from, to)` in echten Zeitpunkten.
 *
 * Ueber `wallToInstant` und nicht ueber `new Date(year, month)`: die Grenze ist
 * Mitternacht in Europe/Berlin, unabhaengig von der Zeitzone des Rechners. Im
 * Maerz und Oktober ist der Monat ausserdem eine Stunde kuerzer oder laenger
 * als 30 × 24 h — das faellt hier von selbst richtig heraus.
 */
export function monthRange(monthKey: MonthKey): { from: Date; to: Date } {
  return {
    from: wallToInstant(firstDayOf(monthKey), 0),
    to: wallToInstant(firstDayOf(shiftMonth(monthKey, 1)), 0),
  };
}

/** `Oktober 2026` */
export function formatMonth(monthKey: MonthKey): string {
  const { year, month } = partsOf(monthKey);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `2026-10` — fuer Dateinamen, damit die Sortierung im Ordner stimmt. */
export function monthForFilename(monthKey: MonthKey): string {
  return monthKey;
}
