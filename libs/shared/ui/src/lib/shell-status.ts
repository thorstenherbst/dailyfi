import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

/** Zustand der Daten gegenueber dem Server, wie ihn die Statusleiste zeigt. */
export type SyncState = 'synced' | 'loading' | 'saving' | 'error';

/** Ein Tastaturkuerzel als Hinweis: Tasten plus Wirkung. */
export interface Shortcut {
  readonly keys: readonly string[];
  readonly label: string;
}

/**
 * Was eine Seite der Statusleiste mitteilt. Alles optional: jede Seite gibt
 * nur das, was sie wirklich weiss.
 */
export interface ShellStatusSnapshot {
  readonly sync?: SyncState | null;
  readonly weekNumber?: number | null;
  /** Fertig formatiert, z. B. „24,25 h". */
  readonly weekTotal?: string | null;
  readonly todayTotal?: string | null;
  readonly shortcuts?: readonly Shortcut[];
}

const EMPTY: ShellStatusSnapshot = {};

/**
 * Bruecke zwischen der Seite, die die Daten hat (Stores leben je Seite), und
 * der Statusleiste, die die App-Shell zeichnet. Die Statusleiste selbst bleibt
 * rein praesentational; die Shell liest diesen Zustand und reicht ihn als
 * Inputs durch.
 *
 * Jede Veroeffentlichung traegt einen Besitzer: raeumt eine Seite beim
 * Verlassen auf, nachdem die naechste schon geschrieben hat, loescht sie
 * nicht deren Werte.
 */
@Injectable({ providedIn: 'root' })
export class ShellStatus {
  private readonly state = signal<{ owner: object | null; value: ShellStatusSnapshot }>({
    owner: null,
    value: EMPTY,
  });

  readonly snapshot = computed<ShellStatusSnapshot>(() => this.state().value);

  publish(owner: object, value: ShellStatusSnapshot): void {
    this.state.set({ owner, value });
  }

  release(owner: object): void {
    if (this.state().owner === owner) {
      this.state.set({ owner: null, value: EMPTY });
    }
  }
}

/**
 * Im Konstruktor einer Seite aufrufen. Haelt die Statusleiste aktuell, solange
 * die Seite lebt, und gibt sie beim Verlassen wieder frei.
 */
export function publishShellStatus(source: () => ShellStatusSnapshot): void {
  const status = inject(ShellStatus);
  const owner = {};
  effect(() => status.publish(owner, source()));
  inject(DestroyRef).onDestroy(() => status.release(owner));
}
