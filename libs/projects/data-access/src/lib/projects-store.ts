import { Injectable, PendingTasks, computed, inject, signal } from '@angular/core';

import { Client, ClientDraft, ProjectDraft, ProjectRecord } from '@lib/projects/domain';
import {
  RepositoryError,
  RepositoryErrorCode,
  TransientErrorFeedback,
  USER_FEEDBACK,
  isSyncFailure,
} from '@lib/shared/data-access-supabase';

import { ProjectRepository } from './project-repository';

const ERROR_TEXTS: Record<RepositoryErrorCode, string> = {
  offline: 'Keine Verbindung zum Server.',
  'session-expired': 'Die Anmeldung war abgelaufen.',
  unauthorized: 'Dafür fehlt die Berechtigung.',
  'invalid-range': 'Diese Angabe nimmt der Server nicht an.',
  'invalid-value': 'Diese Angabe nimmt der Server nicht an — bitte Name, Farbe und Satz prüfen.',
  'in-use': 'Daran hängen noch Daten. Archivieren statt löschen.',
  'not-found': 'Das gibt es nicht mehr. Bitte die Seite neu laden.',
  unknown: 'Das hat nicht geklappt.',
};

/**
 * Jeder Fehler wird hier zu einem deutschen Satz. Der technische Wortlaut ist
 * schon im Repository in der Konsole gelandet und hat in der Oberflaeche nichts
 * verloren.
 */
function describeError(error: unknown): string {
  if (error instanceof RepositoryError) {
    return ERROR_TEXTS[error.code];
  }
  console.error('[Dailyfi] Unerwarteter Fehler:', error);
  return ERROR_TEXTS.unknown;
}

/** Ein Kunde mit seinen Projekten — so, wie die Seite ihn zeigt. */
export interface ClientGroup {
  readonly client: Client;
  readonly projects: readonly ProjectRecord[];
  /** Projekte, die nur wegen des Filters nicht in `projects` stehen. */
  readonly hiddenProjects: number;
}

/**
 * Zustand der Projektverwaltung.
 *
 * Anders als im Wochenraster wird hier **erst gespeichert und dann angezeigt**.
 * Beim Ziehen eines Zeitblocks waere Warten unerträglich, ein Formular darf
 * dagegen eine Antwort abwarten — und ein Stundensatz, der kurz im Bild stand
 * und dann wieder verschwindet, ist in einem Abrechnungswerkzeug schlimmer als
 * eine halbe Sekunde Geduld.
 */
@Injectable()
export class ProjectsStore {
  private readonly repository = inject(ProjectRepository);
  /**
   * Jede Abfrage und jedes Schreiben laeuft hierdurch. Dadurch gilt die
   * Anwendung erst als stabil, wenn der Server geantwortet hat — das zaehlt
   * fuer den Test genauso wie fuer alles, was spaeter auf Stabilitaet wartet.
   */
  private readonly tasks = inject(PendingTasks);
  private readonly feedback = inject(USER_FEEDBACK);
  /** Der Toast zum letzten Ladefehler — weg damit, sobald wieder geladen ist. */
  private readonly loadErrorToast = new TransientErrorFeedback(this.feedback);

  readonly clients = signal<readonly Client[]>([]);
  readonly projects = signal<readonly ProjectRecord[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  /** Laden gescheitert: die Seite zeigt einen Fehlerzustand mit „Erneut laden". */
  readonly loadError = signal<string | null>(null);
  /** Letzter Kontakt zum Server ist gescheitert (nicht: Eingabe abgelehnt). */
  readonly syncError = signal(false);

  /** Archiviertes ist standardmaessig aus dem Weg, aber nie verschwunden. */
  readonly showArchived = signal(false);

  readonly activeProjectCount = computed(
    () => this.projects().filter((project) => project.archivedAt === null).length,
  );

  /** Kunden mit ihren Projekten, nach dem Filter. */
  readonly groups = computed<ClientGroup[]>(() => {
    const showArchived = this.showArchived();
    const byClient = new Map<string, ProjectRecord[]>();
    for (const project of this.projects()) {
      const list = byClient.get(project.clientId) ?? [];
      list.push(project);
      byClient.set(project.clientId, list);
    }

    return this.clients()
      .filter((client) => showArchived || client.archivedAt === null)
      .map((client) => {
        const all = byClient.get(client.id) ?? [];
        const visible = showArchived ? all : all.filter((p) => p.archivedAt === null);
        return { client, projects: visible, hiddenProjects: all.length - visible.length };
      });
  });

  /** Kunden, unter denen ein neues Projekt entstehen darf. */
  readonly assignableClients = computed(() =>
    this.clients().filter((client) => client.archivedAt === null),
  );

  load(): Promise<void> {
    return this.track(() => this.doLoad());
  }

  private async doLoad(): Promise<void> {
    // `loadError` bleibt bis zum Ergebnis stehen: „Erneut laden" behaelt so
    // seine Karte und den Fokus, statt auf `body` zu fallen.
    this.loading.set(true);
    try {
      const [clients, projects] = await Promise.all([
        this.repository.listClients(),
        this.repository.listProjects(),
      ]);
      this.clients.set(clients);
      this.projects.set(projects);
      this.syncError.set(false);
      this.loadError.set(null);
      this.loadErrorToast.dismiss();
    } catch (error) {
      // Kein halber Stand: der Fehlerzustand ersetzt die Liste.
      this.clients.set([]);
      this.projects.set([]);
      const reason = describeError(error);
      this.loadError.set(reason);
      this.syncError.set(isSyncFailure(error));
      this.loadErrorToast.error('Kunden und Projekte konnten nicht geladen werden.', {
        detail: reason,
      });
    } finally {
      this.loading.set(false);
    }
  }

  /* -- Kunden ----------------------------------------------------------- */

  /** Der angelegte Kunde, `null`: gescheitert (Toast). */
  async createClient(draft: ClientDraft): Promise<Client | null> {
    let created: Client | null = null;
    await this.write('Der Kunde konnte nicht angelegt werden', async () => {
      const client = await this.repository.createClient(draft);
      this.clients.update((list) => sortClients([...list, client]));
      this.feedback.success(`Kunde ${client.name} angelegt.`);
      created = client;
    });
    return created;
  }

  async renameClient(id: string, name: string): Promise<boolean> {
    return this.write('Der Kunde konnte nicht umbenannt werden', async () => {
      const client = await this.repository.renameClient(id, name);
      this.replaceClient(client);
      this.feedback.success(`Kunde heißt jetzt ${client.name}.`);
    });
  }

  async setClientArchived(id: string, archived: boolean): Promise<boolean> {
    return this.write(
      archived
        ? 'Der Kunde konnte nicht archiviert werden'
        : 'Der Kunde konnte nicht zurückgeholt werden',
      async () => {
        const client = await this.repository.setClientArchived(id, archived);
        this.replaceClient(client);
        if (archived) {
          this.feedback.success(`Kunde ${client.name} archiviert.`, {
            detail: 'Seine Projekte stehen nicht mehr im Wochenraster zur Auswahl.',
          });
        } else {
          this.feedback.success(`Kunde ${client.name} ist wieder aktiv.`);
        }
      },
    );
  }

  /* -- Projekte --------------------------------------------------------- */

  /** Das angelegte Projekt, `null`: gescheitert (Toast). */
  async createProject(draft: ProjectDraft): Promise<ProjectRecord | null> {
    let created: ProjectRecord | null = null;
    await this.write('Das Projekt konnte nicht angelegt werden', async () => {
      const project = await this.repository.createProject(draft);
      this.projects.update((list) => sortProjects([...list, project]));
      this.feedback.success(`Projekt ${project.name} angelegt.`);
      created = project;
    });
    return created;
  }

  async updateProject(id: string, patch: Partial<ProjectDraft>): Promise<boolean> {
    return this.write('Das Projekt konnte nicht gespeichert werden', async () => {
      const project = await this.repository.updateProject(id, patch);
      this.replaceProject(project);
      this.feedback.success(`Projekt ${project.name} gespeichert.`);
    });
  }

  async setProjectArchived(id: string, archived: boolean): Promise<boolean> {
    return this.write(
      archived
        ? 'Das Projekt konnte nicht archiviert werden'
        : 'Das Projekt konnte nicht zurückgeholt werden',
      async () => {
        const project = await this.repository.setProjectArchived(id, archived);
        this.replaceProject(project);
        if (archived) {
          this.feedback.success(`Projekt ${project.name} archiviert.`, {
            detail: 'Die erfassten Zeiten bleiben erhalten.',
          });
        } else {
          this.feedback.success(`Projekt ${project.name} ist wieder aktiv.`);
        }
      },
    );
  }

  /**
   * Ein Schreibvorgang. `true` heisst: durch — und nur dann darf eine Zeile
   * ihre Bearbeitung beenden. Ein Fehler kommt immer als Toast: die Zeile ist
   * nicht modal, die Eingaben bleiben darin stehen.
   */
  private write(what: string, operation: () => Promise<void>): Promise<boolean> {
    return this.track(() => this.doWrite(what, operation));
  }

  /**
   * `PendingTasks.add()` statt `run()`: nur `add()` gibt das Ergebnis zurueck,
   * und der Aufrufer braucht es — an `false` haengt, ob die Zeile offen bleibt.
   */
  private track<T>(operation: () => Promise<T>): Promise<T> {
    const done = this.tasks.add();
    return operation().finally(done);
  }

  private async doWrite(what: string, operation: () => Promise<void>): Promise<boolean> {
    this.saving.set(true);
    try {
      await operation();
      this.syncError.set(false);
      return true;
    } catch (error) {
      this.syncError.set(isSyncFailure(error));
      this.feedback.error(`${what}.`, { detail: describeError(error) });
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  private replaceClient(client: Client): void {
    this.clients.update((list) =>
      sortClients(list.map((candidate) => (candidate.id === client.id ? client : candidate))),
    );
  }

  private replaceProject(project: ProjectRecord): void {
    this.projects.update((list) =>
      sortProjects(list.map((candidate) => (candidate.id === project.id ? project : candidate))),
    );
  }
}

// Dieselbe Reihenfolge wie der Server liefert, damit ein neu angelegter
// Eintrag nicht bis zum naechsten Laden an der falschen Stelle steht.
function sortClients(list: readonly Client[]): Client[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function sortProjects(list: readonly ProjectRecord[]): ProjectRecord[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
