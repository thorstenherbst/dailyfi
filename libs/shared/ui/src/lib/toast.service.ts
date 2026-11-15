import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

/** Optionale Aktion im Toast (z. B. spaeter „Rückgängig"). */
export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface ToastOptions {
  /** Leiserer zweiter Teil hinter der fetten Ueberschrift. */
  readonly detail?: string;
  readonly action?: ToastAction;
}

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
  readonly detail: string | null;
  readonly action: ToastAction | null;
  /** Wie oft dieselbe Meldung kam, seit sie steht. */
  readonly count: number;
}

/**
 * Standzeiten laut Brief (Toast: Info/Erfolg 6 s, Warnung 10 s). Dieselben
 * Werte stehen als `$duration` (toast, toast-warning) in `_tokens.scss`.
 * Fehler laufen nie ab: `null`.
 */
export const TOAST_DURATION_MS: Readonly<Record<ToastKind, number | null>> = {
  info: 6000,
  success: 6000,
  warning: 10000,
  error: null,
};

/**
 * Hoechstens so viele stehen gleichzeitig; aeltere warten und ruecken nach.
 * **Fehler zaehlen nicht dagegen**: sie stehen immer. Das Limit gilt fuer die
 * Plaetze, die neben den Fehlern frei bleiben.
 */
export const MAX_VISIBLE_TOASTS = 3;

/**
 * Was die Live-Region vorliest. Getrennt von der Darstellung: ein Toast wird
 * **einmal** angesagt, wenn er entsteht (oder dieselbe Meldung erneut kommt) —
 * nicht noch einmal, wenn er spaeter wegen des Limits nachrueckt.
 */
export interface ToastAnnouncement {
  /** Neu je Ansage, damit `@for` einen neuen Knoten einfuegt. */
  readonly key: number;
  readonly toastId: number;
  readonly kind: ToastKind;
  readonly message: string;
  readonly detail: string | null;
}

interface Timer {
  /** Restzeit, solange der Timer steht. */
  remaining: number;
  startedAt: number;
  handle: ReturnType<typeof setTimeout> | null;
  /** Gruende fuer die Pause: Hover, Fokus, nicht sichtbar. */
  holds: Set<string>;
}

/**
 * Rueckmeldungen als Toasts (Brief „Toast", Spec „Interaktion").
 *
 * - Info und Erfolg verschwinden nach 6 s, Warnungen nach 10 s. Der Timer
 *   steht, solange der Zeiger darauf liegt oder der Fokus darin ist
 *   (WCAG 2.2.1) — und solange der Toast wegen des Limits nicht sichtbar ist.
 * - Fehler bleiben, bis man sie schliesst.
 * - Dieselbe Meldung ein zweites Mal stapelt nicht, sondern zaehlt hoch und
 *   beginnt ihre Standzeit neu.
 *
 * Rein Zustand und Zeit; gezeichnet wird in `ToastRegion`.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly all = signal<readonly Toast[]>([]);
  private readonly spoken = signal<readonly ToastAnnouncement[]>([]);
  private readonly timers = new Map<number, Timer>();
  private nextId = 0;
  private nextKey = 0;

  /**
   * Alle Fehler, dazu die neuesten anderen, so viele daneben Platz haben —
   * in der Reihenfolge des Entstehens.
   */
  readonly visible = computed(() => {
    const list = this.all();
    const errors = list.filter((toast) => toast.kind === 'error').length;
    const room = Math.max(0, MAX_VISIBLE_TOASTS - errors);
    const others = list.filter((toast) => toast.kind !== 'error');
    const shownOthers = new Set(
      others.slice(Math.max(0, others.length - room)).map((toast) => toast.id),
    );
    return list.filter((toast) => toast.kind === 'error' || shownOthers.has(toast.id));
  });
  /** Alles, was steht oder wartet. */
  readonly toasts = this.all.asReadonly();
  /** Inhalt der Live-Regionen; verschwindet mit seinem Toast. */
  readonly announcements = this.spoken.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clear());
  }

  info(message: string, options?: ToastOptions): number {
    return this.show('info', message, options);
  }

  success(message: string, options?: ToastOptions): number {
    return this.show('success', message, options);
  }

  warning(message: string, options?: ToastOptions): number {
    return this.show('warning', message, options);
  }

  error(message: string, options?: ToastOptions): number {
    return this.show('error', message, options);
  }

  show(kind: ToastKind, message: string, options: ToastOptions = {}): number {
    const detail = options.detail ?? null;
    const twin = this.all().find(
      (toast) => toast.kind === kind && toast.message === message && toast.detail === detail,
    );
    if (twin) {
      this.all.update((list) =>
        list.map((toast) => (toast.id === twin.id ? { ...toast, count: toast.count + 1 } : toast)),
      );
      this.restart(twin.id);
      // Dieselbe Meldung ist ein neues Ereignis und wird wieder angesagt.
      this.announce(twin);
      return twin.id;
    }

    const toast: Toast = {
      id: ++this.nextId,
      kind,
      message,
      detail,
      action: options.action ?? null,
      count: 1,
    };
    this.all.update((list) => [...list, toast]);
    this.announce(toast);
    const duration = TOAST_DURATION_MS[kind];
    if (duration !== null) {
      this.timers.set(toast.id, {
        remaining: duration,
        startedAt: 0,
        handle: null,
        holds: new Set(),
      });
    }
    this.syncVisibility();
    return toast.id;
  }

  dismiss(id: number): void {
    this.stop(id);
    this.timers.delete(id);
    this.all.update((list) => list.filter((toast) => toast.id !== id));
    this.spoken.update((list) => list.filter((entry) => entry.toastId !== id));
    this.syncVisibility();
  }

  /** Alles weg, z. B. beim Abmelden: die Meldungen gehoeren zur alten Sitzung. */
  clear(): void {
    for (const id of this.timers.keys()) {
      this.stop(id);
    }
    this.timers.clear();
    this.all.set([]);
    this.spoken.set([]);
  }

  /** Aktion ausfuehren und den Toast schliessen. */
  runAction(id: number): void {
    const toast = this.all().find((candidate) => candidate.id === id);
    this.dismiss(id);
    toast?.action?.run();
  }

  /** Zeiger oder Fokus auf dem Toast: Zeit anhalten (`reason`: 'hover' | 'focus'). */
  hold(id: number, reason: string): void {
    const timer = this.timers.get(id);
    if (!timer) {
      return;
    }
    timer.holds.add(reason);
    this.stop(id);
  }

  release(id: number, reason: string): void {
    const timer = this.timers.get(id);
    if (!timer) {
      return;
    }
    timer.holds.delete(reason);
    this.start(id);
  }

  private announce(toast: Toast): void {
    this.spoken.update((list) => [
      // Nur die juengste Ansage je Toast bleibt im DOM.
      ...list.filter((entry) => entry.toastId !== toast.id),
      {
        key: ++this.nextKey,
        toastId: toast.id,
        kind: toast.kind,
        message: toast.message,
        detail: toast.detail,
      },
    ]);
  }

  private restart(id: number): void {
    const timer = this.timers.get(id);
    const toast = this.all().find((candidate) => candidate.id === id);
    if (!timer || !toast) {
      return;
    }
    this.stop(id);
    timer.remaining = TOAST_DURATION_MS[toast.kind] ?? timer.remaining;
    this.start(id);
  }

  /** Was nicht sichtbar ist, verliert keine Zeit; was sichtbar wird, laeuft. */
  private syncVisibility(): void {
    const shown = new Set(this.visible().map((toast) => toast.id));
    for (const [id, timer] of this.timers) {
      if (shown.has(id)) {
        timer.holds.delete('hidden');
        this.start(id);
      } else {
        timer.holds.add('hidden');
        this.stop(id);
      }
    }
  }

  private start(id: number): void {
    const timer = this.timers.get(id);
    if (!timer || timer.handle !== null || timer.holds.size > 0) {
      return;
    }
    timer.startedAt = Date.now();
    timer.handle = setTimeout(() => this.dismiss(id), timer.remaining);
  }

  private stop(id: number): void {
    const timer = this.timers.get(id);
    if (!timer || timer.handle === null) {
      return;
    }
    clearTimeout(timer.handle);
    timer.handle = null;
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
  }
}
