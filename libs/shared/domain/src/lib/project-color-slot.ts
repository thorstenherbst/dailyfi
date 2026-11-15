/**
 * Shared Kernel der Projektfarben: welcher gespeicherte Farbschluessel
 * (Spalte `projects.color`) zu welcher Projektfarbe 1–6 der Styles-Lib gehoert.
 *
 * Gebraucht von `projects` (Liste, Farbwahl) und `week` (Bloecke). Weil `week`
 * nicht von `projects` abhaengen darf, liegt die Zuordnung hier — einmal.
 * Die Namen der Farben fuer die Auswahl bleiben in `projects/domain`.
 *
 * Die tatsaechliche Flaechenfarbe kommt je Farbmodus aus den Custom Properties
 * `--pcN-fill`; der Schluessel wird nirgends direkt gemalt.
 */
export type ProjectColorSlot = 1 | 2 | 3 | 4 | 5 | 6;

/** Schluessel des Designs vom Nov 2026 (helle Flaechenfarbe), je Slot. */
export const PROJECT_COLOR_KEYS: Readonly<Record<ProjectColorSlot, string>> = {
  1: '#2F5BD3', // Kobalt
  2: '#1A7A4A', // Smaragd
  3: '#8A6100', // Senf
  4: '#B3500E', // Kupfer
  5: '#4A4F57', // Graphit
  6: '#0D7380', // Petrol
};

/**
 * Gespeicherte Schluessel aus dem alten Design (Sep 2026) und der
 * Datenbank-Vorgabe. Keine Datenmigration: alte Werte bleiben in der Tabelle
 * stehen und werden beim Lesen auf die naechstliegende neue Farbe abgebildet.
 */
export const LEGACY_PROJECT_COLORS: ReadonlyMap<string, ProjectColorSlot> = new Map([
  ['#414BA8', 1], // Indigo     → Kobalt
  ['#4F46E5', 1], // DB-Default → Kobalt
  ['#3F6B4C', 2], // Salbei     → Smaragd
  ['#8A5512', 3], // Bernstein  → Senf
  ['#A8412A', 4], // Terrakotta → Kupfer
  ['#8C3A5E', 5], // Beere      → Graphit
  ['#256868', 6], // Petrol     → Petrol
]);

/** Fremde Werte (z. B. von Hand in die Datenbank geschrieben): neutrales Graphit. */
export const FALLBACK_PROJECT_COLOR_SLOT: ProjectColorSlot = 5;

/** Klasse fuer Eintraege ohne bekanntes Projekt. */
export const NO_PROJECT_COLOR_CLASS = 'pc-none';

function normalize(value: string): string {
  return value.trim().toUpperCase();
}

/** Slot zu einem bekannten Schluessel (neu oder alt), sonst `null`. */
export function knownProjectColorSlot(value: string): ProjectColorSlot | null {
  const key = normalize(value);
  const current = (Object.entries(PROJECT_COLOR_KEYS) as [string, string][]).find(
    ([, color]) => color === key,
  );
  return current
    ? (Number(current[0]) as ProjectColorSlot)
    : (LEGACY_PROJECT_COLORS.get(key) ?? null);
}

/** Projektfarbe 1–6 zu einem gespeicherten Schluessel; Fremdes wird Graphit. */
export function projectColorSlot(value: string): ProjectColorSlot {
  return knownProjectColorSlot(value) ?? FALLBACK_PROJECT_COLOR_SLOT;
}

/** CSS-Klasse der Styles-Lib: `pc1` … `pc6`. */
export function projectColorClass(value: string): string {
  return `pc${projectColorSlot(value)}`;
}

/** Ist der Wert ein fremder (weder neuer noch alter Schluessel)? */
export function isForeignProjectColor(value: string): boolean {
  return knownProjectColorSlot(value) === null;
}
