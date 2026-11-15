import { TestBed } from '@angular/core/testing';

import { Client, ClientDraft, ProjectDraft, ProjectRecord } from '@lib/projects/domain';
import { RepositoryError, USER_FEEDBACK } from '@lib/shared/data-access-supabase';
import { RecordingFeedback } from '@lib/shared/data-access-supabase/testing';

import { ProjectRepository } from './project-repository';
import { ProjectsStore } from './projects-store';

const ARCHIVED = new Date('2026-09-20T10:00:00Z');

function client(id: string, name: string, archived = false): Client {
  return { id, name, archivedAt: archived ? ARCHIVED : null };
}

function project(id: string, clientId: string, name: string, archived = false): ProjectRecord {
  return {
    id,
    clientId,
    name,
    color: '#A8412A',
    hourlyRate: 95,
    archivedAt: archived ? ARCHIVED : null,
  };
}

class FakeRepository implements Partial<ProjectRepository> {
  clients: Client[] = [client('c1', 'Sandmann GmbH'), client('c2', 'Nordlicht Medien')];
  projects: ProjectRecord[] = [
    project('p1', 'c1', 'Relaunch'),
    project('p2', 'c1', 'Wartung', true),
    project('p3', 'c2', 'Beratung'),
  ];
  failWith: RepositoryError | null = null;
  created: ClientDraft[] = [];
  updates: Array<{ id: string; patch: Partial<ProjectDraft> }> = [];

  private check(): void {
    if (this.failWith) {
      throw this.failWith;
    }
  }

  async listClients(): Promise<Client[]> {
    return this.clients;
  }
  async listProjects(): Promise<ProjectRecord[]> {
    return this.projects;
  }
  async createClient(draft: ClientDraft): Promise<Client> {
    this.check();
    this.created.push(draft);
    return client('c3', draft.name);
  }
  async renameClient(id: string, name: string): Promise<Client> {
    this.check();
    return client(id, name);
  }
  async setClientArchived(id: string, archived: boolean): Promise<Client> {
    this.check();
    const found = this.clients.find((candidate) => candidate.id === id)!;
    return { ...found, archivedAt: archived ? ARCHIVED : null };
  }
  async createProject(draft: ProjectDraft): Promise<ProjectRecord> {
    this.check();
    return { id: 'p9', archivedAt: null, ...draft };
  }
  async updateProject(id: string, patch: Partial<ProjectDraft>): Promise<ProjectRecord> {
    this.check();
    this.updates.push({ id, patch });
    const found = this.projects.find((candidate) => candidate.id === id)!;
    return { ...found, ...patch };
  }
  async setProjectArchived(id: string, archived: boolean): Promise<ProjectRecord> {
    this.check();
    const found = this.projects.find((candidate) => candidate.id === id)!;
    return { ...found, archivedAt: archived ? ARCHIVED : null };
  }
}

async function setup(): Promise<{
  store: ProjectsStore;
  repository: FakeRepository;
  feedback: RecordingFeedback;
}> {
  const feedback = new RecordingFeedback();
  const repository = new FakeRepository();
  TestBed.configureTestingModule({
    providers: [
      ProjectsStore,
      { provide: ProjectRepository, useValue: repository },
      { provide: USER_FEEDBACK, useValue: feedback },
    ],
  });
  const store = TestBed.inject(ProjectsStore);
  await store.load();
  return { store, repository, feedback };
}

describe('ProjectsStore', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('gruppiert Projekte unter ihren Kunden', async () => {
    const { store } = await setup();

    expect(store.groups().map((group) => group.client.name)).toEqual([
      'Sandmann GmbH',
      'Nordlicht Medien',
    ]);
    expect(store.groups()[0].projects.map((p) => p.name)).toEqual(['Relaunch']);
  });

  it('haelt Archiviertes aus dem Weg, sagt aber wie viel', async () => {
    const { store } = await setup();

    expect(store.groups()[0].hiddenProjects).toBe(1);
    expect(store.activeProjectCount()).toBe(2);

    store.showArchived.set(true);

    expect(store.groups()[0].projects.map((p) => p.name)).toEqual(['Relaunch', 'Wartung']);
    expect(store.groups()[0].hiddenProjects).toBe(0);
  });

  it('blendet einen archivierten Kunden samt Projekten aus', async () => {
    const { store, repository } = await setup();
    repository.clients = [client('c1', 'Sandmann GmbH'), client('c2', 'Nordlicht Medien', true)];
    await store.load();

    expect(store.groups().map((group) => group.client.name)).toEqual(['Sandmann GmbH']);

    store.showArchived.set(true);
    expect(store.groups()).toHaveLength(2);
  });

  it('laesst neue Projekte nur unter aktiven Kunden anlegen', async () => {
    const { store, repository } = await setup();
    repository.clients = [client('c1', 'Sandmann GmbH'), client('c2', 'Nordlicht Medien', true)];
    await store.load();

    expect(store.assignableClients().map((c) => c.name)).toEqual(['Sandmann GmbH']);
  });

  it('sortiert einen neu angelegten Kunden gleich an die richtige Stelle', async () => {
    const { store } = await setup();

    // 'Bäcker' muss nach deutscher Sortierung vor 'Nordlicht' stehen — und zwar
    // sofort, nicht erst nach dem naechsten Laden.
    await expect(store.createClient({ name: 'Bäcker & Sohn' })).resolves.toMatchObject({
      name: 'Bäcker & Sohn',
    });

    expect(store.clients().map((c) => c.name)).toEqual([
      'Bäcker & Sohn',
      'Nordlicht Medien',
      'Sandmann GmbH',
    ]);
  });

  // Der Store meldet jeden Erfolg selbst.
  it('meldet Anlegen, Umbenennen, Speichern und Archivieren als Erfolgs-Toast', async () => {
    const { store, feedback } = await setup();

    await store.createClient({ name: 'Neuer Kunde' });
    await store.renameClient('c1', 'Sandmann AG');
    await store.createProject({ clientId: 'c1', name: 'Wartung 2', color: '#2F5BD3', hourlyRate: null });
    await store.updateProject('p1', { name: 'Relaunch 2027' });
    expect(feedback.texts('success')).toEqual([
      'Kunde Neuer Kunde angelegt.',
      'Kunde heißt jetzt Sandmann AG.',
      'Projekt Wartung 2 angelegt.',
      'Projekt Relaunch 2027 gespeichert.',
    ]);

    await store.setProjectArchived('p1', true);
    expect(feedback.texts('success')[4]).toContain('Zeiten bleiben erhalten');

    await store.setClientArchived('c1', true);
    expect(feedback.texts('success')[5]).toContain('nicht mehr im Wochenraster');
  });

  // Die Inline-Zeile ist nicht modal — der Fehler kommt als Toast.
  it('meldet einen Fehlschlag als deutschen Satz im Toast und als null/false', async () => {
    const { store, repository, feedback } = await setup();
    repository.failWith = new RepositoryError('offline', 'TypeError: Failed to fetch');

    // Nur bei Erfolg darf die Zeile ihre Bearbeitung beenden, sonst waere die
    // Eingabe weg.
    await expect(store.createClient({ name: 'Neuer Kunde' })).resolves.toBeNull();
    await expect(store.renameClient('c1', 'X')).resolves.toBe(false);
    await expect(store.updateProject('p1', { name: 'X' })).resolves.toBe(false);
    expect(store.clients().map((c) => c.name)).not.toContain('Neuer Kunde');
    expect(feedback.messages.map(({ kind, message, detail }) => [kind, message, detail])).toEqual([
      ['error', 'Der Kunde konnte nicht angelegt werden.', 'Keine Verbindung zum Server.'],
      ['error', 'Der Kunde konnte nicht umbenannt werden.', 'Keine Verbindung zum Server.'],
      ['error', 'Das Projekt konnte nicht gespeichert werden.', 'Keine Verbindung zum Server.'],
    ]);
    expect(store.syncError()).toBe(true);
  });

  it('nennt beim Loeschversuch den Grund, statt nur „ging nicht"', async () => {
    const { store, repository, feedback } = await setup();
    repository.failWith = new RepositoryError('in-use', 'violates foreign key constraint 23503');

    await store.setProjectArchived('p1', true);

    // Ohne offenen Dialog: als Fehler-Toast. Abgelehnt ist kein Sync-Fehler.
    expect(feedback.messages).toEqual([
      {
        id: 1,
        kind: 'error',
        message: 'Das Projekt konnte nicht archiviert werden.',
        detail: 'Daran hängen noch Daten. Archivieren statt löschen.',
      },
    ]);
    expect(store.syncError()).toBe(false);
  });

  it('meldet einen Ladefehler und laesst die Liste leer statt halb', async () => {
    const repository = new FakeRepository();
    const feedback = new RecordingFeedback();
    repository.listClients = async () => {
      throw new RepositoryError('session-expired', 'JWT expired');
    };
    TestBed.configureTestingModule({
      providers: [
        ProjectsStore,
        { provide: ProjectRepository, useValue: repository },
        { provide: USER_FEEDBACK, useValue: feedback },
      ],
    });
    const store = TestBed.inject(ProjectsStore);

    await store.load();

    expect(store.loadError()).toContain('Anmeldung war abgelaufen');
    expect(feedback.texts('error')[0]).toContain(
      'Kunden und Projekte konnten nicht geladen werden.',
    );
    expect(store.clients()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  it('schreibt eine Aenderung am Projekt in die Liste zurueck', async () => {
    const { store, repository } = await setup();

    await expect(
      store.updateProject('p1', { name: 'Relaunch 2027', hourlyRate: 120 }),
    ).resolves.toBe(true);

    expect(repository.updates).toEqual([
      { id: 'p1', patch: { name: 'Relaunch 2027', hourlyRate: 120 } },
    ]);
    const changed = store.projects().find((p) => p.id === 'p1')!;
    expect(changed.name).toBe('Relaunch 2027');
    expect(changed.hourlyRate).toBe(120);
  });

  it('holt Archiviertes zurueck', async () => {
    const { store, feedback } = await setup();

    await expect(store.setProjectArchived('p2', false)).resolves.toBe(true);

    expect(store.projects().find((p) => p.id === 'p2')!.archivedAt).toBeNull();
    expect(feedback.texts('success')).toEqual(['Projekt Wartung ist wieder aktiv.']);
  });
});
