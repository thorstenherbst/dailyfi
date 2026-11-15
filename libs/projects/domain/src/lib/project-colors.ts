import {
  PROJECT_COLOR_KEYS,
  ProjectColorSlot,
  knownProjectColorSlot,
  projectColorSlot,
} from '@lib/shared/domain';

/**
 * Die sechs Projektfarben der App, mit Namen fuer die
 * Farbwahl und die Projektliste.
 *
 * Der Name ist kein Beiwerk: die Auswahl darf die Farbe nicht als einzige
 * Information anbieten (WCAG 1.4.1), und „Smaragd" laesst sich auch vorlesen.
 *
 * Welcher gespeicherte Schluessel zu welchem Slot gehoert (inklusive der alten
 * Werte, ohne Datenmigration), steht im Shared Kernel `@lib/shared/domain`.
 */
export interface ProjectColor {
  readonly name: string;
  /** Gespeicherter Schluessel (Spalte `projects.color`). */
  readonly value: string;
  readonly slot: ProjectColorSlot;
}

const NAMES: Readonly<Record<ProjectColorSlot, string>> = {
  1: 'Kobalt',
  2: 'Smaragd',
  3: 'Senf',
  4: 'Kupfer',
  5: 'Graphit',
  6: 'Petrol',
};

const SLOTS: readonly ProjectColorSlot[] = [1, 2, 3, 4, 5, 6];

export const PROJECT_COLORS: readonly ProjectColor[] = SLOTS.map((slot) => ({
  name: NAMES[slot],
  value: PROJECT_COLOR_KEYS[slot],
  slot,
}));

export const DEFAULT_PROJECT_COLOR = PROJECT_COLORS[0].value;

export { projectColorClass, projectColorSlot } from '@lib/shared/domain';

/**
 * Name zu einer gespeicherten Farbe. Ein fremder Wert wird wie ueberall als
 * Graphit gezeigt und sagt das dazu: „Graphit (eigener Wert #123456)".
 */
export function colorName(value: string): string {
  const known = knownProjectColorSlot(value);
  if (known !== null) {
    return NAMES[known];
  }
  return `${NAMES[projectColorSlot(value)]} (eigener Wert ${value.trim().toUpperCase()})`;
}
