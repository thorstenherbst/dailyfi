import { Signal, computed, signal } from '@angular/core';

import {
  DayKey,
  Placement,
  clampMinutes,
  movePlacement,
  placementFromDrag,
  resizeEnd,
  resizeStart,
  snapToQuarter,
} from '@lib/shared/util-time';

/** Ab dieser Mausbewegung ist es ein Ziehen und kein Klick mehr. */
const DRAG_THRESHOLD_PX = 3;

export type GestureKind = 'draw' | 'move' | 'resize-start' | 'resize-end';

export interface Gesture {
  readonly kind: GestureKind;
  readonly entryId: string | null;
  /** Position beim Druecken — jede Vorschau wird daraus neu gerechnet. */
  readonly origin: Placement;
  readonly pointerStartMinutes: number;
  readonly pointerStartX: number;
  readonly pointerStartY: number;
  readonly placement: Placement;
  readonly moved: boolean;
}

/**
 * Was die Geste vom Raster wissen muss. Alles, was ein `getBoundingClientRect`
 * braucht, bleibt damit in der Komponente, und diese Datei kommt ohne DOM aus.
 */
export interface GestureGeometry {
  /** Bildschirmhoehe → Minuten seit Mitternacht. */
  minutesAt(clientY: number): number;
  /** Bildschirmbreite → Tagesspalte. */
  dayAt(clientX: number): DayKey | null;
  /** Liegt der Zeiger ueber der Rasterflaeche (ohne Stundenachse)? */
  insideGrid(clientX: number, clientY: number): boolean;
}

/** Was am Ende einer Geste passieren soll. Die Geste selbst speichert nichts. */
export interface GestureHandlers {
  /** Im leeren Raster aufgezogen: hier soll ein Eintrag entstehen. */
  drawn(placement: Placement): void;
  /** Ein Block wurde verschoben oder in der Dauer geaendert. */
  moved(entryId: string, placement: Placement): void;
  /** Abgebrochen oder ausserhalb losgelassen — es gibt nur etwas zu sagen. */
  cancelled(message: string): void;
}

/**
 * Die Mausbedienung des Wochenrasters als eigener Zustandsautomat: aufziehen,
 * verschieben, Dauer aendern, abbrechen.
 *
 * Sie haelt nur die laufende Geste und rechnet daraus die Vorschau. Gespeichert
 * wird nichts — das Ergebnis geht als Aufruf an `handlers` zurueck. Dadurch
 * laesst sich der Automat mit erfundenen Zeigerereignissen und einer
 * ausgedachten Geometrie pruefen, ohne Raster und ohne Datenbank.
 */
export class GestureController {
  private readonly gesture = signal<Gesture | null>(null);

  readonly current: Signal<Gesture | null> = this.gesture.asReadonly();
  readonly dragging = computed(() => this.gesture()?.moved === true);

  private stopListening: (() => void) | null = null;
  private suppressNextClick = false;
  private suppressTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly geometry: GestureGeometry,
    private readonly handlers: GestureHandlers,
  ) {}

  /** Ziehen im leeren Raster. */
  startDraw(event: PointerEvent, dayKey: DayKey): void {
    const minutes = this.geometry.minutesAt(event.clientY);
    const start = placementFromDrag(dayKey, minutes, minutes);
    this.begin(event, { kind: 'draw', entryId: null, origin: start, placement: start });
  }

  /** Einen bestehenden Block verschieben. */
  startMove(event: PointerEvent, entryId: string, placement: Placement): void {
    this.begin(event, { kind: 'move', entryId, origin: placement, placement });
  }

  /** An einer Kante ziehen. */
  startResize(
    event: PointerEvent,
    entryId: string,
    placement: Placement,
    edge: 'top' | 'bottom',
  ): void {
    this.begin(event, {
      kind: edge === 'top' ? 'resize-start' : 'resize-end',
      entryId,
      origin: placement,
      placement,
    });
  }

  /**
   * Gehoert dieser Klick noch zum gerade beendeten Zug? Dann hat er nichts zu
   * oeffnen. Die Frage beantwortet sich genau einmal.
   */
  consumeClick(): boolean {
    if (!this.suppressNextClick) {
      return false;
    }
    this.suppressNextClick = false;
    return true;
  }

  destroy(): void {
    this.stopListening?.();
    if (this.suppressTimer !== null) {
      clearTimeout(this.suppressTimer);
      this.suppressTimer = null;
    }
  }

  private begin(
    event: PointerEvent,
    seed: Pick<Gesture, 'kind' | 'entryId' | 'origin' | 'placement'>,
  ): void {
    this.stopListening?.();
    this.gesture.set({
      ...seed,
      pointerStartMinutes: this.geometry.minutesAt(event.clientY),
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      moved: false,
    });

    const onMove = (moveEvent: PointerEvent): void => this.onMove(moveEvent);
    const onUp = (upEvent: PointerEvent): void => this.onUp(upEvent);
    const onCancel = (): void => this.abort();
    // Esc bricht ab, solange die Maustaste noch gedrueckt ist — dieselbe
    // Erwartung wie in jedem Kalender.
    const onKey = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        this.abort();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    this.stopListening = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      this.stopListening = null;
    };
  }

  /** Geste verwerfen: der Eintrag bleibt, wie er war. */
  private abort(): void {
    const gesture = this.gesture();
    this.stopListening?.();
    this.gesture.set(null);
    if (gesture?.moved) {
      // Nach einem abgebrochenen Zug darf der folgende Klick nichts oeffnen.
      this.armClickSuppression();
      this.handlers.cancelled('Abgebrochen');
    }
  }

  private onMove(event: PointerEvent): void {
    const gesture = this.gesture();
    if (!gesture) {
      return;
    }

    const moved =
      gesture.moved ||
      Math.abs(event.clientX - gesture.pointerStartX) > DRAG_THRESHOLD_PX ||
      Math.abs(event.clientY - gesture.pointerStartY) > DRAG_THRESHOLD_PX;
    if (!moved) {
      return;
    }

    this.gesture.set({ ...gesture, placement: this.placementFor(gesture, event), moved: true });
  }

  private placementFor(gesture: Gesture, event: PointerEvent): Placement {
    const minutes = this.geometry.minutesAt(event.clientY);

    switch (gesture.kind) {
      case 'draw':
        return placementFromDrag(gesture.origin.dayKey, gesture.pointerStartMinutes, minutes);
      case 'move': {
        const delta = snapToQuarter(minutes - gesture.pointerStartMinutes);
        const dayKey = this.geometry.dayAt(event.clientX) ?? gesture.origin.dayKey;
        return { ...movePlacement(gesture.origin, delta), dayKey };
      }
      case 'resize-start':
        return resizeStart(gesture.origin, clampMinutes(snapToQuarter(minutes)));
      case 'resize-end':
        return resizeEnd(gesture.origin, clampMinutes(snapToQuarter(minutes)));
    }
  }

  private onUp(event: PointerEvent): void {
    const gesture = this.gesture();
    this.stopListening?.();
    this.gesture.set(null);

    if (!gesture || !gesture.moved) {
      return;
    }

    // Losgelassen ausserhalb des Rasters: Ein Zug, der in der Werkzeugleiste
    // endet, hat keine Uhrzeit. Frueher wurde er auf den Tagesrand geklemmt und
    // still gespeichert — aus 4:45–7:15 wurde 0:00–2:30.
    if (!this.geometry.insideGrid(event.clientX, event.clientY)) {
      this.armClickSuppression();
      this.handlers.cancelled('Außerhalb des Rasters losgelassen, nichts geändert');
      return;
    }

    if (gesture.kind === 'draw') {
      this.handlers.drawn(gesture.placement);
      return;
    }

    if (gesture.entryId) {
      // Der Klick nach dem Ziehen wuerde sonst gleich das Panel fuellen.
      this.armClickSuppression();
      this.handlers.moved(gesture.entryId, gesture.placement);
    }
  }

  /**
   * Das `click`-Ereignis nach einem Zug landet nur dann auf dem Block, wenn die
   * Maus dort losgelassen wurde. Endet der Zug woanders, bliebe die Sperre
   * sonst stehen und verschluckte den naechsten echten Klick auf irgendeinen
   * Block. Deshalb wird sie im naechsten Makrotask ohnehin wieder aufgehoben.
   */
  private armClickSuppression(): void {
    this.suppressNextClick = true;
    if (this.suppressTimer !== null) {
      clearTimeout(this.suppressTimer);
    }
    this.suppressTimer = setTimeout(() => {
      this.suppressNextClick = false;
      this.suppressTimer = null;
    });
  }
}
