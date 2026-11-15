import { durationHours } from '@lib/shared/util-time';

/** Ein Zeiteintrag mit allem, was der Bericht ueber ihn wissen muss. */
export interface ReportEntry {
  readonly id: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly description: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectArchived: boolean;
  readonly hourlyRate: number | null;
  readonly clientId: string;
  readonly clientName: string;
  readonly clientArchived: boolean;
}

export interface ProjectSum {
  readonly projectId: string;
  readonly projectName: string;
  readonly archived: boolean;
  readonly hourlyRate: number | null;
  readonly hours: number;
  /** `null`, wenn fuer das Projekt kein Stundensatz hinterlegt ist. */
  readonly amount: number | null;
  readonly entryCount: number;
}

export interface ClientSum {
  readonly clientId: string;
  readonly clientName: string;
  readonly archived: boolean;
  readonly projects: readonly ProjectSum[];
  readonly hours: number;
  readonly amount: number;
  /** Mindestens ein Projekt ohne Stundensatz — der Betrag ist unvollstaendig. */
  readonly hasRateGap: boolean;
}

export interface MonthReport {
  readonly clients: readonly ClientSum[];
  readonly hours: number;
  readonly amount: number;
  readonly hasRateGap: boolean;
  readonly entryCount: number;
  /** Projekte ohne Satz, die Stunden beigetragen haben — fuer den Hinweis. */
  readonly projectsWithoutRate: readonly string[];
}

/** Zwei Nachkommastellen, kaufmaennisch. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Stunden und Betraege eines Monats, gruppiert Kunde → Projekt.
 *
 * **Die Rundung ist hier eine Entscheidung, keine Nebensache.** Drei Regeln,
 * die zusammen dafuer sorgen, dass die Tabelle aufgeht:
 *
 * 1. Die Stunden eines Projekts werden aus den echten Zeitpunkten gerechnet
 *    (`durationHours`) und erst dann auf zwei Stellen gerundet. Damit stimmt
 *    auch der Umstelltag: ein Block 01:00–04:00 am 29. Maerz sind zwei Stunden,
 *    nicht drei.
 * 2. Der Betrag entsteht aus den **angezeigten** Stunden, nicht aus der exakten
 *    Dauer. In einer Rechnung muss Stunden × Satz aufgehen; ein Betrag, der
 *    sich aus der Anzeige nicht nachrechnen laesst, kostet eine Rueckfrage beim
 *    Kunden.
 * 3. Summen sind Summen der gerundeten Zeilen, nicht neu gerundete Summen. So
 *    addiert sich jede Spalte sichtbar. Der Preis: die Gesamtsumme kann um
 *    Sekundenbruchteile von der exakt gearbeiteten Zeit abweichen. Bei einem
 *    Raster, das auf Viertelstunden rastet, tritt das praktisch nur am
 *    Umstelltag auf.
 *
 * Ein Projekt ohne Stundensatz traegt `null` als Betrag und wird oben als Luecke
 * gemeldet — stillschweigend mit 0 € zu rechnen waere die gefaehrlichste
 * Variante.
 */
export function buildMonthReport(entries: readonly ReportEntry[]): MonthReport {
  const byProject = new Map<string, { entry: ReportEntry; hours: number; count: number }>();

  for (const entry of entries) {
    const hours = durationHours(entry.startedAt, entry.endedAt);
    const found = byProject.get(entry.projectId);
    if (found) {
      found.hours += hours;
      found.count += 1;
    } else {
      byProject.set(entry.projectId, { entry, hours, count: 1 });
    }
  }

  const projectSums: ProjectSum[] = [...byProject.values()].map(({ entry, hours, count }) => {
    const rounded = round2(hours);
    return {
      projectId: entry.projectId,
      projectName: entry.projectName,
      archived: entry.projectArchived,
      hourlyRate: entry.hourlyRate,
      hours: rounded,
      amount: entry.hourlyRate === null ? null : round2(rounded * entry.hourlyRate),
      entryCount: count,
    };
  });

  const clientOf = new Map<string, ReportEntry>();
  for (const entry of entries) {
    if (!clientOf.has(entry.clientId)) {
      clientOf.set(entry.clientId, entry);
    }
  }
  const clientIdOfProject = new Map<string, string>();
  for (const { entry } of byProject.values()) {
    clientIdOfProject.set(entry.projectId, entry.clientId);
  }

  const clients: ClientSum[] = [...clientOf.values()]
    .map((entry): ClientSum => {
      const projects = projectSums
        .filter((project) => clientIdOfProject.get(project.projectId) === entry.clientId)
        .sort((a, b) => a.projectName.localeCompare(b.projectName, 'de'));

      return {
        clientId: entry.clientId,
        clientName: entry.clientName,
        archived: entry.clientArchived,
        projects,
        hours: round2(projects.reduce((total, project) => total + project.hours, 0)),
        amount: round2(projects.reduce((total, project) => total + (project.amount ?? 0), 0)),
        hasRateGap: projects.some((project) => project.amount === null),
      };
    })
    .sort((a, b) => a.clientName.localeCompare(b.clientName, 'de'));

  return {
    clients,
    hours: round2(clients.reduce((total, client) => total + client.hours, 0)),
    amount: round2(clients.reduce((total, client) => total + client.amount, 0)),
    hasRateGap: clients.some((client) => client.hasRateGap),
    entryCount: entries.length,
    projectsWithoutRate: projectSums
      .filter((project) => project.amount === null)
      .map((project) => project.projectName)
      .sort((a, b) => a.localeCompare(b, 'de')),
  };
}

/** Betrag deutsch mit Euro: `1.250,50 €`. */
export function formatAmount(value: number): string {
  return `${value.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}
