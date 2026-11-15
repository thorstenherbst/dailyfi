import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { ProjectRepository } from '@lib/projects/data-access';
import { Client, ClientDraft, ProjectDraft, ProjectRecord } from '@lib/projects/domain';
import { RepositoryError, USER_FEEDBACK } from '@lib/shared/data-access-supabase';
import { LEAVE_WITHOUT_ASKING } from '@lib/shared/util-edit';
import { ToastService } from '@lib/shared/ui';

import { ProjectsPage } from './projects-page';

function client(id: string, name: string, archived = false): Client {
  return { id, name, archivedAt: archived ? new Date('2026-09-20T10:00:00Z') : null };
}

const RELAUNCH: ProjectRecord = {
  id: 'p1',
  clientId: 'c1',
  name: 'Relaunch',
  color: '#A8412A',
  hourlyRate: 95,
  archivedAt: null,
};

const WARTUNG: ProjectRecord = {
  id: 'p2',
  clientId: 'c1',
  name: 'Wartung',
  color: '#1A7A4A',
  hourlyRate: null,
  archivedAt: null,
};

class FakeRepository implements Partial<ProjectRepository> {
  clients: Client[] = [client('c1', 'Sandmann GmbH')];
  projects: ProjectRecord[] = [RELAUNCH];
  failWith: RepositoryError | null = null;

  createdClients: ClientDraft[] = [];
  renamedClients: Array<{ id: string; name: string }> = [];
  createdProjects: ProjectDraft[] = [];
  updatedProjects: Array<{ id: string; patch: Partial<ProjectDraft> }> = [];
  archivedProjects: Array<{ id: string; archived: boolean }> = [];
  archivedClients: Array<{ id: string; archived: boolean }> = [];
  failLoad: unknown = null;
  /** Haelt das Laden an, bis das Versprechen erfuellt ist. */
  loadGate: Promise<void> | null = null;
  /** Haelt Schreibzugriffe an (laufendes Speichern). */
  writeGate: Promise<void> | null = null;

  private async check(): Promise<void> {
    await this.writeGate;
    if (this.failWith) {
      throw this.failWith;
    }
  }

  async listClients(): Promise<Client[]> {
    await this.loadGate;
    if (this.failLoad) {
      throw this.failLoad;
    }
    return this.clients;
  }
  async listProjects(): Promise<ProjectRecord[]> {
    return this.projects;
  }
  async createClient(draft: ClientDraft): Promise<Client> {
    await this.check();
    this.createdClients.push(draft);
    return client('c9', draft.name);
  }
  async renameClient(id: string, name: string): Promise<Client> {
    await this.check();
    this.renamedClients.push({ id, name });
    return client(id, name);
  }
  async setClientArchived(id: string, archived: boolean): Promise<Client> {
    await this.check();
    this.archivedClients.push({ id, archived });
    return { ...this.clients.find((c) => c.id === id)!, archivedAt: archived ? new Date() : null };
  }
  async createProject(draft: ProjectDraft): Promise<ProjectRecord> {
    await this.check();
    this.createdProjects.push(draft);
    return { id: 'p9', archivedAt: null, ...draft };
  }
  async updateProject(id: string, patch: Partial<ProjectDraft>): Promise<ProjectRecord> {
    await this.check();
    this.updatedProjects.push({ id, patch });
    return { ...this.projects.find((p) => p.id === id)!, ...patch };
  }
  async setProjectArchived(id: string, archived: boolean): Promise<ProjectRecord> {
    await this.check();
    this.archivedProjects.push({ id, archived });
    return { ...this.projects.find((p) => p.id === id)!, archivedAt: archived ? new Date() : null };
  }
}

interface Harness {
  fixture: ComponentFixture<ProjectsPage>;
  element: HTMLElement;
  page: ProjectsPage;
  repository: FakeRepository;
  toasts: ToastService;
  settle(): Promise<void>;
  /** Zeile per `data-row` (`p:ID`, `c:ID`, `np:KUNDE`, `nc`). */
  row(key: string): HTMLElement;
  click(selector: string): Promise<void>;
  clickText(text: string, scope?: HTMLElement): Promise<void>;
  /** Tippen: Wert setzen und `input` (bzw. `change`) ausloesen. */
  type(key: string, field: 'name' | 'rate' | 'client', value: string): Promise<void>;
  /**
   * Wie ein Mensch: Zeichen fuer Zeichen ans Feld haengen, nach jedem `input`
   * und warten (Leerzeichen eingeschlossen). Liefert den Fokus nach jedem Zeichen.
   */
  typeSlowly(input: HTMLInputElement, text: string): Promise<Array<Element | null>>;
  /** Enter im Feld: Formular abschicken. */
  submit(key: string): Promise<void>;
  key(target: Element, key: string): Promise<void>;
  pickColor(key: string, name: string): Promise<void>;
  notice(key: string): HTMLElement | null;
  edit(key: string): Promise<void>;
}

async function setup(configure: (fake: FakeRepository) => void = () => {}): Promise<Harness> {
  const repository = new FakeRepository();
  configure(repository);

  await TestBed.configureTestingModule({
    imports: [ProjectsPage],
    providers: [
      { provide: ProjectRepository, useValue: repository },
      // Wie in der App: Store-Meldungen landen in den Toasts.
      { provide: USER_FEEDBACK, useExisting: ToastService },
      // Wie in der App: Anmeldeseiten ohne Rueckfrage.
      { provide: LEAVE_WITHOUT_ASKING, useValue: (url: string) => url.startsWith('/login') },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ProjectsPage);
  const element: HTMLElement = fixture.nativeElement;
  // Fokus gibt es nur im Dokument.
  document.body.appendChild(element);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };
  const row = (key: string): HTMLElement => {
    const found = element.querySelector<HTMLElement>(`[data-row="${key}"]`);
    if (!found) {
      throw new Error(`Keine Zeile ${key}`);
    }
    return found;
  };
  const fieldOf = (key: string, field: string): HTMLInputElement =>
    row(key).querySelector<HTMLInputElement>(`[data-field="${field}"]`)!;

  const harness: Harness = {
    fixture,
    element,
    page: fixture.componentInstance,
    repository,
    toasts: TestBed.inject(ToastService),
    settle,
    row,
    async click(selector: string): Promise<void> {
      const target = element.querySelector<HTMLElement>(selector);
      if (!target) {
        throw new Error(`Nichts unter ${selector}`);
      }
      target.click();
      await settle();
    },
    async clickText(text: string, scope: HTMLElement = element): Promise<void> {
      const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.textContent?.trim() === text,
      );
      if (!button) {
        throw new Error(`Kein Knopf mit Text „${text}"`);
      }
      button.click();
      await settle();
    },
    async type(key: string, field: 'name' | 'rate' | 'client', value: string): Promise<void> {
      const input = fieldOf(key, field);
      input.value = value;
      input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
      await settle();
    },
    async typeSlowly(input: HTMLInputElement, text: string): Promise<Array<Element | null>> {
      const focus: Array<Element | null> = [];
      for (const char of text) {
        // Getippt wird nur, wo der Fokus ist — wie im Browser.
        if (document.activeElement !== input) {
          focus.push(document.activeElement);
          continue;
        }
        input.value += char;
        input.dispatchEvent(new Event('input'));
        await settle();
        focus.push(document.activeElement);
      }
      return focus;
    },
    async submit(key: string): Promise<void> {
      row(key).querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();
    },
    async key(target: Element, key: string): Promise<void> {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await settle();
    },
    async pickColor(key: string, name: string): Promise<void> {
      const label = [...row(key).querySelectorAll('.swatch')].find(
        (candidate) => candidate.textContent?.trim() === name,
      );
      const radio = label!.querySelector<HTMLInputElement>('input')!;
      radio.checked = true;
      radio.dispatchEvent(new Event('change'));
      await settle();
    },
    notice(key: string): HTMLElement | null {
      return row(key).querySelector<HTMLElement>('.row-notice');
    },
    async edit(key: string): Promise<void> {
      const pencil = row(key).querySelector<HTMLButtonElement>('.row-edit')!;
      pencil.focus();
      pencil.click();
      await settle();
    },
  };
  return harness;
}

const errorTexts = (harness: Harness) =>
  harness.toasts.toasts().map((toast) => [toast.kind, toast.message, toast.detail ?? undefined]);

describe('ProjectsPage', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  describe('Liste', () => {
    it('zeigt Kunden als Gruppen mit ihren Projekten — als echte Tabelle', async () => {
      const { element, row } = await setup();

      expect(element.querySelector('table caption')?.textContent).toContain('Kunden');
      expect(
        [...element.querySelectorAll('thead th[scope="col"]')].map((th) => th.textContent?.trim()),
      ).toEqual(['Projekt', 'Farbe', 'Stundensatz', 'Aktionen']);
      expect(row('c:c1').querySelector('th[scope="rowgroup"]')?.textContent).toContain(
        'Sandmann GmbH',
      );
      expect(row('p:p1').querySelector('th[scope="row"]')?.textContent).toContain('Relaunch');
      // Kunde und seine Projekte teilen sich ein <tbody>.
      expect(row('p:p1').closest('tbody')).toBe(row('c:c1').closest('tbody'));
    });

    it('nennt die Farbe als Text, nicht nur als Punkt', async () => {
      const { row } = await setup();

      // WCAG 1.4.1: Farbe darf nie die einzige Information sein.
      expect(row('p:p1').querySelector('.color-name')?.textContent?.trim()).toBe('Kupfer');
      expect(row('p:p1').querySelector('.num')?.textContent?.trim()).toBe('95,00 €/h');
    });

    it('zeigt Zeilen-Aktionen als Icon-Buttons mit Namen und Tooltip', async () => {
      const { row } = await setup();

      const pencil = row('p:p1').querySelector<HTMLButtonElement>('.row-edit')!;
      const archive = row('p:p1').querySelector<HTMLButtonElement>('.row-archive')!;
      expect(pencil.getAttribute('aria-label')).toBe('Projekt Relaunch bearbeiten');
      expect(pencil.dataset['tooltip']).toBe('Bearbeiten');
      expect(archive.getAttribute('aria-label')).toBe('Projekt Relaunch archivieren');
      expect(archive.dataset['tooltip']).toBe('Archivieren');
      expect(pencil.classList).toContain('btn-icon');
      expect(row('c:c1').querySelector('.row-edit')?.getAttribute('aria-label')).toBe(
        'Kunde Sandmann GmbH umbenennen',
      );
    });

    it('stellt die Tooltips der Zeile links neben die Knopfgruppe', async () => {
      const { row } = await setup();

      // Ueber dem Knopf laege er auf der Zeile darueber (siehe _tooltip.scss).
      expect(row('p:p1').querySelector('.row-edit')?.closest('td')?.classList).toContain(
        'tooltip-group',
      );
      expect(row('c:c1').querySelector('.row-edit')?.closest('td')?.classList).toContain(
        'tooltip-group',
      );
    });

    it('zeigt den Tooltip beim Hovern und blendet ihn mit Esc aus — auch ohne Fokus', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const harness = await setup();
      const pencil = harness.row('p:p1').querySelector<HTMLButtonElement>('.row-edit')!;
      const add = vi.spyOn(document, 'addEventListener');
      const remove = vi.spyOn(document, 'removeEventListener');

      pencil.dispatchEvent(new MouseEvent('mouseenter'));
      harness.fixture.detectChanges();
      expect(pencil.classList).toContain('tooltip-on');
      expect(document.activeElement).not.toBe(pencil);

      // Der Knopf hat keinen Fokus — Esc geht ans Dokument.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      harness.fixture.detectChanges();
      expect(pencil.classList).not.toContain('tooltip-on');

      // Zeiger weg: der Listener auch; danach steht er wieder bereit.
      pencil.dispatchEvent(new MouseEvent('mouseleave'));
      const listener = add.mock.calls.find(([type]) => type === 'keydown')?.[1];
      expect(listener).toBeDefined();
      expect(remove).toHaveBeenCalledWith('keydown', listener);
      vi.advanceTimersByTime(500);
      pencil.dispatchEvent(new MouseEvent('mouseenter'));
      harness.fixture.detectChanges();
      expect(pencil.classList).toContain('tooltip-on');
      pencil.dispatchEvent(new MouseEvent('mouseleave'));
      vi.useRealTimers();
    });

    it('laesst den Tooltip nach dem Verlassen kurz stehen und zeigt hoechstens einen', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const harness = await setup();
      const pencil = harness.row('p:p1').querySelector<HTMLButtonElement>('.row-edit')!;
      const archive = harness.row('p:p1').querySelector<HTMLButtonElement>('.row-archive')!;

      archive.dispatchEvent(new MouseEvent('mouseenter'));
      archive.dispatchEvent(new MouseEvent('mouseleave'));
      harness.fixture.detectChanges();
      // Auf dem Umweg zum Tooltip: noch da.
      vi.advanceTimersByTime(200);
      harness.fixture.detectChanges();
      expect(archive.classList).toContain('tooltip-on');
      // Wieder darauf (der Tooltip gehoert zum Knopf): bleibt.
      archive.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(1000);
      harness.fixture.detectChanges();
      expect(archive.classList).toContain('tooltip-on');

      // Ein anderer Knopf: nur noch dessen Tooltip.
      archive.dispatchEvent(new MouseEvent('mouseleave'));
      pencil.dispatchEvent(new MouseEvent('mouseenter'));
      harness.fixture.detectChanges();
      expect(pencil.classList).toContain('tooltip-on');
      expect(archive.classList).not.toContain('tooltip-on');
      pencil.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(500);
      harness.fixture.detectChanges();
      expect(pencil.classList).not.toContain('tooltip-on');
      vi.useRealTimers();
    });

    it('blendet einen Tooltip am fokussierten Knopf mit Esc aus, bis der Fokus geht', async () => {
      const harness = await setup();
      const pencil = harness.row('p:p1').querySelector<HTMLButtonElement>('.row-edit')!;
      vi.spyOn(pencil, 'matches').mockReturnValue(true); // :focus-visible
      pencil.focus();
      harness.fixture.detectChanges();
      expect(pencil.classList).toContain('tooltip-on');

      await harness.key(pencil, 'Escape');
      expect(pencil.classList).not.toContain('tooltip-on');

      pencil.blur();
      pencil.focus();
      harness.fixture.detectChanges();
      expect(pencil.classList).toContain('tooltip-on');
    });

    // Angepasst: frueher „Projekt anlegen" im Kopf, gesperrt ohne Kunden.
    it('sagt beim leeren Stand, was zuerst zu tun ist, und bietet nur „Neuer Kunde"', async () => {
      const { element } = await setup((fake) => {
        fake.clients = [];
        fake.projects = [];
      });

      expect(element.querySelector('.empty')?.textContent).toContain('Noch keine Kunden');
      // Ohne Kunden gibt es nichts, wo ein Projekt hingehoerte.
      expect(element.querySelector('[data-row^="np:"]')).toBeNull();
      expect(
        element.querySelector('[data-row="nc"] input')?.getAttribute('placeholder'),
      ).toBe('Neuer Kunde …');
    });

    it('endet jede aktive Kundengruppe mit einer Anlege-Leerzeile', async () => {
      const harness = await setup((fake) => {
        fake.clients = [client('c1', 'Sandmann GmbH'), client('c2', 'Alt', true)];
      });
      const { element, row } = harness;
      const input = row('np:c1').querySelector<HTMLInputElement>('input')!;

      expect(input.getAttribute('aria-label')).toBe('Neues Projekt für Sandmann GmbH');
      expect(input.placeholder).toBe('Neues Projekt für Sandmann GmbH …');
      expect(row('np:c1').closest('tbody')).toBe(row('c:c1').closest('tbody'));
      // Eingeklappt: nur das Namensfeld.
      expect(row('np:c1').querySelector('fieldset')).toBeNull();
      // Unter archivierten Kunden entsteht nichts Neues.
      element.querySelector<HTMLInputElement>('.filter input')!.click();
      await harness.settle();
      expect(row('c:c2')).toBeTruthy();
      expect(element.querySelector('[data-row="np:c2"]')).toBeNull();
    });

    it('„+ Kunde" im Kopf fuehrt in die Leerzeile „Neuer Kunde"', async () => {
      const harness = await setup();

      await harness.clickText('Kunde anlegen');

      expect(document.activeElement).toBe(harness.row('nc').querySelector('input'));
    });
  });

  describe('Kunde anlegen und umbenennen', () => {
    // Aus „legt einen Kunden über den Dialog an".
    it('legt einen Kunden in der Leerzeile an — Enter speichert', async () => {
      const harness = await setup();

      await harness.type('nc', 'name', 'Bäcker & Sohn');
      expect(harness.row('nc').classList).toContain('editing');
      await harness.submit('nc');

      expect(harness.repository.createdClients).toEqual([{ name: 'Bäcker & Sohn' }]);
      // Die Leerzeile ist wieder bereit.
      expect(harness.row('nc').classList).not.toContain('editing');
      expect(harness.row('nc').querySelector<HTMLInputElement>('input')!.value).toBe('');
    });

    // Aus „weist einen leeren Namen ab, ohne den Server zu fragen".
    it('weist einen leeren Namen ab, ohne den Server zu fragen — Text am Feld', async () => {
      const harness = await setup();

      await harness.type('nc', 'name', 'x');
      await harness.type('nc', 'name', '   ');
      await harness.submit('nc');

      expect(harness.repository.createdClients).toEqual([]);
      const input = harness.row('nc').querySelector<HTMLInputElement>('[data-field="name"]')!;
      expect(input.getAttribute('aria-invalid')).toBe('true');
      const error = document.getElementById(input.getAttribute('aria-describedby')!);
      expect(error?.textContent).toContain('Bitte einen Namen eingeben.');
      expect(document.activeElement).toBe(input);
    });

    it('benennt einen Kunden in der Zeile um', async () => {
      const harness = await setup();

      await harness.edit('c:c1');
      const input = harness.row('c:c1').querySelector<HTMLInputElement>('[data-field="name"]')!;
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('Sandmann GmbH');
      expect(harness.row('c:c1').querySelector('label')?.textContent?.trim()).toBe('Kundenname');

      await harness.type('c:c1', 'name', 'Sandmann AG');
      await harness.submit('c:c1');

      expect(harness.repository.renamedClients).toEqual([{ id: 'c1', name: 'Sandmann AG' }]);
      expect(errorTexts(harness)).toEqual([['success', 'Kunde heißt jetzt Sandmann AG.', undefined]]);
      expect(document.activeElement).toBe(harness.row('c:c1').querySelector('.row-edit'));
    });

    it('laesst bei einem Serverfehler beim Umbenennen die Zeile offen und meldet per Toast', async () => {
      const harness = await setup();
      await harness.edit('c:c1');
      await harness.type('c:c1', 'name', 'Sandmann AG');
      harness.repository.failWith = new RepositoryError('offline', 'Failed to fetch');

      await harness.submit('c:c1');

      expect(harness.row('c:c1').classList).toContain('editing');
      expect(harness.row('c:c1').querySelector<HTMLInputElement>('input')!.value).toBe(
        'Sandmann AG',
      );
      expect(errorTexts(harness)).toEqual([
        ['error', 'Der Kunde konnte nicht umbenannt werden.', 'Keine Verbindung zum Server.'],
      ]);
    });

    it('weist auch beim Umbenennen einen leeren Namen ab', async () => {
      const harness = await setup();
      await harness.edit('c:c1');

      await harness.type('c:c1', 'name', '');
      await harness.submit('c:c1');

      expect(harness.repository.renamedClients).toEqual([]);
      expect(harness.row('c:c1').querySelector('.form-error')?.textContent).toContain(
        'Bitte einen Namen eingeben.',
      );
    });

    // Aus „meldet das Anlegen als Erfolgs-Toast, erst wenn der Dialog zu ist".
    it('meldet das Anlegen als Erfolgs-Toast und setzt den Fokus auf den Stift der neuen Zeile', async () => {
      const harness = await setup();

      await harness.type('nc', 'name', 'Neuer Kunde');
      await harness.submit('nc');
      await harness.settle();

      expect(errorTexts(harness)).toEqual([['success', 'Kunde Neuer Kunde angelegt.', undefined]]);
      expect(document.activeElement).toBe(harness.row('c:c9').querySelector('.row-edit'));
    });

    // Aus „laesst den Dialog bei einem Serverfehler offen und die Eingabe stehen".
    it('laesst bei einem Serverfehler die Zeile offen und die Eingabe stehen — Fehler als Toast', async () => {
      const harness = await setup((fake) => {
        fake.failWith = new RepositoryError('offline', 'TypeError: Failed to fetch');
      });

      await harness.type('nc', 'name', 'Bäcker & Sohn');
      await harness.submit('nc');

      // Ginge sie zu, waere die Eingabe weg.
      expect(harness.row('nc').classList).toContain('editing');
      expect(harness.row('nc').querySelector<HTMLInputElement>('input')!.value).toBe(
        'Bäcker & Sohn',
      );
      expect(errorTexts(harness)).toEqual([
        ['error', 'Der Kunde konnte nicht angelegt werden.', 'Keine Verbindung zum Server.'],
      ]);
      expect(harness.row('nc').querySelector('.form-error')).toBeNull();
    });
  });

  describe('Projekt anlegen', () => {
    // Aus „legt ein Projekt mit Komma-Stundensatz an".
    it('legt ein Projekt mit Komma-Stundensatz und gewaehlter Farbe an', async () => {
      const harness = await setup();

      await harness.type('np:c1', 'name', 'Wartung');
      await harness.type('np:c1', 'rate', '110,50');
      await harness.pickColor('np:c1', 'Petrol');
      await harness.submit('np:c1');

      expect(harness.repository.createdProjects).toEqual([
        { clientId: 'c1', name: 'Wartung', color: '#0D7380', hourlyRate: 110.5 },
      ]);
      expect(errorTexts(harness)).toEqual([['success', 'Projekt Wartung angelegt.', undefined]]);
      // Fokus auf die neue Zeile, die Leerzeile ist wieder leer.
      expect(document.activeElement).toBe(harness.row('p:p9').querySelector('.row-edit'));
      expect(harness.row('np:c1').querySelector<HTMLInputElement>('input')!.value).toBe('');
    });

    // Aus „waehlt den einzigen Kunden gleich vor": die Leerzeile gehoert zur Gruppe.
    it('waehlt den Kunden der Gruppe vor und startet mit Kobalt', async () => {
      const harness = await setup();

      await harness.type('np:c1', 'name', 'W');

      expect(
        harness.row('np:c1').querySelector<HTMLSelectElement>('[data-field="client"]')!.value,
      ).toBe('c1');
      const checked = harness.row('np:c1').querySelector<HTMLInputElement>('input[type=radio]:checked');
      expect(checked?.closest('.swatch')?.textContent?.trim()).toBe('Kobalt');
    });

    // Aus „nimmt keinen unsinnigen Stundensatz an".
    it('nimmt keinen unsinnigen Stundensatz an — Text am Feld, Fokus dorthin', async () => {
      const harness = await setup();

      await harness.type('np:c1', 'name', 'Wartung');
      await harness.type('np:c1', 'rate', 'neunzig');
      await harness.submit('np:c1');

      expect(harness.repository.createdProjects).toEqual([]);
      const rate = harness.row('np:c1').querySelector<HTMLInputElement>('[data-field="rate"]')!;
      expect(rate.getAttribute('aria-invalid')).toBe('true');
      const describedBy = rate.getAttribute('aria-describedby')!.split(' ');
      expect(document.getElementById(describedBy[0])?.textContent).toContain('Zahl');
      // Der Hinweis zum Format bleibt verbunden.
      expect(document.getElementById(describedBy[1])?.textContent).toContain('Komma erlaubt');
      expect(document.activeElement).toBe(rate);

      // Korrigiert: der Fehler geht mit der Eingabe.
      await harness.type('np:c1', 'rate', '90');
      expect(rate.getAttribute('aria-invalid')).toBeNull();
    });

    it('laesst bei einem Serverfehler die Leerzeile offen, mit allen Eingaben — Fehler als Toast', async () => {
      const harness = await setup();
      await harness.type('np:c1', 'name', 'Kampagne');
      await harness.type('np:c1', 'rate', '120,50');
      harness.repository.failWith = new RepositoryError('offline', 'Failed to fetch');

      await harness.submit('np:c1');

      expect(harness.repository.createdProjects).toEqual([]);
      expect(harness.row('np:c1').classList).toContain('editing');
      const name = harness.row('np:c1').querySelector<HTMLInputElement>('[data-field="name"]')!;
      const rate = harness.row('np:c1').querySelector<HTMLInputElement>('[data-field="rate"]')!;
      expect([name.value, rate.value]).toEqual(['Kampagne', '120,50']);
      expect(errorTexts(harness)).toEqual([
        ['error', 'Das Projekt konnte nicht angelegt werden.', 'Keine Verbindung zum Server.'],
      ]);
    });

    it('nennt einen negativen Stundensatz eigens', async () => {
      const harness = await setup();
      await harness.type('np:c1', 'name', 'Kampagne');
      await harness.type('np:c1', 'rate', '-5');

      await harness.submit('np:c1');

      expect(harness.repository.createdProjects).toEqual([]);
      expect(harness.row('np:c1').querySelector('.form-error')?.textContent).toContain(
        'Der Stundensatz darf nicht negativ sein.',
      );
    });

    it('verlangt einen Projektnamen', async () => {
      const harness = await setup();

      await harness.type('np:c1', 'name', 'x');
      await harness.type('np:c1', 'name', '');
      await harness.submit('np:c1');

      expect(harness.repository.createdProjects).toEqual([]);
      expect(harness.row('np:c1').querySelector('.form-error')?.textContent).toContain(
        'Bitte einen Projektnamen eingeben.',
      );
    });

    it('Esc ohne Eingabe klappt die Leerzeile wieder ein, der Fokus bleibt im Feld', async () => {
      const harness = await setup();
      await harness.type('np:c1', 'name', 'x');
      await harness.type('np:c1', 'name', '');
      const input = harness.row('np:c1').querySelector<HTMLInputElement>('input')!;
      input.focus();

      await harness.key(input, 'Escape');

      expect(harness.row('np:c1').classList).not.toContain('editing');
      expect(document.activeElement).toBe(input);
    });
  });

  describe('Projekt bearbeiten', () => {
    it('oeffnet die Zeile mit Feldern und Labels, Fokus ins Namensfeld', async () => {
      const harness = await setup();

      await harness.edit('p:p1');

      const row = harness.row('p:p1');
      expect(row.classList).toContain('editing');
      const name = row.querySelector<HTMLInputElement>('[data-field="name"]')!;
      expect(document.activeElement).toBe(name);
      expect(name.value).toBe('Relaunch');
      expect(row.querySelector<HTMLInputElement>('[data-field="rate"]')!.value).toBe('95,00');
      expect([...row.querySelectorAll('label.row-label')].map((l) => l.textContent?.trim())).toEqual(
        ['Projektname', 'Stundensatz', 'Kunde'],
      );
      expect(row.querySelector('fieldset legend')?.textContent).toBe('Farbe');
    });

    it('speichert per Enter nur das Getippte, meldet es und gibt den Fokus an den Stift', async () => {
      const harness = await setup();
      await harness.edit('p:p1');

      await harness.type('p:p1', 'name', 'Relaunch 2027');
      await harness.submit('p:p1');

      expect(harness.repository.updatedProjects).toEqual([
        { id: 'p1', patch: { name: 'Relaunch 2027' } },
      ]);
      expect(errorTexts(harness)).toEqual([
        ['success', 'Projekt Relaunch 2027 gespeichert.', undefined],
      ]);
      expect(harness.row('p:p1').classList).not.toContain('editing');
      expect(document.activeElement).toBe(harness.row('p:p1').querySelector('.row-edit'));
    });

    it('schreibt einen Satz mit Komma und einen anderen Kunden', async () => {
      const harness = await setup((fake) => {
        fake.clients = [client('c1', 'Sandmann GmbH'), client('c2', 'Nordlicht')];
      });
      await harness.edit('p:p1');

      await harness.type('p:p1', 'rate', '120,50');
      await harness.type('p:p1', 'client', 'c2');
      await harness.submit('p:p1');

      expect(harness.repository.updatedProjects).toEqual([
        { id: 'p1', patch: { hourlyRate: 120.5, clientId: 'c2' } },
      ]);
    });

    it('Enter ohne Aenderung beendet nur, ohne zu schreiben', async () => {
      const harness = await setup();
      await harness.edit('p:p1');

      await harness.submit('p:p1');

      expect(harness.repository.updatedProjects).toEqual([]);
      expect(harness.row('p:p1').classList).not.toContain('editing');
      expect(document.activeElement).toBe(harness.row('p:p1').querySelector('.row-edit'));
    });

    it('verlangt auch beim Bearbeiten einen Namen', async () => {
      const harness = await setup();
      await harness.edit('p:p1');

      await harness.type('p:p1', 'name', ' ');
      await harness.submit('p:p1');

      expect(harness.repository.updatedProjects).toEqual([]);
      expect(harness.row('p:p1').querySelector('.form-error')?.textContent).toContain(
        'Bitte einen Projektnamen eingeben.',
      );
    });

    it('Esc ohne Aenderung beendet die Bearbeitung und gibt den Fokus an den Stift', async () => {
      const harness = await setup();
      await harness.edit('p:p1');

      await harness.key(harness.row('p:p1').querySelector('input')!, 'Escape');

      expect(harness.row('p:p1').classList).not.toContain('editing');
      expect(document.activeElement).toBe(harness.row('p:p1').querySelector('.row-edit'));
    });

    it('Esc mit Aenderung zeigt den Hinweis in der Zeile, Fokus auf „Speichern"', async () => {
      const harness = await setup();
      await harness.edit('p:p1');
      await harness.type('p:p1', 'name', 'X');

      await harness.key(harness.row('p:p1').querySelector('input')!, 'Escape');

      const notice = harness.notice('p:p1')!;
      expect(notice).not.toBeNull();
      expect(harness.row('p:p1').classList).toContain('editing');
      const live = notice.querySelector('[role="status"]')!;
      expect(live.getAttribute('aria-live')).toBe('polite');
      expect(live.textContent).toContain('Ungespeicherte Änderungen');
      expect(live.textContent).toContain('danach endet die Bearbeitung');
      // Die Knoepfe stehen neben der Region, nicht darin (sonst doppelt angesagt).
      expect(live.querySelector('button')).toBeNull();
      expect(document.activeElement?.textContent?.trim()).toBe('Speichern');

      await harness.clickText('Verwerfen', notice);
      expect(harness.row('p:p1').classList).not.toContain('editing');
      expect(harness.repository.updatedProjects).toEqual([]);
      expect(document.activeElement).toBe(harness.row('p:p1').querySelector('.row-edit'));
    });

    it('„Abbrechen" verwirft ausdruecklich ohne Rueckfrage', async () => {
      const harness = await setup();
      await harness.edit('p:p1');
      await harness.type('p:p1', 'name', 'X');

      await harness.clickText('Abbrechen', harness.row('p:p1'));

      expect(harness.row('p:p1').classList).not.toContain('editing');
      expect(harness.row('p:p1').querySelector('th')?.textContent).toContain('Relaunch');
      expect(document.activeElement).toBe(harness.row('p:p1').querySelector('.row-edit'));
    });

    it('laesst bei einem Schreibfehler die Eingaben stehen und meldet per Toast', async () => {
      const harness = await setup();
      await harness.edit('p:p1');
      await harness.type('p:p1', 'rate', '99');
      harness.repository.failWith = new RepositoryError('offline', 'Failed to fetch');

      await harness.submit('p:p1');

      expect(harness.row('p:p1').classList).toContain('editing');
      expect(
        harness.row('p:p1').querySelector<HTMLInputElement>('[data-field="rate"]')!.value,
      ).toBe('99');
      expect(errorTexts(harness)).toEqual([
        ['error', 'Das Projekt konnte nicht gespeichert werden.', 'Keine Verbindung zum Server.'],
      ]);
    });
  });

  describe('Farbwahl', () => {
    it('ist eine Radiogruppe mit sechs benannten Farben und Haken am gewaehlten', async () => {
      const harness = await setup();
      await harness.edit('p:p1');

      const radios = [
        ...harness.row('p:p1').querySelectorAll<HTMLInputElement>('fieldset input[type="radio"]'),
      ];
      expect(radios).toHaveLength(6);
      // Ein Name: Pfeiltasten bewegen sich in einer Gruppe.
      expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
      expect(radios.map((radio) => radio.closest('label')?.textContent?.trim())).toEqual([
        'Kobalt',
        'Smaragd',
        'Senf',
        'Kupfer',
        'Graphit',
        'Petrol',
      ]);
      // Terrakotta (alt) wird als Kupfer gezeigt — gewaehlt und als Text daneben.
      expect(radios.find((radio) => radio.checked)?.closest('label')?.textContent?.trim()).toBe(
        'Kupfer',
      );
      expect(harness.row('p:p1').querySelector('.swatch-name')?.textContent).toBe('Kupfer');
    });

    it('waehlt bei einer Fremdfarbe Graphit vor und laesst den Wert unangetastet', async () => {
      const harness = await setup((fake) => {
        fake.projects = [{ ...RELAUNCH, color: '#123456' }];
      });
      await harness.edit('p:p1');

      const checked = harness.row('p:p1').querySelector<HTMLInputElement>('input[type=radio]:checked');
      expect(checked?.closest('label')?.textContent?.trim()).toBe('Graphit');
      expect(harness.row('p:p1').querySelector('.swatch-name')?.textContent).toBe(
        'Graphit (eigener Wert #123456)',
      );

      await harness.type('p:p1', 'name', 'Relaunch 2');
      await harness.submit('p:p1');
      // Keine Farbe im Schreibzugriff: der eigene Wert bleibt gespeichert.
      expect(harness.repository.updatedProjects).toEqual([
        { id: 'p1', patch: { name: 'Relaunch 2' } },
      ]);
    });

    it('laesst eine Fremdfarbe stehen, wenn die Wahl auf Graphit zurueckkehrt', async () => {
      const harness = await setup((fake) => {
        fake.projects = [{ ...RELAUNCH, color: '#123456' }];
      });
      await harness.edit('p:p1');

      await harness.pickColor('p:p1', 'Senf');
      await harness.pickColor('p:p1', 'Graphit');
      // Nichts umgefaerbt — also auch nichts ungespeichert.
      expect(harness.page['editor'].dirty()).toBe(false);

      await harness.type('p:p1', 'name', 'Relaunch 2');
      await harness.submit('p:p1');
      expect(harness.repository.updatedProjects).toEqual([
        { id: 'p1', patch: { name: 'Relaunch 2' } },
      ]);
    });

    it('schreibt eine neu gewaehlte Farbe', async () => {
      const harness = await setup((fake) => {
        fake.projects = [{ ...RELAUNCH, color: '#123456' }];
      });
      await harness.edit('p:p1');

      await harness.pickColor('p:p1', 'Senf');
      await harness.submit('p:p1');

      expect(harness.repository.updatedProjects).toEqual([
        { id: 'p1', patch: { color: '#8A6100' } },
      ]);
    });
  });

  describe('Eine Zeile gleichzeitig', () => {
    async function dirtyOnP1() {
      const harness = await setup((fake) => {
        fake.projects = [RELAUNCH, WARTUNG];
      });
      await harness.edit('p:p1');
      await harness.type('p:p1', 'name', 'Relaunch neu');
      return harness;
    }

    it('wechselt ohne Aenderungen sofort zur anderen Zeile', async () => {
      const harness = await setup((fake) => {
        fake.projects = [RELAUNCH, WARTUNG];
      });
      await harness.edit('p:p1');

      await harness.edit('p:p2');

      expect(harness.row('p:p1').classList).not.toContain('editing');
      expect(harness.row('p:p2').classList).toContain('editing');
      expect(harness.element.querySelectorAll('.editing')).toHaveLength(1);
      expect(document.activeElement).toBe(harness.row('p:p2').querySelector('[data-field="name"]'));
    });

    it('wechselt mit Aenderungen nicht, sondern zeigt den Hinweis in der aktiven Zeile', async () => {
      const harness = await dirtyOnP1();

      await harness.edit('p:p2');

      expect(harness.row('p:p1').classList).toContain('editing');
      expect(harness.row('p:p2').classList).not.toContain('editing');
      expect(harness.notice('p:p1')?.textContent).toContain('öffnet sich die gewählte Zeile');
      expect(document.activeElement?.classList).toContain('row-notice-save');
    });

    it('„Verwerfen" fuehrt danach die gewuenschte Bearbeitung aus', async () => {
      const harness = await dirtyOnP1();
      await harness.edit('p:p2');

      await harness.clickText('Verwerfen', harness.notice('p:p1')!);

      expect(harness.repository.updatedProjects).toEqual([]);
      expect(harness.row('p:p1').querySelector('th')?.textContent).toContain('Relaunch');
      expect(harness.row('p:p2').classList).toContain('editing');
      expect(document.activeElement).toBe(harness.row('p:p2').querySelector('[data-field="name"]'));
    });

    it('„Speichern" speichert und fuehrt danach die gewuenschte Bearbeitung aus', async () => {
      const harness = await dirtyOnP1();
      await harness.edit('p:p2');

      await harness.clickText('Speichern', harness.notice('p:p1')!);

      expect(harness.repository.updatedProjects).toEqual([
        { id: 'p1', patch: { name: 'Relaunch neu' } },
      ]);
      expect(harness.row('p:p2').classList).toContain('editing');
    });

    it('scheitert „Speichern" im Hinweis, bleibt alles stehen — Hinweis, Eingabe, Absicht', async () => {
      const harness = await dirtyOnP1();
      await harness.edit('p:p2');
      harness.repository.failWith = new RepositoryError('offline', 'Failed to fetch');

      await harness.clickText('Speichern', harness.notice('p:p1')!);

      expect(harness.row('p:p1').classList).toContain('editing');
      expect(harness.notice('p:p1')).not.toBeNull();
      expect(harness.row('p:p1').querySelector<HTMLInputElement>('input')!.value).toBe(
        'Relaunch neu',
      );
      expect(harness.toasts.toasts()[0]?.kind).toBe('error');
    });

    // Eine Absicht durch Tippen zieht den Fokus
    // nicht weg (WCAG 3.2.2) — kein Tastendruck loest einen Knopf aus, nichts
    // Getipptes geht verloren, ohne Entscheidung wird nichts geschrieben.
    it('Tippen in die Leerzeile, langsam und mit Leerzeichen: Fokus bleibt, alles bleibt stehen, nichts wird geschrieben', async () => {
      const harness = await dirtyOnP1();
      const input = harness.row('np:c1').querySelector<HTMLInputElement>('input')!;
      input.focus();

      const focus = await harness.typeSlowly(input, 'Neu B');

      expect(focus).toEqual([input, input, input, input, input]);
      expect(input.value).toBe('Neu B');
      expect(harness.repository.updatedProjects).toEqual([]);
      expect(harness.repository.createdProjects).toEqual([]);
      // Die Leerzeile wartet; der Hinweis steht in p1 und sagt den Weg dorthin.
      expect(harness.row('np:c1').classList).not.toContain('editing');
      expect(harness.row('p:p1').classList).toContain('editing');
      const text = harness.notice('p:p1')?.querySelector('[role="status"]')?.textContent;
      expect(text).toContain('beginnt das neue Projekt');
      expect(text).toContain('Umschalt+Tab');
      expect(document.activeElement).toBe(input);
    });

    it('… danach „Verwerfen": die Leerzeile geht mit dem ganzen Getippten auf', async () => {
      const harness = await dirtyOnP1();
      const input = harness.row('np:c1').querySelector<HTMLInputElement>('input')!;
      input.focus();
      await harness.typeSlowly(input, 'Neu B');

      await harness.clickText('Verwerfen', harness.notice('p:p1')!);

      expect(harness.repository.updatedProjects).toEqual([]);
      expect(harness.row('p:p1').classList).not.toContain('editing');
      const opened = harness.row('np:c1').querySelector<HTMLInputElement>('[data-field="name"]')!;
      expect(harness.row('np:c1').classList).toContain('editing');
      expect(opened.value).toBe('Neu B');
      expect(document.activeElement).toBe(opened);
    });

    it('… danach „Speichern": erst p1 geschrieben, dann die Leerzeile mit dem ganzen Getippten', async () => {
      const harness = await dirtyOnP1();
      const input = harness.row('np:c1').querySelector<HTMLInputElement>('input')!;
      input.focus();
      await harness.typeSlowly(input, 'Neu B');

      await harness.clickText('Speichern', harness.notice('p:p1')!);
      await harness.settle();

      expect(harness.repository.updatedProjects).toEqual([
        { id: 'p1', patch: { name: 'Relaunch neu' } },
      ]);
      const opened = harness.row('np:c1').querySelector<HTMLInputElement>('[data-field="name"]')!;
      expect(harness.row('np:c1').classList).toContain('editing');
      expect(opened.value).toBe('Neu B');
      expect(document.activeElement).toBe(opened);
    });

    it('„+ Kunde" bei Ungespeichertem: Fokus in „Neuer Kunde", Tippen bleibt dort, kein Schreiben', async () => {
      const harness = await dirtyOnP1();
      await harness.clickText('Kunde anlegen');
      const input = harness.row('nc').querySelector<HTMLInputElement>('input')!;
      expect(document.activeElement).toBe(input);

      const focus = await harness.typeSlowly(input, 'Neu B');

      expect(focus.every((element) => element === input)).toBe(true);
      expect(input.value).toBe('Neu B');
      expect(harness.repository.updatedProjects).toEqual([]);
      expect(harness.repository.createdClients).toEqual([]);
      expect(harness.notice('p:p1')?.textContent).toContain('beginnt der neue Kunde');

      await harness.clickText('Verwerfen', harness.notice('p:p1')!);
      expect(harness.row('nc').classList).toContain('editing');
      expect(harness.row('nc').querySelector<HTMLInputElement>('input')!.value).toBe('Neu B');
    });

    it('Tippen in eine Leerzeile waehrend eines Speicherns: Fokus bleibt, auch wenn es scheitert', async () => {
      const harness = await dirtyOnP1();
      let release!: () => void;
      harness.repository.writeGate = new Promise((resolve) => (release = resolve));
      harness.repository.failWith = new RepositoryError('offline', 'Failed to fetch');
      harness.row('p:p1').querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      const input = harness.row('np:c1').querySelector<HTMLInputElement>('input')!;
      input.focus();

      // Waehrend des Speicherns kein `whenStable` — es wartet auf das Speichern.
      for (const char of 'Ne') {
        input.value += char;
        input.dispatchEvent(new Event('input'));
        harness.fixture.detectChanges();
        await new Promise((resolve) => setTimeout(resolve));
        harness.fixture.detectChanges();
        expect(document.activeElement).toBe(input);
      }
      release();
      await harness.settle();
      await harness.settle();

      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('Ne');
      // Gescheitert: jetzt steht der Hinweis — angesagt, ohne Fokuswechsel.
      expect(harness.notice('p:p1')?.textContent).toContain('beginnt das neue Projekt');
    });

    it('vergisst die wartende Anlage, wenn p1 zurueckgetippt wird — das Getippte bleibt im Feld', async () => {
      const harness = await dirtyOnP1();
      const input = harness.row('np:c1').querySelector<HTMLInputElement>('input')!;
      input.focus();
      await harness.typeSlowly(input, 'Ne');

      await harness.type('p:p1', 'name', 'Relaunch');

      expect(harness.notice('p:p1')).toBeNull();
      expect(harness.page['editor'].pending()).toBeNull();
      expect(input.value).toBe('Ne');
    });

    // Wieder leer getippt — die Anlage hat sich erledigt.
    it('vergisst die wartende Anlage, wenn die Leerzeile wieder leer getippt wird — Fokus bleibt, nichts geschrieben', async () => {
      const harness = await dirtyOnP1();
      const input = harness.row('np:c1').querySelector<HTMLInputElement>('input')!;
      input.focus();
      await harness.typeSlowly(input, 'N');
      expect(harness.notice('p:p1')?.textContent).toContain('beginnt das neue Projekt');

      input.value = '';
      input.dispatchEvent(new Event('input'));
      await harness.settle();

      expect(harness.notice('p:p1')).toBeNull();
      expect(harness.page['editor'].pending()).toBeNull();
      expect(document.activeElement).toBe(input);
      expect(harness.repository.updatedProjects).toEqual([]);
      expect(harness.repository.createdProjects).toEqual([]);
      // p1 bleibt, wie sie war: offen, mit dem Getippten.
      expect(harness.row('p:p1').classList).toContain('editing');
      expect(harness.row('p:p1').querySelector<HTMLInputElement>('input')!.value).toBe(
        'Relaunch neu',
      );

      // Neu getippt: wieder geparkt — „Verwerfen" oeffnet mit dem neuen Text,
      // nicht mit dem alten ersten Zeichen.
      await harness.typeSlowly(input, 'W');
      expect(harness.notice('p:p1')?.textContent).toContain('beginnt das neue Projekt');
      await harness.clickText('Verwerfen', harness.notice('p:p1')!);

      const opened = harness.row('np:c1').querySelector<HTMLInputElement>('[data-field="name"]')!;
      expect(harness.row('np:c1').classList).toContain('editing');
      expect(opened.value).toBe('W');
      expect(harness.repository.updatedProjects).toEqual([]);
    });

    it('fragt beim Archivieren einer anderen Zeile erst nach dem Hinweis', async () => {
      const harness = await dirtyOnP1();

      await harness.click('[data-row="p:p2"] .row-archive');

      expect(harness.element.querySelector('dialog[open]')).toBeNull();
      expect(harness.notice('p:p1')?.textContent).toContain('Rückfrage zum Archivieren');

      await harness.clickText('Verwerfen', harness.notice('p:p1')!);
      expect(harness.element.querySelector('dialog[open]')?.textContent).toContain('Wartung');
      // Wie nach „Speichern": die eigene Zeile ist zu.
      expect(harness.row('p:p1').classList).not.toContain('editing');
    });

    // Der Oeffner des Modals (Hinweisknopf) ist
    // nach „Verwerfen" weg — Esc darf den Fokus nicht auf `body` fallen lassen.
    it('gibt den Fokus nach Esc im Archivieren-Modal an den Archivieren-Knopf, auch nach dem Hinweis', async () => {
      const harness = await dirtyOnP1();
      const archive = harness.row('p:p2').querySelector<HTMLButtonElement>('.row-archive')!;
      archive.focus();
      archive.click();
      await harness.settle();
      const discard = [
        ...harness.notice('p:p1')!.querySelectorAll<HTMLButtonElement>('button'),
      ].find((button) => button.textContent?.trim() === 'Verwerfen')!;
      discard.focus();
      discard.click();
      await harness.settle();
      const dialog = harness.element.querySelector<HTMLDialogElement>('dialog[open]')!;
      expect(dialog.textContent).toContain('Wartung');
      expect(discard.isConnected).toBe(false);

      // Esc: der Browser schliesst den nativen Dialog und feuert `close`.
      dialog.close();
      await harness.settle();

      expect(harness.repository.archivedProjects).toEqual([]);
      expect(harness.element.querySelector('dialog[open]')).toBeNull();
      expect(document.activeElement).toBe(archive);
    });

    it('schliesst beim Archivieren nach „Speichern" ebenso die eigene Zeile', async () => {
      const harness = await dirtyOnP1();
      await harness.click('[data-row="p:p2"] .row-archive');

      await harness.clickText('Speichern', harness.notice('p:p1')!);
      await harness.settle();

      expect(harness.repository.updatedProjects).toEqual([
        { id: 'p1', patch: { name: 'Relaunch neu' } },
      ]);
      expect(harness.row('p:p1').classList).not.toContain('editing');
      expect(harness.element.querySelector('dialog[open]')?.textContent).toContain('Wartung');
    });

    it('schaltet den Filter erst nach dem Hinweis um', async () => {
      const harness = await dirtyOnP1();
      const box = harness.element.querySelector<HTMLInputElement>('.filter input')!;

      box.click();
      await harness.settle();

      expect(box.checked).toBe(false);
      expect(harness.notice('p:p1')?.textContent).toContain('werden Archivierte gezeigt');

      await harness.clickText('Verwerfen', harness.notice('p:p1')!);
      expect(box.checked).toBe(true);
    });
  });

  describe('Absichten waehrend des Speicherns', () => {
    it('Enter, sofort Stift an einer anderen Zeile: nach dem Erfolg ist diese offen, ohne Hinweis', async () => {
      const harness = await setup((fake) => {
        fake.projects = [RELAUNCH, WARTUNG];
      });
      await harness.edit('p:p1');
      await harness.type('p:p1', 'name', 'Relaunch neu');
      let release!: () => void;
      harness.repository.writeGate = new Promise((resolve) => (release = resolve));

      harness.row('p:p1').querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      harness.fixture.detectChanges();
      harness.row('p:p2').querySelector<HTMLButtonElement>('.row-edit')!.click();
      harness.fixture.detectChanges();

      // Waehrenddessen: kein Hinweis, die Absicht wartet still.
      expect(harness.element.querySelector('.row-notice')).toBeNull();
      expect(
        harness.row('p:p1').querySelector('.row-actions button[type="submit"]')?.getAttribute('aria-disabled'),
      ).toBe('true');

      release();
      await harness.settle();
      await harness.settle();

      expect(harness.row('p:p2').classList).toContain('editing');
      expect(harness.element.querySelector('.row-notice')).toBeNull();
    });
  });

  describe('Route verlassen', () => {
    it('haelt mit Ungespeichertem an und navigiert nach „Verwerfen"', async () => {
      const harness = await setup();
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      await harness.edit('p:p1');
      await harness.type('p:p1', 'name', 'X');

      expect(harness.page.canLeave('/week')).toBe(false);
      await harness.settle();
      expect(harness.notice('p:p1')?.textContent).toContain('verlässt du die Projekte');
      expect(document.activeElement?.textContent?.trim()).toBe('Speichern');

      await harness.clickText('Verwerfen', harness.notice('p:p1')!);
      expect(navigate).toHaveBeenCalledWith('/week');
    });

    it('laesst ohne Aenderungen und beim Abmelden sofort gehen', async () => {
      const harness = await setup();
      expect(harness.page.canLeave('/reports')).toBe(true);

      await harness.edit('p:p1');
      await harness.type('p:p1', 'name', 'X');
      expect(harness.page.canLeave('/login')).toBe(true);
    });
  });

  describe('Archivieren', () => {
    it('fragt vor dem Archivieren eines Projekts und nennt die Folge', async () => {
      const harness = await setup();

      await harness.click('[data-row="p:p1"] button[aria-label="Projekt Relaunch archivieren"]');

      const warn = harness.element.querySelector('dialog[role="alertdialog"]');
      expect(warn?.hasAttribute('open')).toBe(true);
      expect(warn?.querySelector('h2')?.textContent).toBe('Archivieren?');
      const message = warn?.textContent;
      expect(message).toContain('Relaunch');
      expect(message).toContain('Wochenraster');
      expect(message).toContain('erfasste Zeiten bleiben erhalten');
      expect(harness.repository.archivedProjects).toEqual([]);

      // Der Knopf sagt „Archivieren", nicht „Löschen" — er archiviert ja auch.
      await harness.clickText('Archivieren', warn as HTMLElement);
      expect(harness.repository.archivedProjects).toEqual([{ id: 'p1', archived: true }]);
    });

    it('warnt beim Kunden davor, dass seine Projekte aus der Auswahl fallen', async () => {
      const harness = await setup();

      await harness.click('[data-row="c:c1"] button[aria-label="Kunde Sandmann GmbH archivieren"]');

      const warn = harness.element.querySelector<HTMLElement>('dialog[role="alertdialog"]')!;
      expect(warn.textContent).toContain('Seine Projekte stehen dann nicht mehr im Wochenraster');

      await harness.clickText('Archivieren', warn);
      expect(harness.repository.archivedClients).toEqual([{ id: 'c1', archived: true }]);
      // Die Projekte selbst bleiben unangetastet — das Raster filtert sie ueber
      // den Kunden. So ist das Zurueckholen ein Klick und nichts geht verloren.
      expect(harness.repository.archivedProjects).toEqual([]);
    });

    it('archiviert nichts, wenn die Rueckfrage abgebrochen wird', async () => {
      const harness = await setup();

      await harness.click('[data-row="p:p1"] .row-archive');
      await harness.clickText(
        'Abbrechen',
        harness.element.querySelector<HTMLElement>('dialog[open]')!,
      );

      expect(harness.repository.archivedProjects).toEqual([]);
      expect(harness.repository.archivedClients).toEqual([]);
    });

    it('setzt den Fokus danach auf den Stift der naechsten Zeile', async () => {
      const harness = await setup((fake) => {
        fake.projects = [RELAUNCH, WARTUNG];
      });

      await harness.click('[data-row="p:p1"] .row-archive');
      await harness.clickText(
        'Archivieren',
        harness.element.querySelector<HTMLElement>('dialog[open]')!,
      );
      await harness.settle();

      expect(harness.element.querySelector('[data-row="p:p1"]')).toBeNull();
      expect(document.activeElement).toBe(harness.row('p:p2').querySelector('.row-edit'));
    });

    it('setzt den Fokus ohne Nachbarn auf die Leerzeile der Gruppe', async () => {
      const harness = await setup();

      await harness.click('[data-row="p:p1"] .row-archive');
      await harness.clickText(
        'Archivieren',
        harness.element.querySelector<HTMLElement>('dialog[open]')!,
      );
      await harness.settle();

      expect(document.activeElement).toBe(harness.row('np:c1').querySelector('input'));
    });

    // Aus „blendet Archiviertes auf Wunsch ein".
    it('blendet Archiviertes auf Wunsch ein', async () => {
      const harness = await setup((fake) => {
        fake.projects = [RELAUNCH, { ...RELAUNCH, id: 'p2', name: 'Altes', archivedAt: new Date() }];
      });

      expect(harness.element.querySelectorAll('tr[app-project-row]')).toHaveLength(1);
      // Ausgeblendetes wird gezaehlt, nicht verschwiegen.
      expect(harness.element.querySelector('.no-projects')?.textContent).toContain(
        '1 archivierte ausgeblendet',
      );

      harness.element.querySelector<HTMLInputElement>('.filter input')!.click();
      await harness.settle();

      expect(harness.element.querySelectorAll('tr[app-project-row]')).toHaveLength(2);
      expect(harness.row('p:p2').querySelector('.tag')?.textContent).toBe('archiviert');
    });

    // Aus „holt ein archiviertes Projekt zurueck".
    it('holt ein archiviertes Projekt zurueck', async () => {
      const harness = await setup((fake) => {
        fake.projects = [{ ...RELAUNCH, archivedAt: new Date() }];
      });

      harness.element.querySelector<HTMLInputElement>('.filter input')!.click();
      await harness.settle();
      const restore = harness.row('p:p1').querySelector<HTMLButtonElement>('.row-restore')!;
      expect(restore.getAttribute('aria-label')).toBe('Projekt Relaunch zurückholen');
      restore.click();
      await harness.settle();

      expect(harness.repository.archivedProjects).toEqual([{ id: 'p1', archived: false }]);
      // Der Knopf unter dem Fokus ist weg — der Fokus geht auf „Archivieren".
      expect(document.activeElement).toBe(harness.row('p:p1').querySelector('.row-archive'));
    });

    it('holt einen archivierten Kunden zurueck, Fokus danach auf „Archivieren"', async () => {
      const harness = await setup((fake) => {
        fake.clients = [client('c1', 'Sandmann GmbH', true)];
      });
      harness.element.querySelector<HTMLInputElement>('.filter input')!.click();
      await harness.settle();

      const restore = harness.row('c:c1').querySelector<HTMLButtonElement>('.row-restore')!;
      restore.focus();
      restore.click();
      await harness.settle();

      expect(harness.repository.archivedClients).toEqual([{ id: 'c1', archived: false }]);
      expect(document.activeElement).toBe(harness.row('c:c1').querySelector('.row-archive'));
    });

    it('laesst den Fokus auf „Zurückholen", wenn es scheitert — Fehler als Toast', async () => {
      const harness = await setup((fake) => {
        fake.projects = [{ ...RELAUNCH, archivedAt: new Date() }];
      });
      harness.element.querySelector<HTMLInputElement>('.filter input')!.click();
      await harness.settle();
      harness.repository.failWith = new RepositoryError('offline', 'Failed to fetch');

      const restore = harness.row('p:p1').querySelector<HTMLButtonElement>('.row-restore')!;
      restore.focus();
      restore.click();
      await harness.settle();

      expect(harness.row('p:p1').querySelector('.row-restore')).toBe(restore);
      expect(document.activeElement).toBe(restore);
      expect(errorTexts(harness)).toEqual([
        ['error', 'Das Projekt konnte nicht zurückgeholt werden.', 'Keine Verbindung zum Server.'],
      ]);
    });

    it('meldet einen gescheiterten Archivieren-Versuch als Fehler-Toast', async () => {
      const harness = await setup();
      await harness.click('[data-row="p:p1"] .row-archive');
      harness.repository.failWith = new RepositoryError('offline', 'Failed to fetch');

      await harness.clickText(
        'Archivieren',
        harness.element.querySelector<HTMLElement>('dialog[open]')!,
      );

      expect(harness.toasts.toasts().map((toast) => [toast.kind, toast.message])).toEqual([
        ['error', 'Das Projekt konnte nicht archiviert werden.'],
      ]);
      // Keine Hinweisbox auf der Seite.
      expect(harness.element.querySelector('.notice')).toBeNull();
    });

    it('laesst den Fokus auf dem Archivieren-Knopf, wenn Archivieren scheitert', async () => {
      const harness = await setup();
      const archive = harness.row('p:p1').querySelector<HTMLButtonElement>('.row-archive')!;
      archive.focus();
      archive.click();
      await harness.settle();
      harness.repository.failWith = new RepositoryError('offline', 'Failed to fetch');

      await harness.clickText(
        'Archivieren',
        harness.element.querySelector<HTMLElement>('dialog[open]')!,
      );
      await harness.settle();

      // Die Zeile steht noch — und der Fokus an ihrem Knopf.
      expect(harness.element.querySelectorAll('tr[app-project-row]')).toHaveLength(1);
      expect(document.activeElement).toBe(archive);
    });
  });

  describe('Laden', () => {
    it('haelt bei „Erneut laden" Karte und Fokus, bis das Ergebnis da ist', async () => {
      const harness = await setup((fake) => {
        fake.failLoad = new RepositoryError('offline', 'Failed to fetch');
      });
      const { element, repository, toasts } = harness;
      const retry = element.querySelector<HTMLButtonElement>('app-load-error button')!;
      retry.focus();

      // 1. Laeuft: Karte bleibt, Knopf sagt „Lädt …", Fokus bleibt auf ihm.
      let release!: () => void;
      repository.loadGate = new Promise((resolve) => (release = resolve));
      retry.click();
      harness.fixture.detectChanges();
      expect(element.querySelector('app-load-error button')).toBe(retry);
      expect(retry.getAttribute('aria-disabled')).toBe('true');
      expect(retry.textContent?.trim()).toBe('Lädt …');
      expect(document.activeElement).toBe(retry);

      // 2. Scheitert erneut: Karte und Fokus bleiben, ein Toast (gezaehlt), eine Ansage.
      release();
      await harness.settle();
      expect(element.querySelector('app-load-error button')).toBe(retry);
      expect(retry.getAttribute('aria-disabled')).toBeNull();
      expect(document.activeElement).toBe(retry);
      expect(toasts.toasts()).toHaveLength(1);
      expect(toasts.toasts()[0].count).toBe(2);
      expect(toasts.announcements()).toHaveLength(1);

      // 3. Klappt: Fokus auf den Seitentitel, der Ladefehler-Toast ist weg.
      repository.loadGate = null;
      repository.failLoad = null;
      retry.click();
      await harness.settle();
      await harness.settle();
      expect(element.querySelector('app-load-error')).toBeNull();
      expect(document.activeElement).toBe(element.querySelector('h1'));
      expect(toasts.toasts()).toEqual([]);
    });

    it('zeigt bei einem Ladefehler einen Fehlerzustand statt „Noch keine Kunden"', async () => {
      const harness = await setup((fake) => {
        fake.failLoad = new RepositoryError('offline', 'Failed to fetch');
      });

      expect(harness.element.textContent).not.toContain('Noch keine Kunden');
      expect(harness.element.querySelector('app-load-error')?.textContent).toContain(
        'Keine Verbindung zum Server',
      );
      expect(harness.toasts.toasts()[0]?.kind).toBe('error');

      harness.repository.failLoad = null;
      await harness.clickText('Erneut laden');

      expect(harness.element.querySelector('app-load-error')).toBeNull();
      expect(harness.element.querySelectorAll('tr[app-project-row]')).toHaveLength(1);
    });
  });
});
