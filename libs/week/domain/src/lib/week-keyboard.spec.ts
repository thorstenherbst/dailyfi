import { MINUTES_PER_DAY, MIN_DURATION_MINUTES, Placement } from '@lib/shared/util-time';

import { blockKeyAction } from './week-keyboard';

/** Dienstag der ruhigen KW 38, 9:15–11:00. */
const BLOCK: Placement = { dayKey: '2026-09-15', startMinutes: 555, endMinutes: 660 };

function at(startMinutes: number, endMinutes: number, dayKey = BLOCK.dayKey): Placement {
  return { dayKey, startMinutes, endMinutes };
}

describe('blockKeyAction', () => {
  it('verschiebt mit den Pfeiltasten in Viertelstunden', () => {
    expect(blockKeyAction('ArrowDown', false, BLOCK)).toEqual({
      kind: 'apply',
      placement: at(570, 675),
    });
    expect(blockKeyAction('ArrowUp', false, BLOCK)).toEqual({
      kind: 'apply',
      placement: at(540, 645),
    });
  });

  it('aendert mit Umschalt die Dauer, statt zu verschieben', () => {
    expect(blockKeyAction('ArrowDown', true, BLOCK)).toEqual({
      kind: 'apply',
      placement: at(555, 675),
    });
    expect(blockKeyAction('ArrowUp', true, BLOCK)).toEqual({
      kind: 'apply',
      placement: at(555, 645),
    });
  });

  it('wechselt mit links und rechts den Tag', () => {
    expect(blockKeyAction('ArrowRight', false, BLOCK)).toEqual({
      kind: 'apply',
      placement: at(555, 660, '2026-09-16'),
    });
    expect(blockKeyAction('ArrowLeft', false, BLOCK)).toEqual({
      kind: 'apply',
      placement: at(555, 660, '2026-09-14'),
    });
  });

  it('sagt am Tagesanfang etwas, statt nichts zu speichern', () => {
    const atMidnight = at(0, 60);

    expect(blockKeyAction('ArrowUp', false, atMidnight)).toEqual({
      kind: 'announce',
      message: 'Anfang des Tages erreicht',
    });
  });

  it('sagt am Tagesende etwas', () => {
    const lastHour = at(MINUTES_PER_DAY - 60, MINUTES_PER_DAY);

    expect(blockKeyAction('ArrowDown', false, lastHour)).toEqual({
      kind: 'announce',
      message: 'Ende des Tages erreicht',
    });
  });

  it('laesst den kuerzesten Block nicht weiter schrumpfen', () => {
    const shortest = at(555, 555 + MIN_DURATION_MINUTES);

    expect(blockKeyAction('ArrowUp', true, shortest)).toEqual({
      kind: 'announce',
      message: 'Kürzer geht nicht',
    });
  });

  it('bleibt am Wochenrand in der Woche', () => {
    // 14.09.2026 ist ein Montag, 20.09. ein Sonntag.
    expect(blockKeyAction('ArrowLeft', false, at(555, 660, '2026-09-14'))).toEqual({
      kind: 'announce',
      message: 'Ende der Woche erreicht',
    });
    expect(blockKeyAction('ArrowRight', false, at(555, 660, '2026-09-20'))).toEqual({
      kind: 'announce',
      message: 'Ende der Woche erreicht',
    });
  });

  it('meldet Entf und Rueckschritt als Loeschwunsch', () => {
    expect(blockKeyAction('Delete', false, BLOCK)).toEqual({ kind: 'delete' });
    expect(blockKeyAction('Backspace', false, BLOCK)).toEqual({ kind: 'delete' });
  });

  it('haelt sich aus allem anderen heraus', () => {
    // Wichtig: `null` heisst, der Aufrufer ruft kein preventDefault() — sonst
    // schluckt das Raster Tastenkuerzel des Browsers.
    for (const key of ['Tab', 'Escape', 'a', 'PageDown', 'Home', 'F5']) {
      expect(blockKeyAction(key, false, BLOCK)).toBeNull();
    }
  });
});
