import { Signal, computed, signal } from '@angular/core';

import { EditSession, LeaveIntent } from '@lib/shared/util-edit';

import { Placement, formatWeekdayLong } from '@lib/shared/util-time';
import {
  EntryFormKey,
  EntryFormProblem,
  EntryFormValues,
  entryFormValues,
} from '@lib/week/domain';

export type PanelMode = 'empty' | 'create' | 'edit';

/** Von wo aus angelegt wurde — dorthin geht der Fokus bei Esc/Abbrechen. */
export type CreateOrigin = 'button' | 'grid';

/**
 * Was der Nutzer als Naechstes wollte. Steht das Panel mit ungespeicherten
 * Aenderungen, wird die Absicht geparkt und erst nach „Speichern" oder
 * „Verwerfen" ausgefuehrt. Laeuft gerade ein Speichern, wartet sie still auf
 * dessen Ende.
 */
export type PanelAction =
  | { readonly kind: 'select'; readonly entryId: string }
  | { readonly kind: 'create'; readonly placement: Placement; readonly origin: CreateOrigin }
  /** Auswahl aufheben bzw. Entwurf verwerfen. */
  | { readonly kind: 'close' }
  /** Der Eintrag hat sich unter dem Panel geaendert (Raster): dessen Stand uebernehmen. */
  | { readonly kind: 'adopt' }
  | { readonly kind: 'week'; readonly delta: number | 'today' }
  /** Route verlassen (auch per Browserverlauf, siehe `RouteLeave`). */
  | { readonly kind: 'leave'; readonly intent: LeaveIntent };

interface PanelState {
  readonly mode: PanelMode;
  /** Beim Bearbeiten: welcher Eintrag. */
  readonly entryId: string | null;
  /** Beim Anlegen: die Ausgangswerte (Aufziehen bzw. „Zeit eintragen"). */
  readonly createValues: EntryFormValues | null;
  readonly origin: CreateOrigin | null;
}

const EMPTY: PanelState = {
  mode: 'empty',
  entryId: null,
  createValues: null,
  origin: null,
};

/**
 * Zustand des Detail-Panels: was ausgewaehlt ist, was getippt wurde, und was
 * wartet, bis ungespeicherte Aenderungen gespeichert oder verworfen sind.
 *
 * Getipptes und geparkte Absichten verwaltet `EditSession`
 * (`@lib/shared/util-edit`, gemeinsam mit den Inline-Zeilen in /projects):
 * die Feldwerte sind das Getippte **ueber** der Quelle, Feld fuer Feld. Quelle
 * ist beim Bearbeiten der Eintrag im Store. Verschiebt man den Block im
 * Raster, folgen also alle Felder, die nicht getippt sind, von selbst, auch
 * wenn anderswo getippt ist: eine Notiz und eine neue Lage vertragen sich,
 * „Speichern" schreibt beides.
 *
 * Ein Konflikt (`conflict`) entsteht nur, wenn sich im Store ein Feld aendert,
 * das getippt ist — etwa „Bis" getippt, dann ⇧↓ im Raster — und zwar auf einen
 * anderen Wert als den getippten. Dann wird nichts ueberschrieben; der Hinweis
 * sagt, was „Speichern" und was „Verwerfen" tut.
 *
 * Hier dazu: was das Panel zeigt (Modus, Eintrag, Entwurf), die Texte des
 * Hinweises und die Loeschrueckfrage. Kennung und Text der Rueckfrage werden
 * gemeinsam gesetzt und gemeinsam geloescht, damit nie der falsche Eintrag
 * geloescht wird.
 */
export class WeekPanel {
  private readonly state = signal<PanelState>(EMPTY);
  private readonly confirm = signal<string | null>(null);
  private deletingId: string | null = null;

  /** Fehler am Feld (Pruefung vor dem Speichern). */
  readonly problem = signal<EntryFormProblem | null>(null);

  /** Woraus das Panel gerade schoepft, ohne Getipptes. */
  private readonly source = computed<EntryFormValues | null>(() => {
    const state = this.state();
    if (state.mode === 'create') {
      return state.createValues;
    }
    return state.mode === 'edit' && state.entryId ? this.sourceOf(state.entryId) : null;
  });

  private readonly session = new EditSession<EntryFormValues, PanelAction>(() => this.source(), {
    pending: () => {
      const state = this.state();
      return state.mode === 'edit' && state.entryId !== null && this.writing(state.entryId);
    },
  });

  /**
   * @param sourceOf Feldwerte des gespeicherten Eintrags, `null`: gibt es
   *   (in dieser Woche) nicht. Wird in einem `computed` gelesen und muss
   *   deshalb selbst aus Signals lesen.
   * @param writing Steht der Eintrag gerade unbestaetigt im Store (Raster
   *   bewegt, Schreibvorgang unterwegs)? Dann faellt nichts Getipptes aus dem
   *   Overlay, auch wenn der Store gerade genau so aussieht — er kann noch
   *   zurueckrollen. Liest ebenfalls aus Signals.
   */
  constructor(
    private readonly sourceOf: (entryId: string) => EntryFormValues | null,
    private readonly writing: (entryId: string) => boolean = () => false,
  ) {}

  /** Verschwindet der bearbeitete Eintrag (geloescht), ist das Panel leer. */
  readonly mode: Signal<PanelMode> = computed(() => {
    const state = this.state();
    return state.mode === 'edit' && this.source() === null ? 'empty' : state.mode;
  });
  readonly entryId: Signal<string | null> = computed(() =>
    this.mode() === 'edit' ? this.state().entryId : null,
  );
  readonly origin: Signal<CreateOrigin | null> = computed(() => this.state().origin);
  readonly values: Signal<EntryFormValues | null> = computed(() =>
    this.mode() === 'empty' ? null : this.session.values(),
  );

  readonly dirty: Signal<boolean> = computed(() => this.mode() !== 'empty' && this.session.dirty());

  readonly conflict: Signal<boolean> = this.session.conflict;

  /** Steht der Hinweis „Ungespeicherte Änderungen"? (siehe `EditSession.notice`) */
  readonly notice: Signal<boolean> = this.session.notice;

  /** Was der Hinweis sagt: wozu er da ist und was die beiden Knoepfe tun. */
  readonly noticeMessage: Signal<string | null> = computed(() => {
    if (!this.notice()) {
      return null;
    }
    const conflict = this.conflictText();
    if (conflict) {
      return conflict;
    }
    return `Erst speichern oder verwerfen — danach ${intentText(this.session.pending())}.`;
  });

  /** Wechselt bei jeder neu geparkten Absicht, auch derselben. */
  readonly noticeRevision: Signal<number> = this.session.noticeRevision;

  readonly busy: Signal<boolean> = this.session.busy;
  /** Die geparkte Absicht (ohne sie herauszunehmen). */
  readonly pending: Signal<PanelAction | null> = this.session.pending;

  /** Fett im Warn-Modal: welcher Eintrag (Projekt, Tag, Zeit). */
  readonly confirmSubject: Signal<string | null> = this.confirm.asReadonly();
  /** Text des Warn-Modals; `null` heisst: geschlossen. */
  readonly confirmMessage: Signal<string | null> = computed(() =>
    this.confirm() === null ? null : 'Der Eintrag wird endgültig gelöscht.',
  );

  /* -- Absichten ---------------------------------------------------------- */

  /**
   * Darf die Absicht sofort ausgefuehrt werden? Nein, solange gespeichert wird
   * (sie wartet still auf das Ergebnis) oder ungespeicherte Aenderungen da
   * sind (dann erscheint der Hinweis). Die Auswahl wechselt in beiden Faellen
   * **nicht**.
   */
  request(action: PanelAction): boolean {
    return this.session.request(action);
  }

  /**
   * Die geparkte Absicht herausnehmen (nach „Speichern"/„Verwerfen"). Steht der
   * Hinweis nur wegen eines Konflikts, ist die Absicht „uebernehmen".
   */
  takePending(): PanelAction | null {
    const conflict = this.conflict();
    return this.session.takePending() ?? (conflict ? { kind: 'adopt' } : null);
  }

  /** Ohne Ausfuehren vergessen (die Absicht hat sich erledigt). */
  dropPending(): void {
    this.session.dropPending();
  }

  /* -- Zustandswechsel ------------------------------------------------------ */

  openEdit(entryId: string): void {
    this.set({ ...EMPTY, mode: 'edit', entryId });
  }

  /** Neuer Eintrag an dieser Stelle. Bewusst ohne Projektvorauswahl. */
  openCreate(placement: Placement, origin: CreateOrigin): void {
    this.set({
      ...EMPTY,
      mode: 'create',
      createValues: entryFormValues(placement, null, ''),
      origin,
    });
  }

  close(): void {
    this.set(EMPTY);
  }

  /** Getipptes verwerfen; das Panel zeigt wieder den gespeicherten Stand. */
  discardEdits(): void {
    this.session.discard();
    this.problem.set(null);
  }

  /**
   * Ein Feld getippt. Steht es danach auf dem gespeicherten Wert, ist es nicht
   * mehr getippt — und folgt wieder dem Raster.
   */
  change(key: EntryFormKey, value: string): void {
    if (this.mode() === 'empty') {
      return;
    }
    this.session.change(key, value);
    const problem = this.problem();
    if (problem && fieldOf(key) === problem.field) {
      this.problem.set(null);
    }
  }

  /** Rundung uebernehmen: die Zeitfelder zeigen, was gleich gespeichert wird. */
  applyRounding(from: string, to: string): void {
    this.change('from', from);
    this.change('to', to);
  }

  beginSave(): void {
    this.session.beginSave();
    this.problem.set(null);
  }

  /**
   * Gespeichert: das Panel bleibt mit dem Eintrag offen. Getipptes ist ab
   * jetzt der gespeicherte Stand und kommt wieder aus dem Store — auch dort,
   * wo die Umstellung die Zeit verschoben hat.
   *
   * Eine waehrend des Speicherns geparkte Absicht bleibt stehen; die Seite
   * nimmt sie danach mit `takePending()` heraus und fuehrt sie aus.
   */
  saved(entryId: string): void {
    this.state.set({ ...EMPTY, mode: 'edit', entryId });
    this.problem.set(null);
    this.session.saved();
  }

  /** Gescheitert: Eingaben und eine geparkte Absicht bleiben stehen. */
  saveFailed(): void {
    this.session.saveFailed();
  }

  /* -- Loeschen ------------------------------------------------------------- */

  askDelete(entryId: string, label: string): void {
    this.deletingId = entryId;
    this.confirm.set(label);
  }

  /** Rueckfrage bestaetigt: Kennung heraus, Modal zu. */
  confirmDelete(): string | null {
    const id = this.deletingId;
    this.deletingId = null;
    this.confirm.set(null);
    return id;
  }

  cancelDelete(): void {
    this.deletingId = null;
    this.confirm.set(null);
  }

  private set(state: PanelState): void {
    this.state.set(state);
    this.session.restart();
    this.problem.set(null);
  }

  /**
   * „Die Zeit wurde im Raster geändert (jetzt 9:15–10:15). Speichern übernimmt
   * deine Eingabe 9:00–10:45, Verwerfen behält das Raster."
   */
  private conflictText(): string | null {
    const keys = this.session.conflictKeys();
    const source = this.source();
    const values = this.values();
    if (keys.length === 0 || !source || !values) {
      return null;
    }
    const day = keys.includes('dayKey');
    const time = keys.includes('from') || keys.includes('to');
    if (!day && !time) {
      return (
        'Der Eintrag wurde inzwischen geändert. Speichern übernimmt deine Eingabe, ' +
        'Verwerfen behält den gespeicherten Stand.'
      );
    }
    const where = (v: EntryFormValues) =>
      [day ? formatWeekdayLong(v.dayKey) : null, time ? timeRange(v) : null]
        .filter(Boolean)
        .join(' ');
    const what = day && time ? 'Tag und Zeit wurden' : day ? 'Der Tag wurde' : 'Die Zeit wurde';
    return (
      `${what} im Raster geändert (jetzt ${where(source)}). ` +
      `Speichern übernimmt deine Eingabe ${where(values)}, Verwerfen behält das Raster.`
    );
  }
}

/** `09:15` → `9:15`, wie gesprochen. */
function shortClock(value: string): string {
  return value.replace(/^0(\d)/, '$1');
}

function timeRange(values: EntryFormValues): string {
  return `${shortClock(values.from)}–${shortClock(values.to)}`;
}

/** Was nach „Speichern"/„Verwerfen" passiert — Teil des Hinweistexts. */
function intentText(action: PanelAction | null): string {
  switch (action?.kind) {
    case 'select':
      return 'öffnet sich der gewählte Eintrag';
    case 'create':
      return 'beginnt der neue Eintrag';
    case 'close':
      return 'schließt das Panel';
    case 'week':
      return action.delta === 'today'
        ? 'geht es zur aktuellen Woche'
        : action.delta < 0
          ? 'geht es zur vorigen Woche'
          : 'geht es zur nächsten Woche';
    case 'leave':
      return 'verlässt du die Woche';
    default:
      return 'geht es weiter';
  }
}

/** Welcher Fehler mit diesem Feld erledigt sein koennte (die Notiz hat keinen). */
function fieldOf(key: EntryFormKey): EntryFormProblem['field'] | null {
  switch (key) {
    case 'dayKey':
      return 'day';
    case 'projectId':
      return 'project';
    case 'description':
      return null;
    default:
      return 'time';
  }
}
