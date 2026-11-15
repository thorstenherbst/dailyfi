/**
 * Zeitrechnung des Wochenrasters — bewusst ohne Bibliothek und ohne Angular.
 *
 * Zwei Zeitbegriffe, die konsequent getrennt bleiben:
 *
 *  - **Wandzeit**: ein Tag (`DayKey`, `YYYY-MM-DD`) plus Minuten seit Mitternacht.
 *    Das ist, was der Nutzer im Raster sieht, und was die Pixelrechnung benutzt.
 *  - **Zeitpunkt**: ein echter `Date` (UTC-Instant). Das ist, was in `time_entries`
 *    steht (`timestamptz`).
 *
 * Dazwischen steht immer Europe/Berlin. Die Umrechnung laeuft ueber
 * `Intl.DateTimeFormat`, damit die Zeitzone des Rechners egal ist und die
 * Sommerzeitwechsel stimmen. Dauer wird immer aus Zeitpunkten gerechnet, nie aus
 * Wandzeit-Differenzen: am 25.10. ist 01:00–03:00 drei Stunden lang, nicht zwei.
 */

export const TIME_ZONE = 'Europe/Berlin';

/** Hoehe einer Rasterstunde in Pixeln (gleich `hour-h` in `$layout`, shared/styles). */
export const HOUR_HEIGHT_PX = 60;

/**
 * Breite der Stundenachse links im Raster (`axis-w`, gleich
 * `$layout` in shared/styles). Die Zeigergeometrie zieht sie von der Rasterbreite
 * ab. Ein Test (`grid-geometry.spec.ts`) haelt beide Werte mit den SCSS-Tokens
 * deckungsgleich.
 */
export const AXIS_WIDTH_PX = 72;

/** Das Raster rastet auf Viertelstunden ein. */
export const SNAP_MINUTES = 15;

export const MINUTES_PER_DAY = 24 * 60;

/** Kuerzer als eine Viertelstunde laesst sich ein Block nicht ziehen. */
export const MIN_DURATION_MINUTES = 15;

/** Ein Kalendertag als `YYYY-MM-DD`. */
export type DayKey = string;

/** Ein Block im Raster: an welchem Tag, von wann bis wann (Wandzeit). */
export interface Placement {
  readonly dayKey: DayKey;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

const zoneParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallOf(instant: Date): Wall {
  const parts = zoneParts.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Abstand der Zonenzeit zu UTC zu genau diesem Zeitpunkt, in Millisekunden. */
function zoneOffsetMs(instant: Date): number {
  const w = wallOf(instant);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - instant.getTime();
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function toDayKey(year: number, month: number, day: number): DayKey {
  return `${year}-${pad(month)}-${pad(day)}`;
}

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Ein kaputter Tagesschluessel darf nicht stillschweigend zu einem Zeitpunkt
 * werden: `Date.UTC(0, …)` liefert das Jahr 1900, und solche Eintraege
 * verfaelschen die Wochensumme, bis jemand neu laedt. Lieber laut scheitern —
 * der Store faengt das ab und zeigt einen deutschen Text.
 */
function partsOfDayKey(dayKey: DayKey): { year: number; month: number; day: number } {
  const match = DAY_KEY_PATTERN.exec(dayKey);
  if (!match) {
    throw new RangeError(`Ungueltiger Tagesschluessel: "${dayKey}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError(`Diesen Tag gibt es nicht: "${dayKey}"`);
  }
  return { year, month, day };
}

/** Wandzeit eines Zeitpunkts als vergleichbare Zahl (naiv als UTC gelesen). */
function wallSortKey(instant: Date): number {
  const w = wallOf(instant);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/**
 * Kleinster Zeitpunkt, dessen Wandzeit nicht mehr vor der gesuchten liegt.
 * Nur noetig, wenn eine Wandzeit gar nicht existiert; dann liegt in den
 * gesuchten 52 Stunden genau ein Sprung nach vorn und die Wandzeit waechst
 * darin streng monoton, die Suche ist also eindeutig.
 */
function firstInstantNotBefore(wallTarget: number, aroundUtc: number): number {
  let low = aroundUtc - 26 * 3_600_000;
  let high = aroundUtc + 26 * 3_600_000;
  while (high - low > 1) {
    const mid = low + Math.floor((high - low) / 2);
    if (wallSortKey(new Date(mid)) < wallTarget) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return high;
}

/**
 * Wandzeit → Zeitpunkt. Zweistufig, weil der erste Offset noch aus der falschen
 * Seite eines Zeitumstellungs-Wochenendes stammen kann.
 *
 * Uhrzeiten, die es nicht gibt (29.03., 02:30), fallen auf den ersten Zeitpunkt
 * zusammen, den es an diesem Tag wieder gibt. Das ist Absicht: die Luecke hat
 * null reale Dauer, und nur so bleibt die Abbildung ueber den ganzen Tag
 * monoton. Rollte man die Luecke stattdessen hinter den Sprung, laege 02:45
 * spaeter als 03:15 — ein Block 02:45–03:15 haette negative Dauer und liesse
 * sich nicht speichern.
 */
export function wallToInstant(dayKey: DayKey, minutes: number): Date {
  const { year, month, day } = partsOfDayKey(dayKey);
  const naiveUtc = Date.UTC(year, month - 1, day, 0, minutes);
  const firstGuess = naiveUtc - zoneOffsetMs(new Date(naiveUtc));
  const corrected = new Date(naiveUtc - zoneOffsetMs(new Date(firstGuess)));

  if (wallSortKey(corrected) === naiveUtc) {
    return corrected;
  }
  return new Date(firstInstantNotBefore(naiveUtc, naiveUtc));
}

/** Reale Laenge eines Kalendertages in Minuten: 1380, 1440 oder 1500. */
export function dayLengthMinutes(dayKey: DayKey): number {
  return (
    (wallToInstant(addDays(dayKey, 1), 0).getTime() - wallToInstant(dayKey, 0).getTime()) / 60_000
  );
}

/** Der Tag der Woche, an dem die Uhr umgestellt wird — sonst `null`. */
export function dstDayOfWeek(mondayKey: DayKey): { dayKey: DayKey; hours: number } | null {
  for (const dayKey of weekDayKeys(mondayKey)) {
    const hours = dayLengthMinutes(dayKey) / 60;
    if (hours !== 24) {
      return { dayKey, hours };
    }
  }
  return null;
}

/** Zeitpunkt → Wandzeit in Europe/Berlin. */
export function instantToWall(instant: Date): { dayKey: DayKey; minutes: number } {
  const w = wallOf(instant);
  return { dayKey: toDayKey(w.year, w.month, w.day), minutes: w.hour * 60 + w.minute };
}

/** Der Tag, auf den ein Zeitpunkt in Europe/Berlin faellt. */
export function dayKeyOf(instant: Date): DayKey {
  return instantToWall(instant).dayKey;
}

/** Kalendertage addieren — nicht Millisekunden, sonst verrutscht der Umstelltag. */
export function addDays(dayKey: DayKey, amount: number): DayKey {
  const { year, month, day } = partsOfDayKey(dayKey);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount));
  return toDayKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Wochentag, 0 = Montag … 6 = Sonntag. Die Woche beginnt Montag. */
export function weekdayIndex(dayKey: DayKey): number {
  const { year, month, day } = partsOfDayKey(dayKey);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** Montag der Woche, in der dieser Tag liegt. */
export function startOfWeek(dayKey: DayKey): DayKey {
  return addDays(dayKey, -weekdayIndex(dayKey));
}

/** Die sieben Tage Montag bis Sonntag ab diesem Montag. */
export function weekDayKeys(mondayKey: DayKey): DayKey[] {
  return Array.from({ length: 7 }, (_, index) => addDays(mondayKey, index));
}

/** Kalenderwoche nach ISO 8601 (die Woche mit dem ersten Donnerstag des Jahres). */
export function isoWeekNumber(dayKey: DayKey): number {
  const { year, month, day } = partsOfDayKey(dayKey);
  const target = new Date(Date.UTC(year, month - 1, day));
  target.setUTCDate(target.getUTCDate() - ((target.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

/** Heute in Europe/Berlin — nicht in der Zeitzone des Rechners. */
export function todayKey(now: Date = new Date()): DayKey {
  return dayKeyOf(now);
}

/* -- Pixel -------------------------------------------------------------- */

export function minutesToPx(minutes: number): number {
  return (minutes / 60) * HOUR_HEIGHT_PX;
}

export function pxToMinutes(px: number): number {
  return (px / HOUR_HEIGHT_PX) * 60;
}

/** Auf die naechste Viertelstunde runden. */
export function snapToQuarter(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

/** Pixelposition im Raster → eingerastete Minute des Tages. */
export function pxToSnappedMinutes(px: number): number {
  return clampMinutes(snapToQuarter(pxToMinutes(px)));
}

export function clampMinutes(minutes: number): number {
  return Math.min(MINUTES_PER_DAY, Math.max(0, minutes));
}

/* -- Blockgeometrie ------------------------------------------------------ */

/** Zwei Zeitpunkte aus einem Zug → gueltiger Block, mindestens eine Viertelstunde. */
export function placementFromDrag(
  dayKey: DayKey,
  anchorMinutes: number,
  cursorMinutes: number,
): Placement {
  const a = clampMinutes(snapToQuarter(anchorMinutes));
  const b = clampMinutes(snapToQuarter(cursorMinutes));
  let start = Math.min(a, b);
  let end = Math.max(a, b);
  if (end - start < MIN_DURATION_MINUTES) {
    end = start + MIN_DURATION_MINUTES;
    if (end > MINUTES_PER_DAY) {
      end = MINUTES_PER_DAY;
      start = end - MIN_DURATION_MINUTES;
    }
  }
  return { dayKey, startMinutes: start, endMinutes: end };
}

/** Verschieben: Dauer bleibt, der Block bleibt im Tag. */
export function movePlacement(placement: Placement, deltaMinutes: number): Placement {
  const duration = placement.endMinutes - placement.startMinutes;
  const start = Math.min(
    MINUTES_PER_DAY - duration,
    Math.max(0, placement.startMinutes + deltaMinutes),
  );
  return { ...placement, startMinutes: start, endMinutes: start + duration };
}

/** Dauer aendern: die Unterkante wandert, Minimum eine Viertelstunde. */
export function resizePlacement(placement: Placement, deltaMinutes: number): Placement {
  const end = Math.min(
    MINUTES_PER_DAY,
    Math.max(placement.startMinutes + MIN_DURATION_MINUTES, placement.endMinutes + deltaMinutes),
  );
  return { ...placement, endMinutes: end };
}

/** Oberkante ziehen: der Beginn wandert, das Ende bleibt. */
export function resizeStart(placement: Placement, newStartMinutes: number): Placement {
  const start = Math.max(0, Math.min(placement.endMinutes - MIN_DURATION_MINUTES, newStartMinutes));
  return { ...placement, startMinutes: start };
}

/** Unterkante ziehen: das Ende wandert, der Beginn bleibt. */
export function resizeEnd(placement: Placement, newEndMinutes: number): Placement {
  const end = Math.min(
    MINUTES_PER_DAY,
    Math.max(placement.startMinutes + MIN_DURATION_MINUTES, newEndMinutes),
  );
  return { ...placement, endMinutes: end };
}

/** Tag wechseln, Uhrzeit behalten. */
export function shiftDay(placement: Placement, deltaDays: number): Placement {
  return { ...placement, dayKey: addDays(placement.dayKey, deltaDays) };
}

/** Haben sich Tag, Beginn und Ende gar nicht geaendert? */
export function samePlacement(a: Placement, b: Placement): boolean {
  return (
    a.dayKey === b.dayKey && a.startMinutes === b.startMinutes && a.endMinutes === b.endMinutes
  );
}

/* -- Summen -------------------------------------------------------------- */

/**
 * Dauer in Stunden aus zwei Zeitpunkten. Ueber Instants gerechnet, damit ein
 * Block ueber die Zeitumstellung die real gearbeiteten Stunden ergibt.
 */
export function durationHours(startedAt: Date, endedAt: Date): number {
  return (endedAt.getTime() - startedAt.getTime()) / 3_600_000;
}

export function sumHours(entries: ReadonlyArray<{ startedAt: Date; endedAt: Date }>): number {
  return entries.reduce((total, entry) => total + durationHours(entry.startedAt, entry.endedAt), 0);
}

/** Stunden deutsch mit genau zwei Nachkommastellen: `31,25`. */
export function formatHours(hours: number): string {
  return hours.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Dauer als abrechenbare Stundenzahl: `2,50 h`. */
export function formatDuration(hours: number): string {
  return `${formatHours(hours)} h`;
}

/* -- Beschriftung -------------------------------------------------------- */

/** `09:15` — fuer Achse, Blocktext und Zeitfelder im Dialog. */
export function formatClock(minutes: number): string {
  const total = clampMinutes(Math.round(minutes));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** `9:15` — gesprochene Form fuer die Live-Region. */
function spokenClock(minutes: number): string {
  const total = clampMinutes(Math.round(minutes));
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

const weekdayLong = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'long' });
const weekdayShort = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'short' });
const dayMonth = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
});
const dayMonthYear = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function utcDateOf(dayKey: DayKey): Date {
  const { year, month, day } = partsOfDayKey(dayKey);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatWeekdayLong(dayKey: DayKey): string {
  return weekdayLong.format(utcDateOf(dayKey));
}

/** `Mo 14.` fuer die Kopfzeile des Rasters. */
export function formatColumnHeader(dayKey: DayKey): string {
  const date = utcDateOf(dayKey);
  return `${weekdayShort.format(date).replace('.', '')} ${date.getUTCDate()}.`;
}

/** `14.–20. September 2026` — bzw. mit beiden Monaten, wenn die Woche umbricht. */
export function formatWeekRange(mondayKey: DayKey): string {
  const sundayKey = addDays(mondayKey, 6);
  const monday = utcDateOf(mondayKey);
  const sunday = utcDateOf(sundayKey);
  if (
    monday.getUTCMonth() === sunday.getUTCMonth() &&
    monday.getUTCFullYear() === sunday.getUTCFullYear()
  ) {
    return `${monday.getUTCDate()}.–${dayMonthYear.format(sunday)}`;
  }
  return `${dayMonth.format(monday)} – ${dayMonthYear.format(sunday)}`;
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mär',
  'Apr',
  'Mai',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dez',
];

/**
 * Kurze Wochenspanne fuer den Seitenkopf (Brief: „KW 45 · 2.–8. Nov").
 *
 * - im selben Monat: `2.–8. Nov`
 * - ueber einen Monatswechsel: `30. Nov – 6. Dez`
 * - Das Jahr steht nur, wenn es nicht das aktuelle ist — an der Seite der
 *   Spanne, zu der es gehoert: `29. Dez – 4. Jan 2027` (heute 2026),
 *   `29. Dez 2025 – 4. Jan` (heute 2026), `2.–8. Nov 2025`.
 */
export function formatWeekRangeShort(mondayKey: DayKey, today: DayKey = todayKey()): string {
  const currentYear = partsOfDayKey(today).year;
  const start = partsOfDayKey(mondayKey);
  const end = partsOfDayKey(addDays(mondayKey, 6));
  const year = (value: number): string => (value === currentYear ? '' : ` ${value}`);

  if (start.year === end.year && start.month === end.month) {
    return `${start.day}.–${end.day}. ${MONTHS_SHORT[end.month - 1]}${year(end.year)}`;
  }
  const startYear = start.year !== end.year ? year(start.year) : '';
  return (
    `${start.day}. ${MONTHS_SHORT[start.month - 1]}${startYear} – ` +
    `${end.day}. ${MONTHS_SHORT[end.month - 1]}${year(end.year)}`
  );
}

/** Ansage fuer die Live-Region: „Relaunch, Dienstag 9:15 bis 11:00". */
export function describePlacement(projectName: string, placement: Placement): string {
  return (
    `${projectName}, ${formatWeekdayLong(placement.dayKey)} ` +
    `${spokenClock(placement.startMinutes)} bis ${spokenClock(placement.endMinutes)}`
  );
}

/* -- Ueberlappungen ------------------------------------------------------ */

export interface Laned<T> {
  readonly item: T;
  /** Spalte innerhalb der Ueberlappungsgruppe, 0-basiert. */
  readonly lane: number;
  /** Wie viele Spalten die Gruppe breit ist. */
  readonly lanes: number;
}

/**
 * Ueberlappende Eintraege nebeneinander legen
 * (Ueberlappungen sind erlaubt). Gruppen werden aus zusammenhaengenden Ketten
 * gebildet; innerhalb einer Gruppe bekommt jeder Block die erste freie Spalte.
 */
export function assignLanes<T extends { startMinutes: number; endMinutes: number }>(
  items: readonly T[],
): Array<Laned<T>> {
  const sorted = [...items].sort(
    (a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes,
  );

  const result: Array<Laned<T>> = [];
  let group: Array<{ item: T; lane: number }> = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;

  const flush = (): void => {
    const lanes = Math.max(1, laneEnds.length);
    for (const placed of group) {
      result.push({ item: placed.item, lane: placed.lane, lanes });
    }
    group = [];
    laneEnds = [];
    groupEnd = -1;
  };

  for (const item of sorted) {
    if (group.length > 0 && item.startMinutes >= groupEnd) {
      flush();
    }
    let lane = laneEnds.findIndex((end) => end <= item.startMinutes);
    if (lane === -1) {
      lane = laneEnds.length;
    }
    laneEnds[lane] = item.endMinutes;
    groupEnd = Math.max(groupEnd, item.endMinutes);
    group.push({ item, lane });
  }
  if (group.length > 0) {
    flush();
  }

  return result;
}
