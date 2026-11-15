import { durationHours, formatClock, instantToWall } from '@lib/shared/util-time';

import { MonthKey, monthForFilename } from './month';
import { ReportEntry } from './report-model';

/**
 * Trennzeichen **Semikolon**, nicht Komma.
 *
 * Die Datei ist fuer Excel in einer deutschen Einstellung gedacht, und dort ist
 * das Semikolon das Listentrennzeichen. Mit Komma landet jede Zeile in einer
 * einzigen Spalte — und weil die Zahlen hier ein Dezimalkomma tragen, waere ein
 * Komma als Trenner ohnehin nicht zu gebrauchen.
 */
const DELIMITER = ';';

/** CRLF: Excel erwartet es, alles andere kommt damit auch zurecht. */
const NEWLINE = '\r\n';

/**
 * Byte Order Mark. Ohne sie liest Excel die Datei als Windows-1252 und aus
 * „Nachbesprechung über Sonderfälle" wird „Ã¼ber Sonderfälle".
 */
const BOM = '﻿';

const COLUMNS = [
  'Datum',
  'Von',
  'Bis',
  'Stunden',
  'Kunde',
  'Projekt',
  'Stundensatz (EUR)',
  'Betrag (EUR)',
  'Beschreibung',
] as const;

/** Deutsche Dezimalschreibweise, ohne Tausenderpunkte (die verwirren Importe). */
function number(value: number, digits = 2): string {
  return value.toFixed(digits).replace('.', ',');
}

/**
 * Felder, die eine Tabellenkalkulation als Formel lesen koennte, bekommen einen
 * Apostroph vorweg.
 *
 * `=`, `+`, `-` und `@` am Feldanfang startet in Excel eine Formel — bis hin zu
 * `-1+cmd|…`, das beim Oeffnen einen externen Aufruf anstoesst. Die Datei geht
 * an Kunden, also wird das hier entschaerft und nicht gehofft.
 *
 * Der Preis: eine Beschreibung, die mit „- Telefonat" anfaengt, traegt im
 * Rohtext einen Apostroph. In Excel und LibreOffice ist er unsichtbar, weil er
 * dort genau das bedeutet: „das ist Text".
 */
function defuse(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function field(value: string): string {
  const safe = defuse(value);
  // Anfuehrungszeichen verdoppeln, und nur einpacken, wenn es sein muss.
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Eine Zeile je Zeiteintrag, nach Zeit sortiert.
 *
 * Bewusst die Einzeleintraege und nicht die Summen von der Seite: die
 * Beschreibungen gibt es nur hier, und genau sie sind das, was ein Kunde beim
 * Stundennachweis sehen will. Die Summen stehen in der Anwendung und lassen
 * sich in der Tabelle mit einer Formel nachrechnen — umgekehrt waere die
 * Information verloren.
 *
 * Das Datum steht als ISO (`2026-10-01`). Deutsches `01.10.2026` liest Excel in
 * einer englischen Einstellung als Text oder, schlimmer, als 1. Oktober
 * gegenueber 10. Januar; ISO ist eindeutig und sortiert auch als Text richtig.
 */
export function buildCsv(entries: readonly ReportEntry[]): string {
  const rows = [...entries]
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    .map((entry) => {
      const start = instantToWall(entry.startedAt);
      const end = instantToWall(entry.endedAt);
      const hours = durationHours(entry.startedAt, entry.endedAt);
      const rounded = Math.round((hours + Number.EPSILON) * 100) / 100;

      return [
        start.dayKey,
        formatClock(start.minutes),
        // Ein Eintrag, der auf Mitternacht endet, zeigt `24:00` statt `00:00` —
        // sonst sieht die Zeile aus wie eine negative Dauer.
        end.dayKey === start.dayKey ? formatClock(end.minutes) : '24:00',
        number(rounded),
        entry.clientName,
        entry.projectName,
        entry.hourlyRate === null ? '' : number(entry.hourlyRate),
        entry.hourlyRate === null ? '' : number(rounded * entry.hourlyRate),
        entry.description,
      ].map(field);
    });

  return (
    BOM +
    [COLUMNS.join(DELIMITER), ...rows.map((row) => row.join(DELIMITER))].join(NEWLINE) +
    NEWLINE
  );
}

export function csvFilename(monthKey: MonthKey): string {
  return `dailyfi-${monthForFilename(monthKey)}.csv`;
}
