import {
  Placement,
  SNAP_MINUTES,
  movePlacement,
  resizePlacement,
  samePlacement,
  shiftDay,
  weekdayIndex,
} from '@lib/shared/util-time';

/**
 * Was ein Tastendruck auf einem Zeitblock bedeutet.
 *
 * `null` heisst: geht uns nichts an — dann darf der Aufrufer auch kein
 * `preventDefault()` rufen, sonst schluckt das Raster Tastenkuerzel des
 * Browsers.
 */
export type BlockKeyAction =
  | { readonly kind: 'apply'; readonly placement: Placement }
  | { readonly kind: 'announce'; readonly message: string }
  | { readonly kind: 'delete' }
  | null;

/**
 * Tastendruck → Absicht, als reine Funktion.
 *
 * Hier steckt die eigentliche Tastaturbedienung des Rasters: ↑/↓ verschiebt in
 * Viertelstunden, ⇧+↑/↓ aendert die Dauer, ←/→ wechselt den Tag, Entf loescht.
 * Dass sie nichts von Angular, DOM oder Datenbank weiss, ist Absicht — die
 * Randfaelle (Tagesanfang, Tagesende, Wochenrand, kuerzester Block) sind das,
 * was hier schiefgehen kann, und die pruefen sich als Wertetabelle.
 *
 * Aendert eine Bewegung nichts, kommt keine `apply`-Absicht zurueck, sondern
 * eine Ansage: am Rand soll etwas gesagt, aber nichts gespeichert werden.
 */
export function blockKeyAction(
  key: string,
  shiftKey: boolean,
  placement: Placement,
): BlockKeyAction {
  switch (key) {
    case 'ArrowUp':
      return applyOrEdge(
        placement,
        shiftKey
          ? resizePlacement(placement, -SNAP_MINUTES)
          : movePlacement(placement, -SNAP_MINUTES),
        shiftKey ? 'Kürzer geht nicht' : 'Anfang des Tages erreicht',
      );

    case 'ArrowDown':
      return applyOrEdge(
        placement,
        shiftKey
          ? resizePlacement(placement, SNAP_MINUTES)
          : movePlacement(placement, SNAP_MINUTES),
        'Ende des Tages erreicht',
      );

    case 'ArrowLeft':
    case 'ArrowRight': {
      const direction = key === 'ArrowLeft' ? -1 : 1;
      const target = weekdayIndex(placement.dayKey) + direction;
      if (target < 0 || target > 6) {
        return { kind: 'announce', message: 'Ende der Woche erreicht' };
      }
      return applyOrEdge(placement, shiftDay(placement, direction), 'Ende der Woche erreicht');
    }

    case 'Delete':
    case 'Backspace':
      return { kind: 'delete' };

    default:
      return null;
  }
}

function applyOrEdge(before: Placement, after: Placement, edgeMessage: string): BlockKeyAction {
  return samePlacement(after, before)
    ? { kind: 'announce', message: edgeMessage }
    : { kind: 'apply', placement: after };
}
