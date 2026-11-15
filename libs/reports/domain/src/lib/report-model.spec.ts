import { wallToInstant } from '@lib/shared/util-time';

import { ReportEntry, buildMonthReport, formatAmount } from './report-model';

interface Options {
  readonly client?: string;
  readonly project?: string;
  readonly rate?: number | null;
  readonly description?: string;
  readonly projectArchived?: boolean;
  readonly clientArchived?: boolean;
}

let counter = 0;

function entry(day: string, from: number, to: number, options: Options = {}): ReportEntry {
  const client = options.client ?? 'Sandmann GmbH';
  const project = options.project ?? 'Relaunch';
  counter += 1;
  return {
    id: `e${counter}`,
    startedAt: wallToInstant(day, from),
    endedAt: wallToInstant(day, to),
    description: options.description ?? '',
    // Pro Kunde eine eigene Kennung — so wie im Schema, wo `projects.id` ein
    // Primaerschluessel ist. Gleicher Name bei zwei Kunden heisst zwei Projekte.
    projectId: `p-${client}-${project}`,
    projectName: project,
    projectArchived: options.projectArchived ?? false,
    hourlyRate: options.rate === undefined ? 100 : options.rate,
    clientId: `c-${client}`,
    clientName: client,
    clientArchived: options.clientArchived ?? false,
  };
}

describe('buildMonthReport', () => {
  it('liefert fuer einen leeren Monat Nullen und keine Zeilen', () => {
    const report = buildMonthReport([]);

    expect(report.clients).toEqual([]);
    expect(report.hours).toBe(0);
    expect(report.amount).toBe(0);
    expect(report.entryCount).toBe(0);
    expect(report.hasRateGap).toBe(false);
  });

  it('fasst Eintraege je Projekt zusammen und zaehlt sie', () => {
    const report = buildMonthReport([
      entry('2026-10-01', 540, 660), // 2,00 h
      entry('2026-10-02', 540, 615), // 1,25 h
    ]);

    const project = report.clients[0].projects[0];
    expect(project.hours).toBe(3.25);
    expect(project.entryCount).toBe(2);
    expect(project.amount).toBe(325);
  });

  it('gruppiert Projekte unter ihren Kunden, beide alphabetisch', () => {
    const report = buildMonthReport([
      entry('2026-10-01', 540, 600, { client: 'Nordlicht Medien', project: 'Schulung' }),
      entry('2026-10-01', 600, 660, { client: 'Nordlicht Medien', project: 'Beratung' }),
      entry('2026-10-01', 660, 720, { client: 'Sandmann GmbH', project: 'Relaunch' }),
    ]);

    expect(report.clients.map((client) => client.clientName)).toEqual([
      'Nordlicht Medien',
      'Sandmann GmbH',
    ]);
    expect(report.clients[0].projects.map((project) => project.projectName)).toEqual([
      'Beratung',
      'Schulung',
    ]);
  });

  it('rechnet die real gearbeitete Zeit, auch am Umstelltag', () => {
    // 29.03.2026: 02:00 fehlt. Ein Block von 01:00 bis 04:00 ist drei
    // Rasterstunden hoch, aber nur zwei Stunden lang — abgerechnet wird die
    // Zeit, nicht die Hoehe des Blocks.
    const report = buildMonthReport([entry('2026-03-29', 60, 240, { rate: 100 })]);

    expect(report.hours).toBe(2);
    expect(report.amount).toBe(200);
  });

  it('rechnet auch die laengere Stunde im Oktober mit', () => {
    // 25.10.2026: 02:00 kommt zweimal. 01:00 bis 04:00 sind vier Stunden.
    const report = buildMonthReport([entry('2026-10-25', 60, 240, { rate: 100 })]);

    expect(report.hours).toBe(4);
  });

  it('rechnet den Betrag aus den angezeigten Stunden, damit die Rechnung aufgeht', () => {
    // 1 h 20 min = 1,333… h. Angezeigt werden 1,33 h; der Betrag muss sich aus
    // dieser Zahl nachrechnen lassen, sonst kostet er eine Rueckfrage.
    const report = buildMonthReport([entry('2026-10-01', 540, 620, { rate: 90 })]);

    expect(report.clients[0].projects[0].hours).toBe(1.33);
    expect(report.clients[0].projects[0].amount).toBe(119.7);
    expect(1.33 * 90).toBeCloseTo(119.7, 10);
  });

  it('bildet Summen aus den gerundeten Zeilen, damit jede Spalte sichtbar aufgeht', () => {
    const report = buildMonthReport([
      entry('2026-10-01', 540, 620, { project: 'A', rate: 90 }), // 1,33 h → 119,70
      entry('2026-10-02', 540, 620, { project: 'B', rate: 90 }), // 1,33 h → 119,70
    ]);

    const client = report.clients[0];
    expect(client.projects.map((project) => project.hours)).toEqual([1.33, 1.33]);
    // 2,66 und nicht 2,67 — die Spalte muss sich nachaddieren lassen.
    expect(client.hours).toBe(2.66);
    expect(client.amount).toBe(239.4);
    expect(report.hours).toBe(2.66);
    expect(report.amount).toBe(239.4);
  });

  it('meldet ein Projekt ohne Stundensatz als Luecke, statt mit 0 € zu rechnen', () => {
    const report = buildMonthReport([
      entry('2026-10-01', 540, 660, { project: 'Mit Satz', rate: 100 }),
      entry('2026-10-02', 540, 660, { project: 'Ohne Satz', rate: null }),
    ]);

    const ohne = report.clients[0].projects.find((p) => p.projectName === 'Ohne Satz')!;
    expect(ohne.hours).toBe(2);
    // `null`, nicht 0: eine Summe mit stillschweigender Null sieht plausibel
    // aus und ist genau deshalb gefaehrlich.
    expect(ohne.amount).toBeNull();

    expect(report.hasRateGap).toBe(true);
    expect(report.projectsWithoutRate).toEqual(['Ohne Satz']);
    expect(report.clients[0].hasRateGap).toBe(true);
    // Die Stunden sind trotzdem vollstaendig.
    expect(report.hours).toBe(4);
    expect(report.amount).toBe(200);
  });

  it('nennt mehrere Luecken sortiert', () => {
    const report = buildMonthReport([
      entry('2026-10-01', 540, 600, { project: 'Zeta', rate: null }),
      entry('2026-10-01', 600, 660, { project: 'Alpha', rate: null }),
    ]);

    expect(report.projectsWithoutRate).toEqual(['Alpha', 'Zeta']);
  });

  it('nimmt archivierte Projekte und Kunden mit und kennzeichnet sie', () => {
    // Die Stunden sind gearbeitet, egal ob das Projekt heute noch in der
    // Auswahl steht. Ein Bericht, der sie verschweigt, laesst Geld liegen.
    const report = buildMonthReport([
      entry('2026-10-01', 540, 660, {
        project: 'Altes Projekt',
        projectArchived: true,
        clientArchived: true,
      }),
    ]);

    expect(report.hours).toBe(2);
    expect(report.clients[0].archived).toBe(true);
    expect(report.clients[0].projects[0].archived).toBe(true);
  });

  it('haelt gleichnamige Projekte verschiedener Kunden auseinander', () => {
    const report = buildMonthReport([
      entry('2026-10-01', 540, 600, { client: 'A', project: 'Wartung' }),
      entry('2026-10-01', 600, 720, { client: 'B', project: 'Wartung' }),
    ]);

    expect(report.clients).toHaveLength(2);
    expect(report.clients[0].projects[0].hours).toBe(1);
    expect(report.clients[1].projects[0].hours).toBe(2);
  });
});

describe('formatAmount', () => {
  it('schreibt Betraege deutsch mit Euro', () => {
    expect(formatAmount(0)).toBe('0,00 €');
    expect(formatAmount(119.7)).toBe('119,70 €');
    expect(formatAmount(1250.5)).toBe('1.250,50 €');
  });
});
