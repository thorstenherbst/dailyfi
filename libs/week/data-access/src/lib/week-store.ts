import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';

import {
  RepositoryError,
  RepositoryErrorCode,
  TransientErrorFeedback,
  USER_FEEDBACK,
  isSyncFailure,
} from '@lib/shared/data-access-supabase';
import {
  DayKey,
  Placement,
  addDays,
  describePlacement,
  isoWeekNumber,
  startOfWeek,
  sumHours,
  todayKey,
  wallToInstant,
  weekDayKeys,
} from '@lib/shared/util-time';
import { Project, TimeEntry, instantsOf, placementOf, spansMidnight } from '@lib/week/domain';

import { TimeEntryRepository } from './time-entry-repository';

/**
 * Gehaltene Pfeiltaste heisst rund 30 Tastendrucke pro Sekunde. Ohne Bremse
 * waere das ein Schreibvorgang je Druck, und ein Fehlschlag mittendrin wuerde
 * auf einen laengst ueberholten Stand zurueckrollen. Das Raster bewegt sich
 * weiter sofort, gespeichert wird erst, wenn die Taste zur Ruhe kommt.
 */
const NUDGE_DELAY_MS = 400;

/**
 * Unsichtbares Zeichen (U+200B), das jede zweite Ansage traegt, damit sich der
 * Textknoten auch bei gleichlautender Meldung aendert.
 *
 * Bewusst berechnet statt als Literal: Prettier wandelt `'​'` im Quelltext
 * in das nackte Zeichen um, und ein nacktes unsichtbares Zeichen verschwindet
 * frueher oder spaeter lautlos aus einer Datei — danach saehe niemand, warum
 * Screenreader ploetzlich Wiederholungen verschlucken.
 */
const ANNOUNCEMENT_MARKER = String.fromCharCode(0x200b);

const ERROR_TEXTS: Record<RepositoryErrorCode, string> = {
  offline: 'Keine Verbindung zum Server.',
  'session-expired': 'Die Anmeldung war abgelaufen.',
  unauthorized: 'Dafür fehlt die Berechtigung.',
  'invalid-range':
    'Diese Zeitspanne nimmt der Server nicht an — das Ende muss nach dem Beginn liegen.',
  'invalid-value': 'Diese Eingabe nimmt der Server nicht an.',
  'in-use': 'Das geht nicht, solange noch etwas daran hängt.',
  'not-found': 'Diesen Eintrag gibt es nicht mehr. Bitte die Seite neu laden.',
  unknown: 'Das hat nicht geklappt.',
};

/**
 * Jeder Fehler wird hier zu einem deutschen Satz. Der technische Wortlaut ist
 * schon im Repository in der Konsole gelandet und hat in der Oberflaeche
 * nichts verloren.
 */
function describeError(error: unknown): string {
  if (error instanceof RepositoryError) {
    return ERROR_TEXTS[error.code];
  }
  if (error instanceof RangeError) {
    return 'Die angegebene Zeit ergibt keinen gültigen Zeitpunkt.';
  }
  console.error('[Dailyfi] Unerwarteter Fehler:', error);
  return ERROR_TEXTS.unknown;
}

/**
 * Zustand der Wochenansicht. Jede Aenderung geht sofort ins UI und erst danach
 * zur Datenbank; scheitert der Aufruf, wird genau dieser eine Eintrag
 * zurueckgerollt und der Fehler als Toast gemeldet — nie als stiller Verlust.
 *
 * Rueckmeldungen laufen ueber `USER_FEEDBACK` (die App bindet es an die
 * Toasts). Erfolg melden nur die Wege ueber das Panel — anlegen, bearbeiten,
 * loeschen. Verschieben und Groesse aendern sagt die Live-Region des Rasters
 * an; ein Toast je Pfeiltaste waere Laerm.
 */
@Injectable()
export class WeekStore implements OnDestroy {
  private readonly repository = inject(TimeEntryRepository);
  private readonly feedback = inject(USER_FEEDBACK);

  /** Montag der angezeigten Woche. */
  readonly weekStart = signal<DayKey>(startOfWeek(todayKey()));
  readonly projects = signal<readonly Project[]>([]);
  readonly entries = signal<readonly TimeEntry[]>([]);
  readonly loading = signal(false);
  /**
   * Die Woche liess sich nicht laden. Die Seite zeigt dann einen Fehlerzustand
   * mit „Erneut laden" statt eines leeren Rasters, das „nichts erfasst" behauptet.
   */
  readonly loadError = signal<string | null>(null);
  /** Letzter Schreib- oder Ladevorgang ist am Server gescheitert (nicht: abgelehnt). */
  readonly syncError = signal(false);

  /** Schreibvorgaenge, die zum Server unterwegs sind. */
  private readonly inFlight = signal(0);
  /** Tastaturbewegungen, die noch auf ihre Ruhepause warten. */
  private readonly queued = signal(0);
  /** Etwas ist geaendert, aber noch nicht bestaetigt: „speichert …". */
  readonly saving = computed(() => this.inFlight() + this.queued() > 0);
  /**
   * Eintraege mit unbestaetigter Aenderung (Tastaturbewegung wartet oder ein
   * Schreibvorgang ist unterwegs), je Kennung gezaehlt. Erst nach einem
   * Rollback wieder frei — das Panel verlaesst sich darauf (`writing`).
   */
  private readonly unconfirmed = signal<ReadonlyMap<string, number>>(new Map());
  /** Text der `aria-live`-Region. */
  readonly announcement = signal('');

  /** Der Toast zum letzten Ladefehler — weg damit, sobald wieder geladen ist. */
  private readonly loadErrorToast = new TransientErrorFeedback(this.feedback);

  readonly days = computed<DayKey[]>(() => weekDayKeys(this.weekStart()));
  readonly weekNumber = computed(() => isoWeekNumber(this.weekStart()));
  readonly totalHours = computed(() => sumHours(this.entries()));
  readonly projectsById = computed(
    () => new Map(this.projects().map((project) => [project.id, project])),
  );

  /** Offene, noch nicht geschriebene Tastaturbewegungen je Eintrag. */
  private readonly nudgeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Stand vor der ersten Bewegung einer Serie — Ziel eines Rollbacks. */
  private readonly nudgeOrigins = new Map<string, TimeEntry>();

  ngOnDestroy(): void {
    for (const timer of this.nudgeTimers.values()) {
      clearTimeout(timer);
    }
    this.nudgeTimers.clear();
    this.nudgeOrigins.clear();
    this.queued.set(0);
  }

  /**
   * Steht dieser Eintrag gerade unbestaetigt im Raster? Solange ja, kann er
   * optimistisch vorauseilen und noch zurueckfallen. Liest aus einem Signal.
   */
  writing(id: string): boolean {
    return (this.unconfirmed().get(id) ?? 0) > 0;
  }

  projectName(projectId: string): string {
    return this.projectsById().get(projectId)?.name ?? 'Unbekanntes Projekt';
  }

  /**
   * `loadError` bleibt stehen, bis das Ergebnis da ist: waehrend „Erneut laden"
   * laeuft, steht die Fehlerkarte mit „Lädt …" weiter da, und der Fokus bleibt
   * auf ihrem Knopf, statt mit ihr auf `body` zu fallen.
   */
  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const from = wallToInstant(this.weekStart(), 0);
      const to = wallToInstant(addDays(this.weekStart(), 7), 0);
      // Projekte werden bewusst bei jedem Laden mitgeholt statt einmal je
      // Instanz zwischengespeichert. Der Zwischenspeicher sparte eine kleine
      // Abfrage pro Wochenwechsel und kostete dafuer Richtigkeit: sobald sich
      // Projekte anlegen lassen, erschienen neue erst nach einem
      // Neuladen der Seite in der Auswahl — und niemand haette daran gedacht,
      // den Zwischenspeicher zu verwerfen. Eine Handvoll Projekte ist die
      // Abfrage nicht wert.
      const [projects, entries] = await Promise.all([
        this.repository.listProjects(),
        this.repository.listRange(from, to),
      ]);
      this.projects.set(projects);
      this.entries.set(entries);
      this.syncError.set(false);
      this.loadError.set(null);
      this.loadErrorToast.dismiss();
    } catch (error) {
      // Nichts Halbes stehen lassen: Eintraege der vorigen Woche unter dem
      // Kopf dieser Woche waeren schlimmer als gar keine.
      this.entries.set([]);
      const reason = describeError(error);
      this.loadError.set(reason);
      this.syncError.set(isSyncFailure(error));
      this.loadErrorToast.error('Die Woche konnte nicht geladen werden.', { detail: reason });
    } finally {
      this.loading.set(false);
    }
  }

  async showWeekOf(dayKey: DayKey): Promise<void> {
    await this.flushPending();
    this.weekStart.set(startOfWeek(dayKey));
    await this.load();
  }

  async shiftWeek(deltaWeeks: number): Promise<void> {
    await this.showWeekOf(addDays(this.weekStart(), deltaWeeks * 7));
  }

  async goToToday(): Promise<void> {
    await this.showWeekOf(todayKey());
  }

  /** Neuer Eintrag. Er steht sofort im Raster, auch bevor die Datenbank antwortet. */
  async createEntry(
    placement: Placement,
    projectId: string,
    description: string,
  ): Promise<TimeEntry | null> {
    const temporaryId = `neu-${Math.random().toString(36).slice(2)}`;

    let instants: { startedAt: Date; endedAt: Date };
    try {
      instants = instantsOf(placement);
    } catch (error) {
      this.fail('Der Eintrag konnte nicht angelegt werden', error, 'panel');
      return null;
    }

    const optimistic: TimeEntry = { id: temporaryId, projectId, description, ...instants };
    this.entries.update((list) => [...list, optimistic]);

    try {
      const saved = await this.tracked(() =>
        this.repository.create({ projectId, description, ...instants }),
      );
      this.entries.update((list) =>
        list.map((entry) => (entry.id === temporaryId ? saved : entry)),
      );
      // Die tatsaechlich gespeicherte Zeit, nicht die eingegebene.
      this.confirm('Eintrag gespeichert', saved);
      return saved;
    } catch (error) {
      this.entries.update((list) => list.filter((entry) => entry.id !== temporaryId));
      this.fail('Der Eintrag konnte nicht gespeichert werden', error, 'panel');
      return null;
    }
  }

  /** Verschieben und Groesse aendern per Maus — schreibt sofort. */
  async moveEntry(id: string, placement: Placement): Promise<void> {
    const previous = this.entries().find((entry) => entry.id === id);
    if (!previous || !this.mayRewrite(previous)) {
      return;
    }

    let instants: { startedAt: Date; endedAt: Date };
    try {
      instants = instantsOf(placement);
    } catch (error) {
      this.fail('Die Änderung konnte nicht übernommen werden', error);
      return;
    }

    await this.write(id, previous, { ...previous, ...instants }, null);
  }

  /**
   * Dasselbe per Tastatur: im Raster sofort sichtbar, geschrieben erst nach
   * einer kurzen Ruhepause. Eine Serie von Tastendrucken wird zu einem
   * Schreibvorgang.
   */
  nudgeEntry(id: string, placement: Placement): void {
    const current = this.entries().find((entry) => entry.id === id);
    if (!current || !this.mayRewrite(current)) {
      return;
    }

    let instants: { startedAt: Date; endedAt: Date };
    try {
      instants = instantsOf(placement);
    } catch (error) {
      this.fail('Die Änderung konnte nicht übernommen werden', error);
      return;
    }

    if (!this.nudgeOrigins.has(id)) {
      this.nudgeOrigins.set(id, current);
      this.queued.update((count) => count + 1);
      this.hold(id);
    }

    const next: TimeEntry = { ...current, ...instants };
    this.entries.update((list) => list.map((entry) => (entry.id === id ? next : entry)));
    this.announceEntry(next, '');

    const running = this.nudgeTimers.get(id);
    if (running !== undefined) {
      clearTimeout(running);
    }
    this.nudgeTimers.set(
      id,
      setTimeout(() => void this.flushNudge(id), NUDGE_DELAY_MS),
    );
  }

  /**
   * Speichern aus dem Panel. `true` nur, wenn der Server den Eintrag
   * angenommen hat — sonst bleibt das Panel mit den Eingaben stehen.
   */
  async editEntry(
    id: string,
    placement: Placement,
    projectId: string,
    description: string,
  ): Promise<boolean> {
    const previous = this.entries().find((entry) => entry.id === id);
    if (!previous) {
      this.fail(
        'Die Änderung konnte nicht gespeichert werden',
        new RepositoryError('not-found', id),
        'panel',
      );
      return false;
    }
    if (!this.mayRewrite(previous)) {
      return false;
    }

    let instants: { startedAt: Date; endedAt: Date };
    try {
      instants = instantsOf(placement);
    } catch (error) {
      this.fail('Die Änderung konnte nicht übernommen werden', error, 'panel');
      return false;
    }

    return this.write(
      id,
      previous,
      { ...previous, projectId, description, ...instants },
      'Eintrag geändert',
    );
  }

  async deleteEntry(id: string): Promise<void> {
    const previous = this.entries().find((entry) => entry.id === id);
    if (!previous) {
      return;
    }
    this.cancelNudge(id);

    this.entries.update((list) => list.filter((entry) => entry.id !== id));

    try {
      await this.tracked(() => this.repository.remove(id));
      this.confirm('Eintrag gelöscht', previous);
    } catch (error) {
      this.entries.update((list) => [...list, previous]);
      this.fail('Der Eintrag konnte nicht gelöscht werden', error);
    }
  }

  /** Noch offene Tastaturbewegungen sofort schreiben (Wochenwechsel, Verlassen). */
  async flushPending(): Promise<void> {
    await Promise.all([...this.nudgeTimers.keys()].map((id) => this.flushNudge(id)));
  }

  private cancelNudge(id: string): void {
    const running = this.nudgeTimers.get(id);
    if (running !== undefined) {
      clearTimeout(running);
    }
    this.nudgeTimers.delete(id);
    if (this.nudgeOrigins.delete(id)) {
      this.queued.update((count) => count - 1);
      this.release(id);
    }
  }

  private async flushNudge(id: string): Promise<void> {
    const running = this.nudgeTimers.get(id);
    if (running !== undefined) {
      clearTimeout(running);
    }
    this.nudgeTimers.delete(id);

    const origin = this.nudgeOrigins.get(id);
    const held = this.nudgeOrigins.delete(id);
    if (held) {
      this.queued.update((count) => count - 1);
    }
    try {
      const current = this.entries().find((entry) => entry.id === id);
      if (!origin || !current) {
        return;
      }
      // Hin und wieder zurueck bewegt: nichts zu schreiben.
      if (
        origin.startedAt.getTime() === current.startedAt.getTime() &&
        origin.endedAt.getTime() === current.endedAt.getTime()
      ) {
        return;
      }

      try {
        await this.tracked(() =>
          this.repository.update(id, {
            projectId: current.projectId,
            startedAt: current.startedAt,
            endedAt: current.endedAt,
            description: current.description,
          }),
        );
      } catch (error) {
        this.entries.update((list) => list.map((entry) => (entry.id === id ? origin : entry)));
        this.fail('Die Änderung konnte nicht gespeichert werden', error, 'grid');
        this.announceReset(origin);
      }
    } finally {
      // Erst nach einem Rollback: vorher saehe das Panel den optimistischen
      // Stand als bestaetigt an.
      if (held) {
        this.release(id);
      }
    }
  }

  /**
   * `success`: Text des Erfolgs-Toasts (Panel). `null`: kein Toast, nur die
   * Live-Region des Rasters (Maus).
   */
  private async write(
    id: string,
    previous: TimeEntry,
    next: TimeEntry,
    success: string | null,
  ): Promise<boolean> {
    this.cancelNudge(id);
    this.hold(id);
    this.entries.update((list) => list.map((entry) => (entry.id === id ? next : entry)));
    if (success === null) {
      this.announceEntry(next, '');
    }

    try {
      await this.tracked(() =>
        this.repository.update(id, {
          projectId: next.projectId,
          startedAt: next.startedAt,
          endedAt: next.endedAt,
          description: next.description,
        }),
      );
      if (success !== null) {
        this.confirm(success, next);
      }
      return true;
    } catch (error) {
      this.entries.update((list) => list.map((entry) => (entry.id === id ? previous : entry)));
      if (success === null) {
        this.fail('Die Änderung konnte nicht gespeichert werden', error, 'grid');
        this.announceReset(previous);
      } else {
        this.fail('Die Änderung konnte nicht gespeichert werden', error, 'panel');
      }
      return false;
    } finally {
      // Nach dem Rollback (siehe `writing`).
      this.release(id);
    }
  }

  private hold(id: string): void {
    this.unconfirmed.update((map) => new Map(map).set(id, (map.get(id) ?? 0) + 1));
  }

  private release(id: string): void {
    this.unconfirmed.update((map) => {
      const next = new Map(map);
      const count = (next.get(id) ?? 0) - 1;
      if (count > 0) {
        next.set(id, count);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  /**
   * Altdaten, die über Mitternacht reichen, kann das Raster darstellen, aber
   * nicht bearbeiten — es würde die gekürzte Fassung zurückschreiben.
   */
  private mayRewrite(entry: TimeEntry): boolean {
    if (!spansMidnight(entry)) {
      return true;
    }
    this.feedback.error('Dieser Eintrag reicht über Mitternacht hinaus.', {
      detail:
        'Das Wochenraster kann ihn anzeigen, aber nicht ändern — sonst gingen die Stunden ' +
        'nach Mitternacht verloren.',
    });
    return false;
  }

  /** Ansage aus dem tatsächlich gespeicherten Zeitraum, nicht aus der Eingabe. */
  private announceEntry(entry: TimeEntry, suffix: string): void {
    const text = describePlacement(this.projectName(entry.projectId), placementOf(entry));
    this.announce(suffix ? `${text} ${suffix}` : text);
  }

  /**
   * Nach einem Rueckroll im Raster steht dort wieder die alte Zeit — angesagt
   * war aber die neue. Die Live-Region des Rasters sagt deshalb, wo der Block
   * jetzt wirklich steht; der Fehler-Toast sagt, warum (und nur das).
   */
  private announceReset(entry: TimeEntry): void {
    this.announce(
      `Zurückgesetzt: ${describePlacement(this.projectName(entry.projectId), placementOf(entry))}`,
    );
  }

  /**
   * Gleicher Text zweimal hintereinander wuerde von Screenreadern verschluckt,
   * weil sich der Knoten nicht aendert. Ein unsichtbares Zeichen am Ende
   * wechselt bei jeder Ansage.
   */
  announce(text: string): void {
    const marker = this.announcement().endsWith(ANNOUNCEMENT_MARKER) ? '' : ANNOUNCEMENT_MARKER;
    this.announcement.set(`${text}${marker}`);
  }

  /** Zaehlt einen Schreibvorgang, solange er unterwegs ist, fuer `saving`. */
  private async tracked<T>(operation: () => Promise<T>): Promise<T> {
    this.inFlight.update((count) => count + 1);
    try {
      const result = await operation();
      this.syncError.set(false);
      return result;
    } finally {
      this.inFlight.update((count) => count - 1);
    }
  }

  private confirm(message: string, entry: TimeEntry): void {
    this.feedback.success(message, {
      detail: describePlacement(this.projectName(entry.projectId), placementOf(entry)),
    });
  }

  /**
   * Fehler als Toast (der ist eine `alert`-Region). Die Statusleiste zeigt
   * „Fehler" nur, wenn der Server nicht erreichbar war o. ae. — nicht, wenn er
   * eine Eingabe abgelehnt hat.
   *
   * `reset`: wer den Rueckroll ansagt. `toast` haengt „Die Ansicht wurde
   * zurückgesetzt." an; `grid` ueberlaesst das der Live-Region des Rasters, die
   * die zurueckgesetzte Position nennt (`announceReset`) — sonst hoerte man es
   * doppelt. `panel`: Speichern aus dem Detail-Panel — zurueckgesetzt wird dort
   * nichts, die Eingaben bleiben stehen, und das sagt der Toast.
   */
  private fail(
    headline: string,
    error: unknown,
    reset: 'toast' | 'grid' | 'panel' = 'toast',
  ): void {
    // Eine unmoegliche Uhrzeit (RangeError) hat den Server nie erreicht.
    if (!(error instanceof RangeError) && isSyncFailure(error)) {
      this.syncError.set(true);
    }
    const suffix =
      reset === 'panel'
        ? ' Deine Eingaben stehen noch im Panel.'
        : error instanceof RangeError || reset === 'grid'
          ? ''
          : ' Die Ansicht wurde zurückgesetzt.';
    this.feedback.error(`${headline}.`, { detail: `${describeError(error)}${suffix}` });
  }
}
