import {
  DayKey,
  Placement,
  assignLanes,
  describePlacement,
  durationHours,
  formatClock,
  formatColumnHeader,
  formatDuration,
  formatWeekdayLong,
  minutesToPx,
  sumHours,
} from '@lib/shared/util-time';
import { NO_PROJECT_COLOR_CLASS, projectColorClass } from '@lib/shared/domain';
import { Project, TimeEntry, instantsOf, placementOf } from '@lib/week/domain';

/**
 * Griffe zum Aendern der Dauer (Maus; die Tastatur nimmt ⇧+↑/↓).
 *
 * Regel:
 * - Jeder Griff ist 24 px hoch (Zielgroesse WCAG 2.5.8) und liegt ueber der
 *   Kante: hoechstens 12 px innen, der Rest aussen.
 * - Zwischen den beiden Griffen bleiben immer mindestens 24 px Flaeche zum
 *   Verschieben. Bei kurzen Bloecken rutschen die Griffe dafuer weiter nach
 *   aussen: innen = min(12, (Hoehe − 24) / 2).
 * - Ab 30 Minuten gibt es Griffe (bei 60 px/h: 30 px hoch, 3 px innen,
 *   24 px Mitte). Darunter nicht: der Block ist nur so hoch wie seine
 *   Mindestgroesse, und die aussen liegenden Griffe deckten die Nachbarn zu.
 * - Der aeussere Anteil gilt je Kante fuer sich und reicht hoechstens bis zur
 *   halben Luecke zum naechsten Block, der sich mit diesem die Breite teilt
 *   (gleiche Spur, gleicher Tag). Grenzen zwei Bloecke aneinander, ragt dort
 *   nichts ueber die Kante: sonst laege der Griff des spaeteren Blocks auf der
 *   Kante des frueheren, und wer den frueheren verlaengern will, verschoebe den
 *   Start des spaeteren. Start und Ende bleiben ueber die Zeitfelder und per
 *   ⇧+Pfeil aenderbar (WCAG 2.5.8, Ausnahme „Equivalent").
 */
export const HANDLE_SIZE_PX = 24;
export const HANDLE_MIN_MOVE_PX = 24;
export const HANDLE_MIN_MINUTES = 30;
/** Mindesthoehe, mit der jeder Block gezeichnet wird (CSS `min-height`). */
export const BLOCK_MIN_HEIGHT_PX = 24;

/** Wie weit ein Griff in den Block hineinragt, damit die Mitte frei bleibt. */
export function handleInsetPx(heightPx: number): number {
  const shown = Math.max(heightPx, BLOCK_MIN_HEIGHT_PX);
  return Math.max(0, Math.min(HANDLE_SIZE_PX / 2, (shown - HANDLE_MIN_MOVE_PX) / 2));
}

/**
 * Wie weit ein Griff ueber die Kante hinausragt: der Rest zu 24 px, aber
 * hoechstens die halbe Luecke zum Nachbarn (`null`: kein Nachbar).
 */
export function handleOutsetPx(insetPx: number, gapPx: number | null): number {
  const rest = HANDLE_SIZE_PX - insetPx;
  return gapPx === null ? rest : Math.max(0, Math.min(rest, gapPx / 2));
}

/** Bis 30 Minuten: einzeilig mit Startzeit (Brief „Zeitblock"). */
const SHORT_BLOCK_MINUTES = 30;
/** Ab einer Stunde ist Platz fuer die Notiz unter Name und Zeit. */
const NOTE_MIN_MINUTES = 60;

/**
 * Dargestellte gegen abgerechnete Dauer. Am Umstelltag faellt beides
 * auseinander: ein Block von 01:00 bis 04:00 ist zwei Rasterstunden hoch,
 * bringt aber drei Stunden auf die Rechnung. In einem Abrechnungswerkzeug darf
 * das nicht nur im Wochentotal auftauchen.
 */
export function billedNote(placement: Placement): string | null {
  let instants: { startedAt: Date; endedAt: Date };
  try {
    instants = instantsOf(placement);
  } catch {
    return null;
  }
  const billedHours = durationHours(instants.startedAt, instants.endedAt);
  const shownHours = (placement.endMinutes - placement.startMinutes) / 60;
  return Math.abs(billedHours - shownHours) < 1 / 120 ? null : formatDuration(billedHours);
}

export interface BlockView {
  readonly id: string;
  readonly projectName: string;
  readonly clientName: string;
  readonly description: string;
  /** `pc1` … `pc6`, `pc-none` ohne bekanntes Projekt. */
  readonly colorClass: string;
  /** Kurzer Block: Name und Startzeit in einer Zeile. */
  readonly isShort: boolean;
  /** Platz fuer die Notiz als dritte Zeile. */
  readonly showNote: boolean;
  readonly topPx: number;
  readonly heightPx: number;
  readonly leftCss: string;
  readonly widthCss: string;
  readonly timeLabel: string;
  /** Nur die Startzeit, fuer kurze Bloecke. */
  readonly startLabel: string;
  /** `–10:00` — faellt in schmalen Spuren weg (ganz oder gar nicht). */
  readonly endLabel: string;
  readonly ariaLabel: string;
  readonly placement: Placement;
  readonly showHandles: boolean;
  /** Anteil der Griffe innerhalb des Blocks, siehe `handleInsetPx`. */
  readonly handleInsetPx: number;
  /** Anteil des oberen Griffs ueber der Oberkante, siehe `handleOutsetPx`. */
  readonly handleOutsetTopPx: number;
  /** Anteil des unteren Griffs unter der Unterkante. */
  readonly handleOutsetBottomPx: number;
  /** Gesetzt, wenn die abgerechnete Dauer von der dargestellten abweicht. */
  readonly billedNote: string | null;
}

export interface DayColumnView {
  readonly key: DayKey;
  readonly header: string;
  readonly weekdayLong: string;
  readonly weekdayShort: string;
  readonly dayOfMonth: number;
  readonly isToday: boolean;
  readonly isWeekend: boolean;
  /** Summe der Eintraege dieses Tages in Stunden. */
  readonly totalHours: number;
  readonly blocks: readonly BlockView[];
}

export interface ColumnsInput {
  readonly days: readonly DayKey[];
  readonly entries: readonly TimeEntry[];
  readonly projectsById: ReadonlyMap<string, Project>;
  readonly today: DayKey;
  /**
   * Vorschau einer laufenden Geste. Dieser Eintrag wird an der gezogenen
   * Stelle gezeichnet statt an seiner gespeicherten — deshalb geht die Geste
   * hier als Position ein und nicht als Sonderfall in die Schleife.
   */
  readonly preview: { readonly entryId: string; readonly placement: Placement } | null;
}

interface Positioned {
  readonly entry: TimeEntry;
  readonly placement: Placement;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/**
 * Eintraege und Projekte werden zu dem, was das Raster zeichnet: Position,
 * Farbe, Beschriftung, Vorlesetext.
 *
 * Bewusst eine reine Funktion ohne Angular und ohne DOM. Die Rechnungen darin
 * — Ueberlappung in Spuren, Hoehe in Pixeln, abgerechnete gegen dargestellte
 * Dauer — sind die Stellen, an denen sich Fehler verstecken; sie lassen sich so
 * mit einer Tabelle aus Werten pruefen statt mit einer gerenderten Komponente.
 */
export function buildColumns(input: ColumnsInput): DayColumnView[] {
  const perDay = new Map<DayKey, Positioned[]>();
  for (const day of input.days) {
    perDay.set(day, []);
  }

  for (const entry of input.entries) {
    const placement =
      input.preview?.entryId === entry.id ? input.preview.placement : placementOf(entry);
    perDay.get(placement.dayKey)?.push({
      entry,
      placement,
      startMinutes: placement.startMinutes,
      endMinutes: placement.endMinutes,
    });
  }

  return input.days.map((day, index) => ({
    key: day,
    header: formatColumnHeader(day),
    weekdayLong: formatWeekdayLong(day),
    weekdayShort: formatColumnHeader(day).split(' ')[0],
    dayOfMonth: Number(day.slice(8, 10)),
    isToday: day === input.today,
    // Die Woche beginnt am Montag: Index 5 und 6 sind Samstag und Sonntag.
    isWeekend: index >= 5,
    totalHours: sumHours((perDay.get(day) ?? []).map((item) => item.entry)),
    blocks: withHandleOutsets(
      assignLanes(perDay.get(day) ?? []).map(({ item, lane, lanes }) => ({
        view: toBlockView(item, lane, lanes, input.projectsById),
        lane,
        lanes,
      })),
    ),
  }));
}

/**
 * Begrenzt die Griffe eines Tages je Kante auf die halbe Luecke zum Nachbarn.
 * Nachbar ist jeder Block, der sich mit diesem einen Teil der Breite teilt;
 * das schliesst Bloecke aus anderen Ueberlappungsgruppen ein, deren Spuren
 * anders geschnitten sind. Gerechnet wird mit der gezeichneten Hoehe
 * (Mindesthoehe), denn um die geht es beim Treffen.
 */
function withHandleOutsets(
  laned: ReadonlyArray<{ view: BlockView; lane: number; lanes: number }>,
): BlockView[] {
  const span = laned.map(({ view, lane, lanes }) => ({
    top: view.topPx,
    bottom: view.topPx + Math.max(view.heightPx, BLOCK_MIN_HEIGHT_PX),
    left: lane / lanes,
    right: (lane + 1) / lanes,
  }));

  return laned.map(({ view: block }, index) => {
    const self = span[index];
    let gapAbove: number | null = null;
    let gapBelow: number | null = null;
    for (let otherIndex = 0; otherIndex < span.length; otherIndex++) {
      const other = span[otherIndex];
      if (otherIndex === index || other.left >= self.right || self.left >= other.right) {
        continue;
      }
      if (other.top < self.top || (other.top === self.top && otherIndex < index)) {
        const gap = Math.max(0, self.top - other.bottom);
        gapAbove = gapAbove === null ? gap : Math.min(gapAbove, gap);
      } else {
        const gap = Math.max(0, other.top - self.bottom);
        gapBelow = gapBelow === null ? gap : Math.min(gapBelow, gap);
      }
    }
    return {
      ...block,
      handleOutsetTopPx: handleOutsetPx(block.handleInsetPx, gapAbove),
      handleOutsetBottomPx: handleOutsetPx(block.handleInsetPx, gapBelow),
    };
  });
}

function toBlockView(
  item: Positioned,
  lane: number,
  lanes: number,
  projects: ReadonlyMap<string, Project>,
): BlockView {
  const project = projects.get(item.entry.projectId);
  const projectName = project?.name ?? 'Unbekanntes Projekt';
  const width = 100 / lanes;
  const minutes = item.placement.endMinutes - item.placement.startMinutes;
  const heightPx = minutesToPx(minutes);
  const billed = billedNote(item.placement);
  const inset = handleInsetPx(heightPx);

  return {
    id: item.entry.id,
    projectName,
    clientName: project?.clientName ?? '',
    description: item.entry.description,
    colorClass: project ? projectColorClass(project.color) : NO_PROJECT_COLOR_CLASS,
    isShort: minutes <= SHORT_BLOCK_MINUTES,
    showNote: minutes >= NOTE_MIN_MINUTES && item.entry.description !== '',
    topPx: minutesToPx(item.placement.startMinutes),
    heightPx,
    leftCss: `calc(${lane * width}% + 3px)`,
    widthCss: `calc(${width}% - 6px)`,
    timeLabel: `${formatClock(item.placement.startMinutes)}–${formatClock(item.placement.endMinutes)}`,
    startLabel: formatClock(item.placement.startMinutes),
    endLabel: `–${formatClock(item.placement.endMinutes)}`,
    showHandles: minutes >= HANDLE_MIN_MINUTES,
    handleInsetPx: inset,
    handleOutsetTopPx: handleOutsetPx(inset, null),
    handleOutsetBottomPx: handleOutsetPx(inset, null),
    billedNote: billed,
    ariaLabel:
      describePlacement(projectName, item.placement) +
      (billed ? `, abgerechnet ${billed}` : '') +
      (item.entry.description ? `, ${item.entry.description}` : ''),
    placement: item.placement,
  };
}
