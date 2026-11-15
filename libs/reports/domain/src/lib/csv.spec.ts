import { wallToInstant } from '@lib/shared/util-time';

import { buildCsv, csvFilename } from './csv';
import { ReportEntry } from './report-model';

function entry(
  day: string,
  from: number,
  to: number,
  options: { description?: string; rate?: number | null; project?: string } = {},
): ReportEntry {
  return {
    id: `${day}-${from}`,
    startedAt: wallToInstant(day, from),
    endedAt: wallToInstant(day, to),
    description: options.description ?? 'Datenmodell',
    projectId: 'p1',
    projectName: options.project ?? 'Relaunch',
    projectArchived: false,
    hourlyRate: options.rate === undefined ? 95 : options.rate,
    clientId: 'c1',
    clientName: 'Sandmann GmbH',
    clientArchived: false,
  };
}

function lines(csv: string): string[] {
  return csv.replace(/^﻿/, '').trimEnd().split('\r\n');
}

describe('buildCsv', () => {
  it('beginnt mit einer BOM, damit Excel Umlaute liest', () => {
    const csv = buildCsv([entry('2026-10-01', 540, 660, { description: 'über Sonderfälle' })]);

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('über Sonderfälle');
  });

  it('trennt mit Semikolon und beendet Zeilen mit CRLF', () => {
    const csv = buildCsv([entry('2026-10-01', 540, 660)]);

    expect(lines(csv)[0]).toBe(
      'Datum;Von;Bis;Stunden;Kunde;Projekt;Stundensatz (EUR);Betrag (EUR);Beschreibung',
    );
    expect(csv).toContain('\r\n');
  });

  it('schreibt Datum als ISO und Zahlen mit Komma', () => {
    const csv = buildCsv([entry('2026-10-01', 555, 660)]); // 9:15–11:00 = 1,75 h

    expect(lines(csv)[1]).toBe(
      '2026-10-01;09:15;11:00;1,75;Sandmann GmbH;Relaunch;95,00;166,25;Datenmodell',
    );
  });

  it('zeigt einen Eintrag bis Mitternacht als 24:00', () => {
    // 00:00 sähe aus wie eine negative Dauer.
    const csv = buildCsv([entry('2026-10-01', 1380, 1440)]);

    expect(lines(csv)[1]).toContain(';23:00;24:00;1,00;');
  });

  it('laesst die Geldspalten leer, wenn kein Stundensatz hinterlegt ist', () => {
    const csv = buildCsv([entry('2026-10-01', 540, 660, { rate: null })]);

    expect(lines(csv)[1]).toBe('2026-10-01;09:00;11:00;2,00;Sandmann GmbH;Relaunch;;;Datenmodell');
  });

  it('rechnet am Umstelltag die reale Dauer', () => {
    const csv = buildCsv([entry('2026-03-29', 60, 240)]); // drei Rasterstunden, zwei echte

    expect(lines(csv)[1]).toContain(';01:00;04:00;2,00;');
  });

  it('packt Felder ein, die ein Semikolon, Anfuehrungszeichen oder Umbruch enthalten', () => {
    const csv = buildCsv([
      entry('2026-10-01', 540, 600, { description: 'Teil A; Teil B' }),
      entry('2026-10-02', 540, 600, { description: 'Kunde sagte "später"' }),
      entry('2026-10-03', 540, 600, { description: 'Zeile 1\nZeile 2' }),
    ]);
    const rows = lines(csv);

    expect(rows[1]).toContain('"Teil A; Teil B"');
    expect(rows[2]).toContain('"Kunde sagte ""später"""');
    expect(csv).toContain('"Zeile 1\nZeile 2"');
  });

  it('entschaerft Felder, die Excel als Formel lesen wuerde', () => {
    const csv = buildCsv([
      entry('2026-10-01', 540, 600, { description: '=SUMME(A1:A9)' }),
      entry('2026-10-02', 540, 600, { description: '-1+cmd|calc' }),
      entry('2026-10-03', 540, 600, { description: '@SVERWEIS' }),
      entry('2026-10-04', 540, 600, { description: '+49 Telefonat' }),
    ]);
    const rows = lines(csv);

    // Die Datei geht an Kunden; ein Apostroph davor ist in Excel unsichtbar und
    // bedeutet dort genau „das ist Text".
    expect(rows[1]).toContain("'=SUMME(A1:A9)");
    expect(rows[2]).toContain("'-1+cmd|calc");
    expect(rows[3]).toContain("'@SVERWEIS");
    expect(rows[4]).toContain("'+49 Telefonat");
  });

  it('entschaerft auch Kunden- und Projektnamen', () => {
    const csv = buildCsv([{ ...entry('2026-10-01', 540, 600), projectName: '=A1' }]);

    expect(lines(csv)[1]).toContain("'=A1");
  });

  it('laesst gewoehnlichen Text unangetastet', () => {
    const csv = buildCsv([entry('2026-10-01', 540, 600, { description: 'Abstimmung mit Anna' })]);

    expect(lines(csv)[1]).toContain(';Abstimmung mit Anna');
    expect(csv).not.toContain("'Abstimmung");
  });

  it('sortiert nach Zeit, unabhaengig von der Reihenfolge der Eingabe', () => {
    const csv = buildCsv([
      entry('2026-10-03', 540, 600),
      entry('2026-10-01', 540, 600),
      entry('2026-10-02', 540, 600),
    ]);

    expect(
      lines(csv)
        .slice(1)
        .map((row) => row.split(';')[0]),
    ).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('schreibt auch ohne Eintraege eine brauchbare Datei', () => {
    const csv = buildCsv([]);

    // Nur die Kopfzeile — kein leeres Blatt, in dem niemand die Spalten raet.
    expect(lines(csv)).toHaveLength(1);
  });

  it('benennt die Datei nach dem Monat, damit der Ordner sortiert bleibt', () => {
    expect(csvFilename('2026-10')).toBe('dailyfi-2026-10.csv');
  });
});
