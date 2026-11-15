import { Injectable } from '@angular/core';

import { ReportEntry } from '@lib/reports/domain';
import { fail, injectGuarded, injectSupabase } from '@lib/shared/data-access-supabase';

interface Row {
  id: string;
  started_at: string;
  ended_at: string;
  description: string;
  project: {
    id: string;
    name: string;
    archived_at: string | null;
    hourly_rate: string | number | null;
    client: { id: string; name: string; archived_at: string | null };
  };
}

/**
 * Zeiteintraege eines Monats, mit Projekt und Kunde daran.
 *
 * **Archiviertes wird ausdruecklich nicht herausgefiltert.** Die Stunden sind
 * gearbeitet, egal ob das Projekt heute noch in der Auswahl steht — ein Bericht,
 * der archivierte Projekte verschweigt, laesst Geld auf dem Tisch liegen. Das
 * ist der Unterschied zu `TimeEntryRepository.listProjects()` in
 * `week/data-access`, das genau umgekehrt filtert.
 */
@Injectable({ providedIn: 'root' })
export class ReportRepository {
  private readonly db = injectSupabase();
  /** Fehler einheitlich; nach erneuerter Sitzung genau ein zweiter Versuch. */
  private readonly guarded = injectGuarded();

  /** Alle Eintraege, die in `[from, to)` beginnen. */
  async listRange(from: Date, to: Date): Promise<ReportEntry[]> {
    return this.guarded(async () => {
      const { data, error } = await this.db
        .from('time_entries')
        .select(
          'id, started_at, ended_at, description, ' +
            'project:projects!inner(id, name, archived_at, hourly_rate, ' +
            'client:clients!inner(id, name, archived_at))',
        )
        .gte('started_at', from.toISOString())
        .lt('started_at', to.toISOString())
        .order('started_at');

      if (error) {
        fail(error);
      }

      return ((data as unknown as Row[] | null) ?? []).map(toReportEntry);
    });
  }
}

function toReportEntry(row: Row): ReportEntry {
  return {
    id: row.id,
    startedAt: new Date(row.started_at),
    endedAt: new Date(row.ended_at),
    description: row.description,
    projectId: row.project.id,
    projectName: row.project.name,
    projectArchived: row.project.archived_at !== null,
    // `numeric` kommt je nach Weg als Zeichenkette oder als Zahl.
    hourlyRate: row.project.hourly_rate === null ? null : Number(row.project.hourly_rate),
    clientId: row.project.client.id,
    clientName: row.project.client.name,
    clientArchived: row.project.client.archived_at !== null,
  };
}
