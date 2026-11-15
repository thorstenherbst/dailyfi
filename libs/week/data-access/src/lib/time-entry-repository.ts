import { Injectable } from '@angular/core';

import { fail, injectGuarded, injectSupabase } from '@lib/shared/data-access-supabase';
import { Project, TimeEntry, TimeEntryDraft } from '@lib/week/domain';

interface EntryRow {
  id: string;
  project_id: string;
  started_at: string;
  ended_at: string;
  description: string;
}

function toEntry(row: EntryRow): TimeEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    startedAt: new Date(row.started_at),
    endedAt: new Date(row.ended_at),
    description: row.description,
  };
}

/**
 * Der einzige Ort, an dem das Wochenraster Supabase kennt. Der Store daneben
 * arbeitet nur noch mit `Project` und `TimeEntry` — dadurch laesst er sich mit
 * einem Doppel testen, ohne HTTP.
 *
 * `user_id` wird nirgends gesetzt: die Spalte hat `default auth.uid()`, und RLS
 * laesst ohnehin nichts anderes durch.
 */
@Injectable({ providedIn: 'root' })
export class TimeEntryRepository {
  private readonly db = injectSupabase();
  /** Fehler einheitlich; nach erneuerter Sitzung genau ein zweiter Versuch. */
  private readonly guarded = injectGuarded();

  /**
   * Projekte fuer die Auswahl im Raster.
   *
   * `!inner` plus der Filter auf `client.archived_at` ist kein Beiwerk: ohne
   * ihn bliebe das Projekt eines archivierten Kunden waehlbar. Archivieren soll
   * aus der Auswahl nehmen — sonst ist der Kunde nur auf `/projects`
   * verschwunden und im Raster weiter da.
   */
  async listProjects(): Promise<Project[]> {
    return this.guarded(async () => {
      const { data, error } = await this.db
        .from('projects')
        .select('id, name, color, client:clients!inner(name, archived_at)')
        .is('archived_at', null)
        .is('client.archived_at', null)
        .order('name');

      if (error) {
        fail(error);
      }

      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        clientName: row.client?.name ?? '',
      }));
    });
  }

  /** Alle Eintraege, die in `[from, to)` beginnen. */
  async listRange(from: Date, to: Date): Promise<TimeEntry[]> {
    return this.guarded(async () => {
      const { data, error } = await this.db
        .from('time_entries')
        .select('id, project_id, started_at, ended_at, description')
        .gte('started_at', from.toISOString())
        .lt('started_at', to.toISOString())
        .order('started_at');

      if (error) {
        fail(error);
      }

      return (data ?? []).map(toEntry);
    });
  }

  async create(draft: TimeEntryDraft): Promise<TimeEntry> {
    return this.guarded(async () => {
      const { data, error } = await this.db
        .from('time_entries')
        .insert({
          project_id: draft.projectId,
          started_at: draft.startedAt.toISOString(),
          ended_at: draft.endedAt.toISOString(),
          description: draft.description,
        })
        .select('id, project_id, started_at, ended_at, description')
        .single();

      if (error) {
        fail(error);
      }

      return toEntry(data);
    });
  }

  async update(id: string, patch: Partial<TimeEntryDraft>): Promise<TimeEntry> {
    return this.guarded(async () => {
      const { data, error } = await this.db
        .from('time_entries')
        .update({
          ...(patch.projectId === undefined ? {} : { project_id: patch.projectId }),
          ...(patch.startedAt === undefined ? {} : { started_at: patch.startedAt.toISOString() }),
          ...(patch.endedAt === undefined ? {} : { ended_at: patch.endedAt.toISOString() }),
          ...(patch.description === undefined ? {} : { description: patch.description }),
        })
        .eq('id', id)
        .select('id, project_id, started_at, ended_at, description')
        .single();

      if (error) {
        fail(error);
      }

      return toEntry(data);
    });
  }

  async remove(id: string): Promise<void> {
    return this.guarded(async () => {
      const { error } = await this.db.from('time_entries').delete().eq('id', id);
      if (error) {
        fail(error);
      }
    });
  }
}
