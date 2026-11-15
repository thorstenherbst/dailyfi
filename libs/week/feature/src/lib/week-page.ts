import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  Injector,
  OnDestroy,
  OnInit,
  afterNextRender,
  computed,
  inject,
  viewChild,
} from '@angular/core';

import {
  Icon,
  LoadError,
  Shortcut,
  WarnDialog,
  Wordmark,
  publishShellStatus,
} from '@lib/shared/ui';
import {
  AXIS_WIDTH_PX,
  DayKey,
  HOUR_HEIGHT_PX,
  MINUTES_PER_DAY,
  Placement,
  clampMinutes,
  describePlacement,
  dstDayOfWeek,
  formatHours,
  formatWeekRange,
  formatWeekRangeShort,
  formatWeekdayLong,
  instantToWall,
  minutesToPx,
  pxToMinutes,
  snapToQuarter,
  todayKey,
} from '@lib/shared/util-time';
import { RouteLeave } from '@lib/shared/util-edit';
import { WeekStore } from '@lib/week/data-access';
import {
  EntryFormValues,
  GestureController,
  GestureGeometry,
  GestureHandlers,
  TimeEntry,
  blockKeyAction,
  checkEntryForm,
  entryFormValues,
  formPlacement,
  placementOf,
} from '@lib/week/domain';
import { BlockView, DayColumnView, EntryPanel, EntryPanelChange, buildColumns } from '@lib/week/ui';

import { PanelAction, WeekPanel } from './week-panel';

/** `September 2026` — Monat des Montags der gezeigten Woche. */
const MONTH_YEAR = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});

/** Die Tastatur des Rasters, sichtbar in der Statusleiste. */
const GRID_SHORTCUTS: readonly Shortcut[] = [
  { keys: ['↑', '↓'], label: 'verschieben' },
  { keys: ['⇧', '↑', '↓'], label: 'Dauer' },
  { keys: ['←', '→'], label: 'Tag' },
  { keys: ['Enter'], label: 'im Panel' },
  { keys: ['Entf'], label: 'löschen' },
];

/**
 * Das Wochenraster. Maus und Tastatur sind zwei Wege zum selben Ziel:
 *
 *  - Maus: im leeren Raster ziehen legt an, einen Block ziehen verschiebt ihn,
 *    die Kanten aendern die Dauer.
 *  - Tastatur: jeder Block ist ein `button`. ↑/↓ verschiebt in Viertelstunden,
 *    ⇧+↑/↓ aendert die Dauer, ←/→ wechselt den Tag, Enter oeffnet den Block
 *    im Panel, Entf loescht nach Rueckfrage, Esc hebt die Auswahl auf.
 *    „Zeit eintragen" legt ohne Maus an.
 *
 * Bearbeitet und angelegt wird im nicht-modalen Detail-Panel rechts
 * (`EntryPanel`). Hat es ungespeicherte Aenderungen, wechselt keine andere
 * Absicht still die Auswahl — sie wartet auf „Speichern" oder „Verwerfen"
 * (`week-panel.ts`). Das gilt auch fuer Wochenwechsel und das Verlassen der
 * Route (`unsavedChangesGuard`).
 *
 * Jede Aenderung landet in der Live-Region, damit beide Wege gleich viel
 * Rueckmeldung geben.
 *
 * Die Komponente selbst verdrahtet nur noch. Was sie frueher alles war, steht
 * jetzt daneben und laesst sich einzeln pruefen:
 *
 *  - `week-gesture.ts`   — der Zustandsautomat der Maus
 *  - `week-keyboard.ts`  — Tastendruck → Absicht, als reine Funktion
 *  - `week-grid-view.ts` — Eintraege → das, was gezeichnet wird
 *  - `week-panel.ts`     — was im Panel steht, was ungespeichert ist, was wartet
 *  - `entry-form.ts`     — Pruefung der Panel-Felder
 *  - `entry-panel.ts`    — das Panel selbst (praesentational)
 *
 * Was hier bleibt, ist genau das, was einen Browser braucht: Geometrie aus
 * `getBoundingClientRect`, Fokusfuehrung und das Zusammenschalten der Teile.
 */
@Component({
  selector: 'app-week-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EntryPanel, WarnDialog, LoadError, Icon, Wordmark],
  providers: [WeekStore],
  host: { '(focusin)': 'onFocusIn($event)' },
  templateUrl: './week-page.html',
  styleUrl: './week-page.scss',
})
export class WeekPage
  implements OnInit, AfterViewInit, OnDestroy, GestureGeometry, GestureHandlers
{
  protected readonly store = inject(WeekStore);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly scrollRef = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly bodyRef = viewChild.required<ElementRef<HTMLElement>>('body');
  private readonly addButtonRef = viewChild.required<ElementRef<HTMLButtonElement>>('addButton');
  private readonly panelRef = viewChild.required(EntryPanel);

  protected readonly hours = Array.from({ length: 24 }, (_, hour) => hour);
  protected readonly hourHeightPx = HOUR_HEIGHT_PX;
  protected readonly dayHeightPx = minutesToPx(MINUTES_PER_DAY);

  /** Die Komponente ist selbst Geometrie und Empfaenger — sie hat beides. */
  private readonly gestures = new GestureController(this, this);
  protected readonly panel = new WeekPanel(
    (id) => this.formValuesOf(id),
    (id) => this.store.writing(id),
  );

  /** Was die zuletzt geparkte bzw. ausgefuehrte Absicht ausgeloest hat. */
  private intentTrigger: HTMLElement | null = null;
  /**
   * Welcher Block zuletzt den Fokus hatte, bevor er in den Hinweis ging —
   * dorthin kehrt er nach einem Konflikt zurueck.
   */
  private lastFocusedBlock: string | null = null;
  /** Abgebrochene Navigationen spaeter richtig nachholen (auch Zurueck/Vor). */
  private readonly routeLeave = new RouteLeave();

  protected readonly dragging = this.gestures.dragging;
  protected readonly confirmMessage = this.panel.confirmMessage;
  protected readonly confirmSubject = this.panel.confirmSubject;
  /** Der Block, der im Panel steht — im Raster markiert (Rahmen innen + aria-current). */
  protected readonly selectedId = this.panel.entryId;

  protected readonly weekLabel = computed(() => formatWeekRange(this.store.weekStart()));
  /** „2.–8. Nov" — Jahr nur, wenn es nicht das aktuelle ist. */
  protected readonly weekLabelShort = computed(() =>
    formatWeekRangeShort(this.store.weekStart(), todayKey()),
  );
  protected readonly monthLabel = computed(() =>
    MONTH_YEAR.format(new Date(`${this.store.weekStart()}T12:00:00Z`)),
  );
  protected readonly totalLabel = computed(() => formatHours(this.store.totalHours()));

  /**
   * In einer Woche mit Zeitumstellung stimmt das 24-Zeilen-Raster nicht mit der
   * Wirklichkeit ueberein. Der Hinweis sagt das offen, statt es den Nutzer an
   * einer krummen Wochensumme erraten zu lassen.
   */
  protected readonly dstNote = computed<string | null>(() => {
    const change = dstDayOfWeek(this.store.weekStart());
    if (!change) {
      return null;
    }
    return `Zeitumstellung: ${formatWeekdayLong(change.dayKey)} hat ${change.hours} Stunden.`;
  });

  /**
   * Der Entwurfsblock: waehrend des Aufziehens die gezogene Stelle, danach,
   * solange das Panel anlegt, die Zeiten aus dem Panel. Waehrend des
   * Speicherns steht der Eintrag schon (optimistisch) im Raster.
   */
  protected readonly draft = computed<{ dayKey: DayKey; topPx: number; heightPx: number } | null>(
    () => {
      const gesture = this.gestures.current();
      let placement: Placement | null = gesture?.kind === 'draw' ? gesture.placement : null;
      if (!placement && this.panel.mode() === 'create' && !this.panel.busy()) {
        const values = this.panel.values();
        placement = values ? formPlacement(values) : null;
      }
      if (!placement) {
        return null;
      }
      return {
        dayKey: placement.dayKey,
        topPx: minutesToPx(placement.startMinutes),
        heightPx: minutesToPx(placement.endMinutes - placement.startMinutes),
      };
    },
  );

  protected readonly columns = computed<DayColumnView[]>(() => {
    const gesture = this.gestures.current();
    return buildColumns({
      days: this.store.days(),
      entries: this.store.entries(),
      projectsById: this.store.projectsById(),
      today: todayKey(),
      preview:
        gesture?.entryId != null
          ? { entryId: gesture.entryId, placement: gesture.placement }
          : null,
    });
  });

  /** „Heute" nur, wenn heute in der gezeigten Woche liegt. */
  private readonly todayTotal = computed(() => {
    const today = this.columns().find((column) => column.isToday);
    return today ? this.formatDayTotal(today.totalHours) : null;
  });

  constructor() {
    // Das Panel steht rechts, solange die Seite lebt: Toasts ruecken links
    // daneben (`--toast-inset-right`, components/_panel.scss).
    const root = inject(DOCUMENT).documentElement;
    root.setAttribute('data-side-panel', '');
    inject(DestroyRef).onDestroy(() => root.removeAttribute('data-side-panel'));

    // Die Statusleiste zeichnet die App-Shell; was sie ueber die Woche weiss,
    // kommt von hier. „Heute" nur, wenn heute in der gezeigten Woche liegt —
    // sonst ist der Tag gar nicht geladen.
    publishShellStatus(() => ({
      sync: this.store.loading()
        ? 'loading'
        : this.store.saving()
          ? 'saving'
          : this.store.syncError()
            ? 'error'
            : 'synced',
      weekNumber: this.store.weekNumber(),
      weekTotal: `${this.totalLabel()} h`,
      todayTotal: this.todayTotal(),
      shortcuts: GRID_SHORTCUTS,
    }));
  }

  ngOnInit(): void {
    this.routeLeave.remember();
    void this.store.load();
  }

  ngAfterViewInit(): void {
    // Der Arbeitstag steht im Bild, Mitternacht muss niemand sehen.
    this.scrollRef().nativeElement.scrollTop = 7 * HOUR_HEIGHT_PX;
  }

  ngOnDestroy(): void {
    this.gestures.destroy();
    // Eine gerade laufende Tastaturbewegung darf beim Verlassen nicht verfallen.
    void this.store.flushPending();
  }

  protected formatHour(hour: number): string {
    return String(hour).padStart(2, '0');
  }

  protected formatDayTotal(hours: number): string {
    return `${formatHours(hours)} h`;
  }

  /* -- Maus: Anfassen --------------------------------------------------- */

  protected onColumnPointerDown(event: PointerEvent, dayKey: DayKey): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.block')) {
      return;
    }
    event.preventDefault();
    this.gestures.startDraw(event, dayKey);
  }

  protected onBlockPointerDown(event: PointerEvent, block: BlockView): void {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    this.gestures.startMove(event, block.id, block.placement);
  }

  protected onHandlePointerDown(
    event: PointerEvent,
    block: BlockView,
    edge: 'top' | 'bottom',
  ): void {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    this.gestures.startResize(event, block.id, block.placement, edge);
  }

  /* -- Maus: Geometrie (GestureGeometry) -------------------------------- */

  minutesAt(clientY: number): number {
    const rect = this.bodyRef().nativeElement.getBoundingClientRect();
    return pxToMinutes(clientY - rect.top);
  }

  insideGrid(clientX: number, clientY: number): boolean {
    const rect = this.scrollRef().nativeElement.getBoundingClientRect();
    return (
      clientX >= rect.left + AXIS_WIDTH_PX &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  /**
   * Jede Spalte traegt links eine 1-px-Trennlinie. Rechnet man die nicht mit,
   * summiert sich der Fehler ueber sieben Spalten auf bis zu 7 px und am
   * Spaltenrand landet der Block in der Nachbarspalte.
   */
  dayAt(clientX: number): DayKey | null {
    const columns = this.bodyRef().nativeElement.querySelectorAll<HTMLElement>('.col');
    const days = this.store.days();
    for (let index = 0; index < columns.length; index++) {
      const rect = columns[index].getBoundingClientRect();
      if (clientX >= rect.left && clientX < rect.right) {
        return days[index] ?? null;
      }
    }
    // Ausserhalb: am naechstgelegenen Rand festhalten.
    const first = columns[0]?.getBoundingClientRect();
    if (first && clientX < first.left) {
      return days[0] ?? null;
    }
    return days[days.length - 1] ?? null;
  }

  /* -- Maus: Ergebnis (GestureHandlers) --------------------------------- */

  drawn(placement: Placement): void {
    // Bewusst keine Vorauswahl des Projekts: daran haengt die Rechnung, ein
    // vorbelegtes erstes Projekt waere schnell versehentlich uebernommen.
    this.request({ kind: 'create', placement, origin: 'grid' });
  }

  moved(entryId: string, placement: Placement): void {
    void this.store.moveEntry(entryId, placement);
  }

  cancelled(message: string): void {
    this.store.announce(message);
  }

  /* -- Tastatur --------------------------------------------------------- */

  protected onBlockKeydown(event: KeyboardEvent, block: BlockView): void {
    // Esc auf dem ausgewaehlten Block hebt die Auswahl auf (das erste Esc im
    // Panel hat den Fokus hierher zurueckgebracht).
    if (event.key === 'Escape') {
      if (this.selectedId() === block.id) {
        event.preventDefault();
        this.request({ kind: 'close' });
      }
      return;
    }

    const action = blockKeyAction(event.key, event.shiftKey, block.placement);
    if (!action) {
      return;
    }
    event.preventDefault();

    switch (action.kind) {
      case 'delete':
        this.panel.askDelete(block.id, block.ariaLabel);
        return;
      case 'announce':
        this.store.announce(action.message);
        return;
      case 'apply':
        this.keepFocusOn(block.id);
        this.store.nudgeEntry(block.id, action.placement);
        return;
    }
  }

  /** Klick, Enter und Leertaste: den Block im Panel oeffnen. */
  protected onBlockClick(block: BlockView): void {
    if (this.gestures.consumeClick()) {
      return;
    }
    if (this.selectedId() === block.id) {
      // Schon im Panel: nur hinein, nichts zuruecksetzen.
      this.afterRender(() => this.panelRef().focusFirst());
      return;
    }
    this.request({ kind: 'select', entryId: block.id });
  }

  /** „Zeit eintragen" — der Weg ohne Maus. */
  protected onAddEntry(): void {
    const days = this.store.days();
    const today = todayKey();
    const dayKey = days.includes(today) ? today : (days[0] ?? today);
    // Uhrzeit aus Europe/Berlin, nicht aus der Zeitzone des Rechners — sonst
    // schlaegt ausgerechnet der Vorschlag eine Zeit vor, die es hier nicht ist.
    const nowMinutes = instantToWall(new Date()).minutes;
    const suggested = dayKey === today ? snapToQuarter(nowMinutes) - 60 : 9 * 60;
    const startMinutes = Math.min(clampMinutes(suggested), MINUTES_PER_DAY - 60);

    this.request({
      kind: 'create',
      placement: { dayKey, startMinutes, endMinutes: startMinutes + 60 },
      origin: 'button',
    });
  }

  /* -- Panel ------------------------------------------------------------ */

  /**
   * Jede Absicht, die das Panel umstellt, laeuft hier durch. Sind Aenderungen
   * ungespeichert, bleibt alles, wie es ist: das Panel zeigt den Hinweis, der
   * Fokus geht auf dessen „Speichern". Laeuft gerade ein Speichern, wartet die
   * Absicht still und wird danach ausgefuehrt (`afterSave`).
   *
   * @param trigger Was die Absicht ausgeloest hat; dorthin kehrt der Fokus
   *   zurueck, wenn die Absicht selbst kein Ziel hat (Wochenwechsel).
   */
  private request(action: PanelAction, trigger: HTMLElement | null = null): void {
    this.intentTrigger = trigger;
    if (this.panel.request(action)) {
      this.perform(action);
      return;
    }
    this.focusNoticeUnlessBusy();
  }

  private focusNoticeUnlessBusy(): void {
    if (!this.panel.busy()) {
      this.afterRender(() => this.panelRef().focusNotice());
    }
  }

  /** Eine Absicht ausfuehren — sofort oder nach „Speichern"/„Verwerfen". */
  private perform(action: PanelAction): void {
    switch (action.kind) {
      case 'select': {
        this.panel.openEdit(action.entryId);
        const entry = this.entryById(action.entryId);
        if (entry) {
          this.store.announce(`Im Panel: ${this.describe(entry)}`);
        }
        this.afterRender(() => this.panelRef().focusFirst());
        return;
      }
      case 'create': {
        this.panel.openCreate(action.placement, action.origin);
        this.store.announce(describePlacement('Neuer Eintrag', action.placement));
        this.revealInGrid(action.placement);
        this.afterRender(() => this.panelRef().focusFirst());
        return;
      }
      case 'close': {
        const mode = this.panel.mode();
        const entryId = this.panel.entryId();
        const origin = this.panel.origin();
        this.panel.close();
        if (mode === 'edit' && entryId) {
          this.store.announce('Auswahl aufgehoben');
          this.keepFocusOn(entryId);
        } else if (mode === 'create') {
          this.store.announce('Entwurf verworfen');
          this.focusAfterRender(() =>
            origin === 'button'
              ? this.addButtonRef().nativeElement
              : this.scrollRef().nativeElement,
          );
        }
        return;
      }
      case 'adopt':
        this.panel.discardEdits();
        this.focusAfterConflict();
        return;
      case 'week': {
        this.panel.close();
        void (action.delta === 'today'
          ? this.store.goToToday()
          : this.store.shiftWeek(action.delta));
        // Zurueck zum Knopf, der die Woche wechseln wollte — auch wenn der
        // Fokus inzwischen im Hinweis war, der jetzt verschwindet.
        const trigger = this.intentTrigger;
        this.focusAfterRender(() =>
          trigger?.isConnected ? trigger : this.host.nativeElement.querySelector<HTMLElement>('h1'),
        );
        return;
      }
      case 'leave':
        this.panel.close();
        this.routeLeave.go(action.intent);
        return;
    }
  }

  protected onPanelChange(change: EntryPanelChange): void {
    this.panel.change(change.key, change.value);
  }

  protected async onPanelSave(): Promise<void> {
    await this.save();
  }

  /**
   * Pruefen, dann speichern. `true` nur, wenn der Server angenommen hat.
   * Danach bleibt das Panel mit dem gespeicherten Eintrag offen; der Erfolg
   * kommt als Toast (aus dem Store), nicht noch einmal ueber die Raster-Region.
   */
  private async save(): Promise<boolean> {
    const values = this.panel.values();
    const mode = this.panel.mode();
    if (!values || mode === 'empty' || this.panel.busy()) {
      return false;
    }

    const result = checkEntryForm(values);
    if (!result.ok) {
      const { problem } = result;
      if (problem.rounded) {
        this.panel.applyRounding(problem.rounded.from, problem.rounded.to);
      }
      this.panel.problem.set(problem);
      this.afterRender(() => this.panelRef().focusProblem(problem.field));
      return false;
    }

    const entryId = this.panel.entryId();
    const wasConflict = this.panel.conflict();
    this.panel.beginSave();
    const savedId =
      mode === 'edit' && entryId
        ? (await this.store.editEntry(
            entryId,
            result.placement,
            result.projectId,
            result.description,
          ))
          ? entryId
          : null
        : ((await this.store.createEntry(result.placement, result.projectId, result.description))
            ?.id ?? null);

    if (savedId === null) {
      // Eingaben bleiben stehen. Wartete eine Absicht, erscheint jetzt der
      // Hinweis: weiter geht es erst nach „Speichern" oder „Verwerfen".
      this.panel.saveFailed();
      if (this.panel.pending()) {
        this.focusNoticeUnlessBusy();
      }
      return false;
    }
    this.panel.saved(savedId);
    this.afterSave(wasConflict);
    return true;
  }

  /**
   * Nach erfolgreichem Speichern: was waehrenddessen bzw. davor geparkt wurde,
   * jetzt ausfuehren — einen anderen Block waehlen, die Woche wechseln, die
   * Route verlassen. Ohne Absicht bleibt der Fokus, wo er ist; nach einem
   * Konflikt geht er dorthin zurueck, wo er vorher war.
   */
  private afterSave(wasConflict: boolean): void {
    const next = this.panel.takePending();
    if (next && next.kind !== 'adopt') {
      this.perform(next);
      return;
    }
    if (wasConflict) {
      this.focusAfterConflict();
    }
  }

  /**
   * Esc im Panel. Beim Bearbeiten geht nichts verloren — der Fokus kehrt auf
   * den Block zurueck, der Block bleibt ausgewaehlt (ein zweites Esc dort hebt
   * die Auswahl auf). Beim Anlegen verwirft Esc den Entwurf; mit Getipptem
   * fragt das Panel vorher.
   */
  protected onPanelEscape(): void {
    switch (this.panel.mode()) {
      case 'edit':
        this.keepFocusOn(this.panel.entryId() ?? '');
        return;
      case 'create':
        this.request({ kind: 'close' });
        return;
      default:
        this.scrollRef().nativeElement.focus();
    }
  }

  /** „Abbrechen" ist ausdruecklich: verwirft ohne Rueckfrage. */
  protected onPanelCancel(): void {
    if (this.panel.busy()) {
      // Das Speichern laeuft schon; danach schliessen.
      this.request({ kind: 'close' });
      return;
    }
    this.panel.discardEdits();
    this.panel.dropPending();
    this.perform({ kind: 'close' });
  }

  /** „Löschen" im Panel — ueber das Warn-Modal. */
  protected onPanelRemove(): void {
    const entryId = this.panel.entryId();
    const entry = entryId ? this.entryById(entryId) : undefined;
    if (entryId && entry) {
      this.panel.askDelete(entryId, this.describe(entry));
    }
  }

  /**
   * Hinweis „Speichern": speichern, dann die geparkte Absicht (`afterSave`).
   * Scheitert das Speichern, bleibt alles stehen — auch der Hinweis.
   */
  protected async onNoticeKeep(): Promise<void> {
    await this.save();
  }

  /** Hinweis „Verwerfen": Getipptes weg, dann die geparkte Absicht. Nicht waehrend des Speicherns. */
  protected onNoticeDiscard(): void {
    if (this.panel.busy()) {
      return;
    }
    const pending = this.panel.takePending();
    this.panel.discardEdits();
    this.perform(pending ?? { kind: 'adopt' });
  }

  /* -- Loeschen --------------------------------------------------------- */

  protected onConfirmDelete(): void {
    const id = this.panel.confirmDelete();
    if (!id) {
      return;
    }
    // Vor dem Loeschen bestimmen, solange der Block noch im Raster steht.
    const next = this.focusTargetAfterDelete(id);
    if (this.panel.entryId() === id || this.panel.mode() === 'empty') {
      this.panel.close();
    }
    void this.store.deleteEntry(id);
    this.focusAfterRender(next);
  }

  protected onCancelDelete(): void {
    this.panel.cancelDelete();
  }

  /**
   * Wohin der Fokus nach dem Loeschen geht: auf den naechsten Block desselben
   * Tages (sonst den vorigen), gibt es keinen, auf das Raster. Frueher landete
   * er auf „Zeit eintragen" — weit weg von der Stelle, an der man arbeitete.
   */
  private focusTargetAfterDelete(id: string): () => HTMLElement | null {
    const column = this.columns().find((day) => day.blocks.some((block) => block.id === id));
    const ordered = [...(column?.blocks ?? [])].sort((a, b) => a.topPx - b.topPx);
    const index = ordered.findIndex((block) => block.id === id);
    const neighbour = ordered[index + 1] ?? ordered[index - 1] ?? null;
    return () =>
      (neighbour &&
        this.host.nativeElement.querySelector<HTMLElement>(`[data-entry-id="${neighbour.id}"]`)) ||
      this.scrollRef().nativeElement;
  }

  /**
   * Der Entwurf soll zu sehen sein, auch wenn „Zeit eintragen" eine Uhrzeit
   * ausserhalb des sichtbaren Ausschnitts vorschlaegt.
   */
  private revealInGrid(placement: Placement): void {
    const scroller = this.scrollRef().nativeElement;
    const top = minutesToPx(placement.startMinutes);
    const bottom = minutesToPx(placement.endMinutes);
    if (top < scroller.scrollTop || bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = Math.max(0, top - HOUR_HEIGHT_PX);
    }
  }

  /* -- Route ------------------------------------------------------------ */

  /**
   * Fuer `unsavedChangesGuard`: Verlassen nur ohne ungespeicherte Aenderungen.
   * Sonst bleibt die Seite stehen, das Panel zeigt den Hinweis, und
   * „Verwerfen"/„Speichern" fuehrt die Navigation danach aus. Ein Modal
   * braucht es dafuer nicht. `/login` geht immer (`RouteLeave.intent`).
   */
  canLeave(url: string): boolean {
    const intent = this.routeLeave.intent(url);
    if (!intent || this.panel.request({ kind: 'leave', intent })) {
      return true;
    }
    this.focusNoticeUnlessBusy();
    return false;
  }

  /* -- Fokus ------------------------------------------------------------ */

  /**
   * Merkt sich, welcher Block zuletzt fokussiert war. Der Hinweis zaehlt nicht
   * als Wechsel: wer vom Block in den Hinweis geht, kommt danach dorthin zurueck.
   */
  protected onFocusIn(event: FocusEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('.panel-notice')) {
      return;
    }
    this.lastFocusedBlock = target.closest<HTMLElement>('[data-entry-id]')?.dataset['entryId'] ?? null;
  }

  /**
   * Nach Konflikt-„Speichern"/-„Verwerfen": zurueck auf den Block, wenn der
   * Fokus vorher dort war, sonst auf das erste Panel-Feld.
   */
  private focusAfterConflict(): void {
    const entryId = this.panel.entryId();
    if (entryId && this.lastFocusedBlock === entryId) {
      this.keepFocusOn(entryId);
    } else {
      this.afterRender(() => this.panelRef().focusFirst());
    }
  }

  /**
   * Wechselt ein Block den Tag, zieht er in eine andere Spalte um — Angular baut
   * den Knopf dabei neu und der Fokus faellt auf `body`. Fuer die Tastatur ist
   * das ein Abbruch mitten in der Bedienung, also holen wir ihn zurueck.
   */
  private keepFocusOn(entryId: string): void {
    this.focusAfterRender(() =>
      this.host.nativeElement.querySelector<HTMLElement>(`[data-entry-id="${entryId}"]`),
    );
  }

  /**
   * Fokus erst setzen, wenn gerendert ist: das Panel-Feld entsteht erst mit
   * dem Wechsel des Modus, und nach dem Loeschen gibt das Warn-Modal den Fokus
   * an seinen Ausloeser zurueck — den es dann womoeglich nicht mehr gibt.
   */
  private focusAfterRender(find: () => HTMLElement | null | undefined): void {
    this.afterRender(() => find()?.focus());
  }

  private afterRender(run: () => void): void {
    afterNextRender(run, { injector: this.injector });
  }

  /* -- Navigation ------------------------------------------------------- */

  protected onPreviousWeek(event?: Event): void {
    this.request({ kind: 'week', delta: -1 }, triggerOf(event));
  }

  protected onNextWeek(event?: Event): void {
    this.request({ kind: 'week', delta: 1 }, triggerOf(event));
  }

  protected onToday(event?: Event): void {
    this.request({ kind: 'week', delta: 'today' }, triggerOf(event));
  }

  /** „Erneut laden" im Fehlerzustand. Klappt es, geht der Fokus zum Seitentitel. */
  protected async onRetryLoad(): Promise<void> {
    await this.store.load();
    if (!this.store.loadError()) {
      this.focusAfterRender(() => this.host.nativeElement.querySelector<HTMLElement>('h1'));
    }
  }

  private entryById(id: string): TimeEntry | undefined {
    return this.store.entries().find((entry) => entry.id === id);
  }

  /** Quelle des Panels: Feldwerte des gespeicherten Eintrags. */
  private formValuesOf(id: string): EntryFormValues | null {
    const entry = this.entryById(id);
    return entry ? entryFormValues(placementOf(entry), entry.projectId, entry.description) : null;
  }

  private describe(entry: TimeEntry): string {
    return describePlacement(this.store.projectName(entry.projectId), placementOf(entry));
  }
}

/** Der Knopf, an dem das Ereignis haengt. */
function triggerOf(event: Event | undefined): HTMLElement | null {
  return event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
}
