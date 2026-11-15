import { DayKey, Placement } from '@lib/shared/util-time';

import { GestureController, GestureGeometry, GestureHandlers } from './week-gesture';

const DI = '2026-09-15';
const MI = '2026-09-16';

const BLOCK: Placement = { dayKey: DI, startMinutes: 555, endMinutes: 660 }; // 9:15–11:00

/**
 * Erfundene Geometrie: eine Minute je Pixel ab `clientY = 0`, und die Spalte
 * haengt nur an `clientX`. Damit laesst sich der Automat pruefen, ohne ein
 * Raster zu rendern.
 */
class TestGeometry implements GestureGeometry {
  outside = false;

  minutesAt(clientY: number): number {
    return clientY;
  }
  dayAt(clientX: number): DayKey | null {
    return clientX >= 200 ? MI : DI;
  }
  insideGrid(): boolean {
    return !this.outside;
  }
}

class TestHandlers implements GestureHandlers {
  drawnWith: Placement[] = [];
  movedWith: Array<{ entryId: string; placement: Placement }> = [];
  cancelledWith: string[] = [];

  drawn(placement: Placement): void {
    this.drawnWith.push(placement);
  }
  moved(entryId: string, placement: Placement): void {
    this.movedWith.push({ entryId, placement });
  }
  cancelled(message: string): void {
    this.cancelledWith.push(message);
  }
}

function pointer(type: string, x: number, y: number): PointerEvent {
  // jsdom kennt PointerEvent nicht in jeder Fassung — ein MouseEvent traegt
  // alles, was der Automat liest.
  return new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
  }) as unknown as PointerEvent;
}

function setup(): {
  gestures: GestureController;
  geometry: TestGeometry;
  handlers: TestHandlers;
} {
  const geometry = new TestGeometry();
  const handlers = new TestHandlers();
  return { gestures: new GestureController(geometry, handlers), geometry, handlers };
}

function move(x: number, y: number): void {
  window.dispatchEvent(pointer('pointermove', x, y));
}
function up(x: number, y: number): void {
  window.dispatchEvent(pointer('pointerup', x, y));
}

describe('GestureController', () => {
  let active: GestureController | null = null;

  afterEach(() => {
    active?.destroy();
    active = null;
  });

  it('zieht im leeren Raster einen Entwurf auf', () => {
    const { gestures, handlers } = setup();
    active = gestures;

    gestures.startDraw(pointer('pointerdown', 100, 540), DI); // 9:00
    move(100, 660); // bis 11:00

    expect(gestures.dragging()).toBe(true);
    expect(gestures.current()?.placement).toEqual({
      dayKey: DI,
      startMinutes: 540,
      endMinutes: 660,
    });

    up(100, 660);

    expect(handlers.drawnWith).toEqual([{ dayKey: DI, startMinutes: 540, endMinutes: 660 }]);
    expect(gestures.current()).toBeNull();
  });

  it('haelt einen Klick ohne Bewegung fuer einen Klick', () => {
    const { gestures, handlers } = setup();
    active = gestures;

    gestures.startDraw(pointer('pointerdown', 100, 540), DI);
    move(101, 541); // unter der Schwelle von 3 px
    up(101, 541);

    expect(handlers.drawnWith).toEqual([]);
    expect(handlers.cancelledWith).toEqual([]);
    // Ein reiner Klick darf den folgenden `click` nicht verschlucken.
    expect(gestures.consumeClick()).toBe(false);
  });

  it('verschiebt einen Block, auch ueber die Tagesgrenze', () => {
    const { gestures, handlers } = setup();
    active = gestures;

    gestures.startMove(pointer('pointerdown', 100, 555), 'e1', BLOCK);
    move(250, 600); // 45 Minuten nach unten, Spalte Mittwoch

    expect(gestures.current()?.placement).toEqual({
      dayKey: MI,
      startMinutes: 600,
      endMinutes: 705,
    });

    up(250, 600);

    expect(handlers.movedWith).toEqual([
      { entryId: 'e1', placement: { dayKey: MI, startMinutes: 600, endMinutes: 705 } },
    ]);
    // Nach einem Zug darf der folgende Klick den Dialog nicht oeffnen.
    expect(gestures.consumeClick()).toBe(true);
    expect(gestures.consumeClick()).toBe(false);
  });

  it('aendert die Dauer an der oberen und der unteren Kante', () => {
    const { gestures, handlers } = setup();
    active = gestures;

    gestures.startResize(pointer('pointerdown', 100, 555), 'e1', BLOCK, 'top');
    move(100, 600);
    up(100, 600);
    expect(handlers.movedWith[0].placement).toEqual({
      dayKey: DI,
      startMinutes: 600,
      endMinutes: 660,
    });

    gestures.startResize(pointer('pointerdown', 100, 660), 'e1', BLOCK, 'bottom');
    move(100, 720);
    up(100, 720);
    expect(handlers.movedWith[1].placement).toEqual({
      dayKey: DI,
      startMinutes: 555,
      endMinutes: 720,
    });
  });

  it('bricht mit Escape ab und laesst den Eintrag, wie er war', () => {
    const { gestures, handlers } = setup();
    active = gestures;

    gestures.startMove(pointer('pointerdown', 100, 555), 'e1', BLOCK);
    move(100, 700);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(gestures.current()).toBeNull();
    expect(handlers.movedWith).toEqual([]);
    expect(handlers.cancelledWith).toEqual(['Abgebrochen']);
    expect(gestures.consumeClick()).toBe(true);
  });

  it('speichert nichts, wenn ausserhalb des Rasters losgelassen wird', () => {
    // Frueher wurde der Zug auf den Tagesrand geklemmt
    // und still gespeichert — aus 4:45–7:15 wurde 0:00–2:30.
    const { gestures, geometry, handlers } = setup();
    active = gestures;

    gestures.startMove(pointer('pointerdown', 100, 555), 'e1', BLOCK);
    move(100, 700);
    geometry.outside = true;
    up(100, -50);

    expect(handlers.movedWith).toEqual([]);
    expect(handlers.cancelledWith).toEqual(['Außerhalb des Rasters losgelassen, nichts geändert']);
  });

  it('hoert nach dem Ende einer Geste auf zuzuhoeren', () => {
    const { gestures, handlers } = setup();
    active = gestures;

    gestures.startDraw(pointer('pointerdown', 100, 540), DI);
    move(100, 660);
    up(100, 660);

    // Nachlaufende Ereignisse duerfen keine zweite Geste erfinden.
    move(100, 900);
    up(100, 900);

    expect(handlers.drawnWith).toHaveLength(1);
    expect(gestures.current()).toBeNull();
  });

  it('loest die Zuhoerer beim Aufraeumen', () => {
    const { gestures, handlers } = setup();

    gestures.startMove(pointer('pointerdown', 100, 555), 'e1', BLOCK);
    gestures.destroy();

    move(100, 700);
    up(100, 700);

    expect(handlers.movedWith).toEqual([]);
  });
});
