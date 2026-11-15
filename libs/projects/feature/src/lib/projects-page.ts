import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';

import { ProjectsStore } from '@lib/projects/data-access';
import {
  Client,
  ClientDraft,
  ProjectDraft,
  RowFormField,
  checkClientForm,
  checkProjectForm,
} from '@lib/projects/domain';
import {
  ClientRow,
  NewRow,
  ProjectRow,
  RowEditorEvent,
  RowEditorState,
} from '@lib/projects/ui';
import {
  Icon,
  LoadError,
  WarnDialog,
  Wordmark,
  publishShellStatus,
} from '@lib/shared/ui';
import { RouteLeave } from '@lib/shared/util-edit';

import { ProjectsEditor, RowIntent, RowTarget, rowKey } from './projects-editor';

/** Was die Rueckfrage gerade betrifft. */
interface PendingArchive {
  readonly kind: 'client' | 'project';
  readonly id: string;
}

/**
 * Kunden und Projekte verwalten.
 *
 * Eine Tabelle: Kunden sind Gruppen (`<tbody>` mit Kopfzeile), ihre Projekte
 * Zeilen darunter. Bearbeitet und angelegt wird **in der Zeile** (Brief
 * „Inline-Zeile"), jede Gruppe endet mit einer Anlege-Leerzeile, ganz unten
 * steht eine fuer neue Kunden. Genau eine Zeile ist im Bearbeiten-Modus.
 *
 * Hat sie Ungespeichertes, wechselt keine andere Absicht still die Zeile —
 * weder eine andere Bearbeitung noch eine Anlage, das Archivieren, der Filter
 * oder das Verlassen der Route (`unsavedChangesGuard`). In der Zeile erscheint
 * dann der Hinweis „Ungespeicherte Änderungen" mit „Speichern"/„Verwerfen",
 * danach laeuft die Absicht (`projects-editor.ts`).
 *
 * Wohin der Fokus dabei geht, haengt davon ab, wie die Absicht entstand
 * (WCAG 3.2.2):
 * - **Ausdruecklich** (Stift, Archivieren, Filter, Esc, Navigation): auf
 *   „Speichern" im Hinweis.
 * - **Durch Tippen** in eine Leerzeile: nirgendwohin. Das Getippte bleibt im
 *   Feld, man schreibt weiter; der Hinweis wird angesagt und nennt den Weg zu
 *   seinen Knoepfen. Nach „Speichern"/„Verwerfen" geht die Leerzeile mit dem
 *   **ganzen** Getippten auf. Kein Tastendruck kann so einen Knopf ausloesen,
 *   den niemand angesteuert hat, und ohne Entscheidung wird nichts geschrieben.
 *
 * Fehler beim Speichern kommen als Toast; die Zeile ist nicht modal, die
 * Eingaben bleiben stehen.
 *
 * **Geloescht wird nichts.** An Projekten haengen Zeiteintraege und daran
 * haengt die Rechnung; `on delete restrict` in der Datenbank laesst ein Loeschen
 * auch gar nicht zu. Archivieren (ueber das Warn-Modal) nimmt ein Projekt aus
 * der Auswahl im Wochenraster und laesst die erfassten Zeiten stehen.
 */
@Component({
  selector: 'app-projects-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ClientRow, ProjectRow, NewRow, WarnDialog, LoadError, Icon, Wordmark],
  providers: [ProjectsStore],
  templateUrl: './projects-page.html',
  styleUrl: './projects-page.scss',
})
export class ProjectsPage implements OnInit {
  protected readonly store = inject(ProjectsStore);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly routeLeave = new RouteLeave();

  protected readonly editor = new ProjectsEditor({
    project: (id) => this.store.projects().find((project) => project.id === id),
    client: (id) => this.store.clients().find((client) => client.id === id),
  });

  protected readonly confirmMessage = signal<string | null>(null);
  protected readonly confirmSubject = signal<string | null>(null);
  private pendingArchive: PendingArchive | null = null;
  /** Der Archivieren-Knopf, der die Rueckfrage geoeffnet hat. */
  private archiveTrigger: HTMLElement | null = null;

  /** Kunden fuer die Auswahl im Projekt: aktive, dazu der eigene, falls archiviert. */
  private readonly clientOptions = computed<readonly Client[]>(() => {
    const assignable = this.store.assignableClients();
    const own = this.editor.values()?.clientId;
    const current = this.store.clients().find((client) => client.id === own);
    return current && !assignable.includes(current) ? [...assignable, current] : assignable;
  });

  /** Was die eine Zeile im Bearbeiten-Modus zeigt. */
  protected readonly editorState = computed<RowEditorState | null>(() => {
    const values = this.editor.values();
    if (!values || !this.editor.target()) {
      return null;
    }
    return {
      values,
      problem: this.editor.problem(),
      notice: this.editor.notice(),
      noticeMessage: this.editor.noticeMessage(),
      noticeRevision: this.editor.noticeRevision(),
      busy: this.editor.busy(),
      clients: this.clientOptions(),
    };
  });

  protected readonly rowKey = rowKey;

  constructor() {
    // Woche und Summen gibt es hier nicht — die Statusleiste zeigt nur den
    // Zustand gegenueber dem Server.
    publishShellStatus(() => ({
      sync: this.store.loading()
        ? 'loading'
        : this.store.saving()
          ? 'saving'
          : this.store.syncError()
            ? 'error'
            : 'synced',
    }));
  }

  ngOnInit(): void {
    this.routeLeave.remember();
    void this.store.load();
  }

  /** Zustand fuer genau diese Zeile, sonst `null`. */
  protected stateFor(target: RowTarget): RowEditorState | null {
    return this.editor.activeKey() === rowKey(target) ? this.editorState() : null;
  }

  /** „Erneut laden" im Fehlerzustand. Klappt es, geht der Fokus zum Seitentitel. */
  protected async onRetryLoad(): Promise<void> {
    await this.store.load();
    if (!this.store.loadError()) {
      this.focusAfterRender(() => this.host.nativeElement.querySelector<HTMLElement>('h1'));
    }
  }

  /* -- Ausloeser ---------------------------------------------------------- */

  protected onEdit(target: RowTarget): void {
    this.request({ kind: 'edit', target });
  }

  /** „+ Kunde" im Seitenkopf: zur Leerzeile „Neuer Kunde …". */
  protected onAddClient(): void {
    const input = this.rowInput('nc', '.row-name');
    input?.scrollIntoView?.({ block: 'nearest' });
    input?.focus();
  }

  protected onArchive(target: { kind: 'project' | 'client'; id: string }, event: Event): void {
    this.archiveTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.request({ kind: 'archive', target });
  }

  /**
   * „Zurückholen". Danach traegt die Zeile „Archivieren" statt „Zurückholen" —
   * der Knopf unter dem Fokus ist weg; der Fokus geht auf den neuen. Scheitert
   * es, bleibt er auf „Zurückholen" (gleich noch einmal versuchen).
   */
  protected async onRestore(
    target: { kind: 'project' | 'client'; id: string },
    event: Event,
  ): Promise<void> {
    const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const ok =
      target.kind === 'client'
        ? await this.store.setClientArchived(target.id, false)
        : await this.store.setProjectArchived(target.id, false);
    const key = `${target.kind === 'client' ? 'c' : 'p'}:${target.id}`;
    this.focusAfterRender(() =>
      ok
        ? this.rowInput(key, '.row-archive')
        : trigger?.isConnected
          ? trigger
          : this.rowInput(key, '.row-restore'),
    );
  }

  /** „Archivierte zeigen": auch das wartet, wenn eine Zeile Ungespeichertes hat. */
  protected onToggleArchived(event: Event): void {
    const box = event.target as HTMLInputElement;
    const show = box.checked;
    // Erst einmal zuruecksetzen; der Zustand kommt aus dem Store.
    box.checked = this.store.showArchived();
    this.request({ kind: 'filter', show }, box);
  }

  /** Alles, was aus einer Zeile kommt — auch aus der Leerzeile. */
  protected onEditorEvent(target: RowTarget, event: RowEditorEvent): void {
    const key = rowKey(target);
    const active = this.editor.activeKey() === key;
    switch (event.type) {
      case 'change':
        if (active) {
          this.editor.change(event.key, event.value);
        } else if (event.key === 'name') {
          this.onTypedInEmptyRow(target, event.value);
        }
        return;
      case 'save':
        if (active) {
          void this.save();
        }
        return;
      case 'cancel':
        this.onCancel();
        return;
      case 'escape':
        if (active) {
          this.request({ kind: 'close' });
        }
        return;
      case 'keep':
        void this.save();
        return;
      case 'discard':
        this.onNoticeDiscard();
        return;
    }
  }

  /**
   * Tippen in eine Leerzeile beginnt die Anlage — mit dem Getippten. Darf es
   * gerade nicht (eine andere Zeile hat Ungespeichertes oder speichert), wartet
   * die Anlage, **ohne** dass der Fokus das Feld verlaesst: das Getippte bleibt
   * stehen und waechst weiter, und nach „Speichern"/„Verwerfen" geht die
   * Leerzeile mit allem auf, was dann darin steht (`perform`).
   */
  private onTypedInEmptyRow(target: RowTarget, value: string): void {
    const key = rowKey(target);
    const waiting = this.editor.pending();
    if (waiting?.kind === 'edit' && rowKey(waiting.target) === key) {
      // Wartet schon (und ist angesagt) — jeder weitere Buchstabe bleibt im Feld.
      // Wieder leer getippt: die Anlage hat sich erledigt, der Hinweis geht.
      // Der Fokus bleibt im Feld, geschrieben wird nichts.
      if (value === '') {
        this.editor.dropPending();
      }
      return;
    }
    if (value === '') {
      return;
    }
    const intent: RowIntent = { kind: 'edit', target, seed: value };
    if (this.editor.request(intent, this.sideOf(key))) {
      this.perform(intent);
    }
  }

  /** Liegt diese Zeile unter oder ueber der bearbeiteten? (Weg im Hinweistext.) */
  private sideOf(key: string): 'below' | 'above' {
    const root = this.host.nativeElement;
    const editing = root.querySelector('tr.editing');
    const typed = root.querySelector(`[data-row="${key}"]`);
    if (!editing || !typed) {
      return 'below';
    }
    return editing.compareDocumentPosition(typed) & Node.DOCUMENT_POSITION_FOLLOWING
      ? 'below'
      : 'above';
  }

  /* -- Absichten ---------------------------------------------------------- */

  /**
   * Jede Absicht, die die aktive Zeile betrifft, laeuft hier durch. Hat sie
   * Ungespeichertes, bleibt alles, wie es ist: die Zeile zeigt den Hinweis, der
   * Fokus geht auf dessen „Speichern". Laeuft gerade ein Speichern, wartet die
   * Absicht still und laeuft danach (`afterSave`).
   */
  private request(intent: RowIntent, trigger: HTMLElement | null = null): void {
    if (this.editor.request(intent)) {
      this.perform(intent, trigger);
      return;
    }
    this.focusNoticeUnlessBusy();
  }

  private perform(intent: RowIntent, trigger: HTMLElement | null = null): void {
    switch (intent.kind) {
      case 'edit': {
        const key = rowKey(intent.target);
        // Bei der Leerzeile: was jetzt darin steht — auch, was nach dem
        // Parken noch dazugetippt (oder wieder geloescht) wurde. Nur ohne Feld
        // im DOM gilt das beim Parken Getippte.
        const isNew = intent.target.kind === 'new-project' || intent.target.kind === 'new-client';
        const typed = isNew ? this.rowInput(key, '.row-name')?.value : undefined;
        this.editor.open(intent.target, typed ?? intent.seed);
        this.afterRender(() => {
          const input = this.rowInput(key, '.row-name');
          if (input) {
            input.focus();
            // Bei der Leerzeile: hinter dem schon Getippten weiterschreiben.
            input.setSelectionRange(input.value.length, input.value.length);
          }
        });
        return;
      }
      case 'close': {
        const target = this.editor.target();
        this.editor.close();
        if (target) {
          this.focusRowStart(target);
        }
        return;
      }
      case 'archive':
        this.askArchive(intent.target);
        return;
      case 'filter':
        this.editor.close();
        this.store.showArchived.set(intent.show);
        this.focusAfterRender(() =>
          trigger?.isConnected
            ? trigger
            : this.host.nativeElement.querySelector<HTMLElement>('.filter input'),
        );
        return;
      case 'leave':
        this.editor.close();
        this.routeLeave.go(intent.intent);
        return;
    }
  }

  /**
   * „Abbrechen" ist ausdruecklich: verwirft ohne Rueckfrage. Waehrend eines
   * Speicherns bleibt der Knopf bewusst bedienbar (anders als Speichern und
   * Verwerfen) — wie im Panel der Woche: das Beenden wartet still auf das
   * Ergebnis. Gelingt es, ist die Zeile zu; scheitert es, steht der Hinweis.
   */
  private onCancel(): void {
    if (this.editor.busy()) {
      this.request({ kind: 'close' });
      return;
    }
    this.editor.dropPending();
    this.editor.discard();
    this.perform({ kind: 'close' });
  }

  /** Hinweis „Verwerfen": Getipptes weg, dann die geparkte Absicht. */
  private onNoticeDiscard(): void {
    if (this.editor.busy()) {
      return;
    }
    const next = this.editor.takePending();
    this.editor.discard();
    if (next) {
      // Wie nach „Speichern": die eigene Zeile schliesst, bevor die Absicht
      // laeuft. Die anderen Absichten schliessen bzw. wechseln sie selbst.
      if (next.kind === 'archive') {
        this.editor.close();
      }
      this.perform(next);
    } else {
      // Nur ein Konflikt: die Zeile zeigt wieder den gespeicherten Stand.
      this.focusRow(this.editor.activeKey(), '.row-name');
    }
  }

  /* -- Speichern ---------------------------------------------------------- */

  /**
   * Pruefen, dann speichern — nur, was getippt ist. Danach verlaesst die Zeile
   * den Bearbeiten-Modus, der Fokus geht auf ihren Stift (bei einer Anlage: den
   * Stift der neuen Zeile), und was waehrenddessen geparkt wurde, laeuft.
   */
  private async save(): Promise<void> {
    const target = this.editor.target();
    const values = this.editor.values();
    if (!target || !values || this.editor.busy()) {
      return;
    }

    const isClient = target.kind === 'client' || target.kind === 'new-client';
    const result = isClient ? checkClientForm(values) : checkProjectForm(values);
    if (!result.ok) {
      this.editor.problem.set(result.problem);
      this.focusProblem(rowKey(target), result.problem.field);
      return;
    }

    // Nichts getippt: nichts zu schreiben, die Bearbeitung ist einfach zu Ende.
    if ((target.kind === 'project' || target.kind === 'client') && !this.editor.dirty()) {
      this.editor.dropPending();
      this.perform({ kind: 'close' });
      return;
    }

    this.editor.beginSave();
    const savedKey = await this.write(target, result.value);

    if (savedKey === null) {
      // Toast kam vom Store. Eingaben bleiben stehen; wartete eine Absicht,
      // erscheint jetzt der Hinweis.
      this.editor.saveFailed();
      if (this.editor.pending() && !this.editor.typedElsewhere()) {
        this.focusNoticeUnlessBusy();
      }
      return;
    }

    const next = this.editor.saved();
    if (next && next.kind !== 'close') {
      this.perform(next);
      return;
    }
    this.focusRow(savedKey, '.row-edit');
  }

  /** Schreiben; die Kennung der gespeicherten Zeile, `null`: gescheitert (Toast). */
  private async write(target: RowTarget, draft: ClientDraft | ProjectDraft): Promise<string | null> {
    switch (target.kind) {
      case 'client':
        return (await this.store.renameClient(target.id, draft.name)) ? rowKey(target) : null;
      case 'new-client': {
        const client = await this.store.createClient({ name: draft.name });
        return client ? rowKey({ kind: 'client', id: client.id }) : null;
      }
      case 'project':
        return (await this.store.updateProject(target.id, this.typedPatch(draft as ProjectDraft)))
          ? rowKey(target)
          : null;
      case 'new-project': {
        const project = await this.store.createProject(draft as ProjectDraft);
        return project ? rowKey({ kind: 'project', id: project.id }) : null;
      }
    }
  }

  /** Nur die getippten Felder, geprueft und umgerechnet. */
  private typedPatch(draft: ProjectDraft): Partial<ProjectDraft> {
    const edits = this.editor.edits();
    return {
      ...('name' in edits ? { name: draft.name } : {}),
      ...('color' in edits ? { color: draft.color } : {}),
      ...('rate' in edits ? { hourlyRate: draft.hourlyRate } : {}),
      ...('clientId' in edits ? { clientId: draft.clientId } : {}),
    };
  }

  /* -- Archivieren -------------------------------------------------------- */

  private askArchive(target: { kind: 'project' | 'client'; id: string }): void {
    const name =
      target.kind === 'client'
        ? this.store.clients().find((client) => client.id === target.id)?.name
        : this.store.projects().find((project) => project.id === target.id)?.name;
    if (name === undefined) {
      return;
    }
    this.pendingArchive = target;
    this.confirmSubject.set(name);
    this.confirmMessage.set(
      target.kind === 'client'
        ? 'Der Kunde wird archiviert. Seine Projekte stehen dann nicht mehr im Wochenraster zur ' +
            'Auswahl; erfasste Zeiten bleiben erhalten.'
        : 'Das Projekt wird archiviert. Es steht dann nicht mehr im Wochenraster zur Auswahl; ' +
            'erfasste Zeiten bleiben erhalten.',
    );
  }

  protected async onConfirm(): Promise<void> {
    const pending = this.pendingArchive;
    this.confirmMessage.set(null);
    this.pendingArchive = null;
    if (!pending) {
      return;
    }

    const trigger = this.archiveTrigger;
    this.archiveTrigger = null;
    // Vorher bestimmen, solange die Zeile noch steht.
    const next = this.focusTargetAfterArchive(pending);
    const ok =
      pending.kind === 'client'
        ? await this.store.setClientArchived(pending.id, true)
        : await this.store.setProjectArchived(pending.id, true);

    if (!ok) {
      // Gescheitert: die Zeile steht noch. Der Fokus gehoert an ihren
      // Archivieren-Knopf — von dort laesst es sich gleich noch einmal versuchen.
      this.focusAfterRender(() => (trigger?.isConnected ? trigger : null));
      return;
    }

    // Die archivierte Zeile verschwindet aus der Liste; ohne Nachfassen fiele
    // der Fokus auf `body`. Bleibt sie stehen (Archivierte werden gezeigt),
    // traegt sie jetzt „Zurückholen" — dorthin.
    const key = `${pending.kind === 'client' ? 'c' : 'p'}:${pending.id}`;
    this.focusAfterRender(() => this.rowInput(key, '.row-restore') ?? next());
  }

  /**
   * Abgebrochen: der Fokus gehoert an den Archivieren-Knopf, der die Rueckfrage
   * ausgeloest hat. Das Modal selbst gibt ihn an seinen Oeffner zurueck — kam
   * es aber aus dem Hinweis („Verwerfen"), ist dessen Knopf mit der Zeile
   * geschlossen; ohne Nachfassen fiele der Fokus auf `body`. Ersatz: der
   * Archivieren-Knopf bzw. Stift der betroffenen Zeile, zuletzt der Seitentitel.
   */
  protected onCancelConfirm(): void {
    const pending = this.pendingArchive;
    const trigger = this.archiveTrigger;
    this.confirmMessage.set(null);
    this.pendingArchive = null;
    this.archiveTrigger = null;
    const key = pending ? `${pending.kind === 'client' ? 'c' : 'p'}:${pending.id}` : null;
    this.focusAfterRender(
      () =>
        (trigger?.isConnected ? trigger : null) ??
        (key ? (this.rowInput(key, '.row-archive') ?? this.rowInput(key, '.row-edit')) : null) ??
        this.host.nativeElement.querySelector<HTMLElement>('h1'),
    );
  }

  /**
   * Wohin der Fokus nach dem Archivieren geht, wenn die Zeile verschwindet:
   * auf den Stift der naechsten Zeile derselben Ebene (sonst der vorigen), bei
   * einem Projekt ohne Nachbarn auf die Leerzeile seiner Gruppe, bei einem
   * Kunden ohne Nachbarn auf „Neuer Kunde …".
   */
  private focusTargetAfterArchive(target: PendingArchive): () => HTMLElement | null {
    const root = this.host.nativeElement;
    const prefix = target.kind === 'client' ? 'c:' : 'p:';
    const self = root.querySelector<HTMLElement>(`[data-row="${prefix}${target.id}"]`);
    const scope = target.kind === 'client' ? root : self?.closest('tbody');
    const rows = [...(scope?.querySelectorAll<HTMLElement>(`[data-row^="${prefix}"]`) ?? [])];
    const index = self ? rows.indexOf(self) : -1;
    const neighbour = rows[index + 1] ?? rows[index - 1] ?? null;
    const neighbourKey = neighbour?.dataset['row'] ?? null;
    const fallbackKey =
      target.kind === 'client'
        ? 'nc'
        : `np:${this.store.projects().find((project) => project.id === target.id)?.clientId ?? ''}`;
    return () =>
      (neighbourKey && this.rowInput(neighbourKey, '.row-edit')) ||
      this.rowInput(fallbackKey, '.row-name');
  }

  /* -- Route -------------------------------------------------------------- */

  /**
   * Fuer `unsavedChangesGuard`: Verlassen nur ohne Ungespeichertes. Sonst
   * bleibt die Seite stehen, die Zeile zeigt den Hinweis, und
   * „Speichern"/„Verwerfen" fuehrt die Navigation danach aus.
   */
  canLeave(url: string): boolean {
    const intent = this.routeLeave.intent(url);
    if (!intent || this.editor.request({ kind: 'leave', intent })) {
      return true;
    }
    this.focusNoticeUnlessBusy();
    return false;
  }

  /* -- Fokus -------------------------------------------------------------- */

  private focusNoticeUnlessBusy(): void {
    if (!this.editor.busy()) {
      this.focusRow(this.editor.activeKey(), '.row-notice-save');
    }
  }

  /** Nach dem Beenden: Stift der Zeile bzw. das Feld der Leerzeile. */
  private focusRowStart(target: RowTarget): void {
    const key = rowKey(target);
    const isNew = target.kind === 'new-project' || target.kind === 'new-client';
    this.focusRow(key, isNew ? '.row-name' : '.row-edit');
  }

  private focusProblem(key: string, field: RowFormField): void {
    this.focusRow(key, `[data-field="${field}"]`);
  }

  private focusRow(key: string | null, selector: string): void {
    if (key) {
      this.focusAfterRender(() => this.rowInput(key, selector));
    }
  }

  private rowInput(key: string, selector: string): HTMLInputElement | null {
    return this.host.nativeElement.querySelector<HTMLInputElement>(
      `[data-row="${key}"] ${selector}`,
    );
  }

  private focusAfterRender(find: () => HTMLElement | null | undefined): void {
    this.afterRender(() => find()?.focus());
  }

  private afterRender(run: () => void): void {
    afterNextRender(run, { injector: this.injector });
  }
}
