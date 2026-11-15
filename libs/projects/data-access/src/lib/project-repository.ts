import { Injectable } from '@angular/core';

import { Client, ClientDraft, ProjectDraft, ProjectRecord } from '@lib/projects/domain';
import { fail, injectGuarded, injectSupabase } from '@lib/shared/data-access-supabase';

interface ClientRow {
  id: string;
  name: string;
  archived_at: string | null;
}

interface ProjectRow {
  id: string;
  client_id: string;
  name: string;
  color: string;
  hourly_rate: string | number | null;
  archived_at: string | null;
}

const CLIENT_COLUMNS = 'id, name, archived_at';
const PROJECT_COLUMNS = 'id, client_id, name, color, hourly_rate, archived_at';

function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
  };
}

/**
 * `numeric` kommt als Zeichenkette aus PostgREST — sonst verlöre eine
 * Bibliothek beim Umwandeln stillschweigend Genauigkeit. Hier ist der eine Ort,
 * an dem daraus eine Zahl wird.
 */
function toProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    color: row.color,
    hourlyRate: row.hourly_rate === null ? null : Number(row.hourly_rate),
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
  };
}

/**
 * Der einzige Ort, an dem die Projektverwaltung Supabase kennt.
 *
 * `user_id` wird nirgends gesetzt: die Spalte hat `default auth.uid()`, und RLS
 * laesst ohnehin nichts anderes durch. Gelöscht wird nichts — `on delete
 * restrict` haengt an Projekten und Zeiteintraegen, und eine gelöschte
 * Vergangenheit waere in einem Abrechnungswerkzeug ein Fehler, keine Funktion.
 * Stattdessen wird archiviert.
 */
@Injectable({ providedIn: 'root' })
export class ProjectRepository {
  private readonly db = injectSupabase();
  /** Fehler einheitlich; nach erneuerter Sitzung genau ein zweiter Versuch. */
  private readonly guarded = injectGuarded();

  /** Alle Kunden, auch archivierte — die Seite entscheidet, was sie zeigt. */
  async listClients(): Promise<Client[]> {
    return this.guarded(async () => {
      const { data, error } = await this.db.from('clients').select(CLIENT_COLUMNS).order('name');
      if (error) {
        fail(error);
      }
      return (data ?? []).map(toClient);
    });
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return this.guarded(async () => {
      const { data, error } = await this.db.from('projects').select(PROJECT_COLUMNS).order('name');
      if (error) {
        fail(error);
      }
      return (data ?? []).map(toProject);
    });
  }

  async createClient(draft: ClientDraft): Promise<Client> {
    return this.guarded(async () => {
      const { data, error } = await this.db
        .from('clients')
        .insert({ name: draft.name })
        .select(CLIENT_COLUMNS)
        .single();
      if (error) {
        fail(error);
      }
      return toClient(data);
    });
  }

  async renameClient(id: string, name: string): Promise<Client> {
    return this.guarded(async () => {
      const { data, error } = await this.db
        .from('clients')
        .update({ name })
        .eq('id', id)
        .select(CLIENT_COLUMNS)
        .single();
      if (error) {
        fail(error);
      }
      return toClient(data);
    });
  }

  /** `archived` statt „löschen": die Zeiten dahinter bleiben abrechenbar. */
  async setClientArchived(id: string, archived: boolean): Promise<Client> {
    return this.guarded(async () => {
      const { data, error } = await this.db
        .from('clients')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('id', id)
        .select(CLIENT_COLUMNS)
        .single();
      if (error) {
        fail(error);
      }
      return toClient(data);
    });
  }

  async createProject(draft: ProjectDraft): Promise<ProjectRecord> {
    return this.guarded(async () => {
      const { data, error } = await this.db
        .from('projects')
        .insert({
          client_id: draft.clientId,
          name: draft.name,
          color: draft.color,
          hourly_rate: draft.hourlyRate,
        })
        .select(PROJECT_COLUMNS)
        .single();
      if (error) {
        fail(error);
      }
      return toProject(data);
    });
  }

  async updateProject(id: string, patch: Partial<ProjectDraft>): Promise<ProjectRecord> {
    return this.guarded(async () => {
      const { data, error } = await this.db
        .from('projects')
        .update({
          ...(patch.clientId === undefined ? {} : { client_id: patch.clientId }),
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.color === undefined ? {} : { color: patch.color }),
          ...(patch.hourlyRate === undefined ? {} : { hourly_rate: patch.hourlyRate }),
        })
        .eq('id', id)
        .select(PROJECT_COLUMNS)
        .single();
      if (error) {
        fail(error);
      }
      return toProject(data);
    });
  }

  async setProjectArchived(id: string, archived: boolean): Promise<ProjectRecord> {
    return this.guarded(async () => {
      const { data, error } = await this.db
        .from('projects')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('id', id)
        .select(PROJECT_COLUMNS)
        .single();
      if (error) {
        fail(error);
      }
      return toProject(data);
    });
  }
}
