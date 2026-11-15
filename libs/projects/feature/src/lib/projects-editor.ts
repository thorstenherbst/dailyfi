import { Signal, computed, signal } from '@angular/core';

import {
  Client,
  DEFAULT_PROJECT_COLOR,
  ProjectRecord,
  RowFormKey,
  RowFormProblem,
  RowFormValues,
  clientFormValues,
  newProjectFormValues,
  projectColorSlot,
  projectFormValues,
} from '@lib/projects/domain';
import { EditSession, LeaveIntent } from '@lib/shared/util-edit';

/** Welche Zeile bearbeitet wird. */
export type RowTarget =
  | { readonly kind: 'project'; readonly id: string }
  | { readonly kind: 'client'; readonly id: string }
  | { readonly kind: 'new-project'; readonly clientId: string }
  | { readonly kind: 'new-client' };

/**
 * Was der Nutzer als Naechstes wollte. Hat die aktive Zeile Ungespeichertes,
 * wird die Absicht geparkt und erst nach „Speichern" oder „Verwerfen"
 * ausgefuehrt; laeuft gerade ein Speichern, wartet sie still auf dessen Ende.
 */
export type RowIntent =
  /** Eine Zeile bearbeiten bzw. die Anlage beginnen (`seed`: schon Getipptes). */
  | { readonly kind: 'edit'; readonly target: RowTarget; readonly seed?: string }
  /** Bearbeiten beenden (Esc). */
  | { readonly kind: 'close' }
  | { readonly kind: 'archive'; readonly target: { readonly kind: 'project' | 'client'; readonly id: string } }
  | { readonly kind: 'filter'; readonly show: boolean }
  | { readonly kind: 'leave'; readonly intent: LeaveIntent };

/** Kennung einer Zeile im DOM (`data-row`) und im Zustand. */
export function rowKey(target: RowTarget): string {
  switch (target.kind) {
    case 'project':
      return `p:${target.id}`;
    case 'client':
      return `c:${target.id}`;
    case 'new-project':
      return `np:${target.clientId}`;
    case 'new-client':
      return 'nc';
  }
}

export interface ProjectsLookup {
  project(id: string): ProjectRecord | undefined;
  client(id: string): Client | undefined;
}

/**
 * Zustand der Inline-Bearbeitung in /projects: **genau eine** Zeile ist im
 * Bearbeiten-Modus, ihr Getipptes liegt feldweise ueber dem gespeicherten
 * Stand (`EditSession`, dasselbe Muster wie das Detail-Panel in /week).
 *
 * Kennt weder DOM noch Store; was ausgefuehrt wird und wohin der Fokus geht,
 * entscheidet die Seite. Hier steht nur, *welche* Zeile, *was* getippt ist,
 * *ob* eine Absicht sofort laufen darf und *was* wartet.
 */
export class ProjectsEditor {
  private readonly active = signal<RowTarget | null>(null);
  /**
   * Kam die wartende Absicht aus dem Tippen in einer Leerzeile? Dann steht
   * hier, wo die liegt — von der bearbeiteten Zeile aus gesehen.
   */
  private readonly typedAt = signal<'above' | 'below' | null>(null);

  /** Fehler am Feld (Pruefung vor dem Speichern). */
  readonly problem = signal<RowFormProblem | null>(null);

  private readonly source = computed<RowFormValues | null>(() => {
    const target = this.active();
    switch (target?.kind) {
      case 'project': {
        const project = this.lookup.project(target.id);
        return project ? projectFormValues(project) : null;
      }
      case 'client': {
        const client = this.lookup.client(target.id);
        return client ? clientFormValues(client.name) : null;
      }
      case 'new-project':
        return newProjectFormValues(target.clientId, DEFAULT_PROJECT_COLOR);
      case 'new-client':
        return clientFormValues('');
      default:
        return null;
    }
  });

  private readonly session = new EditSession<RowFormValues, RowIntent>(() => this.source());

  /** @param lookup Liest aus Signals (Store) — wird in einem `computed` gelesen. */
  constructor(private readonly lookup: ProjectsLookup) {}

  /** Die Zeile im Bearbeiten-Modus; `null`, auch wenn es sie nicht mehr gibt. */
  readonly target: Signal<RowTarget | null> = computed(() =>
    this.source() === null ? null : this.active(),
  );
  readonly activeKey: Signal<string | null> = computed(() => {
    const target = this.target();
    return target ? rowKey(target) : null;
  });

  readonly values: Signal<RowFormValues | null> = this.session.values;
  /** Nur die getippten Felder — daraus wird der Schreibzugriff. */
  readonly edits: Signal<Partial<RowFormValues>> = this.session.edits;
  readonly dirty: Signal<boolean> = this.session.dirty;
  readonly notice: Signal<boolean> = this.session.notice;
  readonly noticeRevision: Signal<number> = this.session.noticeRevision;
  readonly busy: Signal<boolean> = this.session.busy;
  readonly pending: Signal<RowIntent | null> = this.session.pending;

  /**
   * Wartet eine Absicht, die durch Tippen entstand? Dann bleibt der Fokus, wo
   * er ist (WCAG 3.2.2) — auch wenn das Speichern scheitert.
   */
  readonly typedElsewhere: Signal<boolean> = computed(
    () => this.typedAt() !== null && this.pending() !== null,
  );

  /** Was der Hinweis sagt: wozu er steht und was danach passiert. */
  readonly noticeMessage: Signal<string | null> = computed(() => {
    if (!this.notice()) {
      return null;
    }
    if (this.session.conflict() && !this.pending()) {
      return (
        'Die Zeile wurde inzwischen geändert. Speichern übernimmt deine Eingabe, ' +
        'Verwerfen behält den gespeicherten Stand.'
      );
    }
    const next = `Erst speichern oder verwerfen — danach ${intentText(this.pending())}.`;
    switch (this.typedElsewhere() ? this.typedAt() : null) {
      case 'below':
        return `${next} Dein Getipptes bleibt stehen; die Knöpfe erreichst du mit Umschalt+Tab.`;
      case 'above':
        return `${next} Dein Getipptes bleibt stehen; die Knöpfe erreichst du mit Tab.`;
      default:
        return next;
    }
  });

  /* -- Absichten ---------------------------------------------------------- */

  /**
   * Darf die Absicht sofort laufen? Sonst ist sie geparkt (siehe `EditSession`).
   * @param typedAt Nur beim Tippen in eine Leerzeile: wo die liegt.
   */
  request(intent: RowIntent, typedAt: 'above' | 'below' | null = null): boolean {
    const now = this.session.request(intent);
    this.typedAt.set(now ? null : typedAt);
    return now;
  }

  takePending(): RowIntent | null {
    this.typedAt.set(null);
    return this.session.takePending();
  }

  dropPending(): void {
    this.typedAt.set(null);
    this.session.dropPending();
  }

  /* -- Zustandswechsel ---------------------------------------------------- */

  /** Diese Zeile bearbeiten; `seed` ist bei der Leerzeile das schon Getippte. */
  open(target: RowTarget, seed?: string): void {
    this.active.set(target);
    this.typedAt.set(null);
    this.session.restart();
    this.problem.set(null);
    if (seed) {
      this.session.change('name', seed);
    }
  }

  close(): void {
    this.active.set(null);
    this.typedAt.set(null);
    this.session.restart();
    this.problem.set(null);
  }

  change(key: RowFormKey, value: string): void {
    const source = this.source();
    if (!this.target() || !source) {
      return;
    }
    // Ein fremder Farbwert zeigt den Punkt, auf den er abgebildet wird. Landet
    // die Wahl wieder dort, ist nichts umgefaerbt: der eigene Wert bleibt.
    const same =
      key === 'color' && projectColorSlot(value) === projectColorSlot(source.color);
    this.session.change(key, same ? source.color : value);
    const problem = this.problem();
    if (problem && fieldOf(key) === problem.field) {
      this.problem.set(null);
    }
  }

  /** Getipptes verwerfen; eine geparkte Absicht bleibt. */
  discard(): void {
    this.session.discard();
    this.problem.set(null);
  }

  beginSave(): void {
    this.session.beginSave();
    this.problem.set(null);
  }

  /**
   * Gespeichert: die Zeile verlaesst den Bearbeiten-Modus. Zurueck kommt, was
   * waehrenddessen bzw. davor geparkt wurde — die Seite fuehrt es aus.
   */
  saved(): RowIntent | null {
    const next = this.session.takePending();
    this.session.saved();
    this.close();
    return next;
  }

  /** Gescheitert: Eingaben und eine geparkte Absicht bleiben stehen. */
  saveFailed(): void {
    this.session.saveFailed();
  }
}

/** Was nach „Speichern"/„Verwerfen" passiert — Teil des Hinweistexts. */
function intentText(intent: RowIntent | null): string {
  switch (intent?.kind) {
    case 'edit':
      switch (intent.target.kind) {
        case 'new-project':
          return 'beginnt das neue Projekt';
        case 'new-client':
          return 'beginnt der neue Kunde';
        default:
          return 'öffnet sich die gewählte Zeile';
      }
    case 'close':
      return 'endet die Bearbeitung';
    case 'archive':
      return 'kommt die Rückfrage zum Archivieren';
    case 'filter':
      return intent.show ? 'werden Archivierte gezeigt' : 'werden Archivierte ausgeblendet';
    case 'leave':
      return 'verlässt du die Projekte';
    default:
      return 'geht es weiter';
  }
}

function fieldOf(key: RowFormKey): RowFormProblem['field'] | null {
  switch (key) {
    case 'name':
      return 'name';
    case 'rate':
      return 'rate';
    case 'clientId':
      return 'client';
    default:
      return null;
  }
}
