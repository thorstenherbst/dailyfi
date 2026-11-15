import {
  MINUTES_PER_DAY,
  MIN_DURATION_MINUTES,
  Placement,
  addDays,
  instantToWall,
  wallToInstant,
} from '@lib/shared/util-time';

/**
 * Reicht der Eintrag über Mitternacht hinaus? Über die Oberfläche nicht
 * erzeugbar, wohl aber aus Altdaten oder direkt in der Datenbank.
 *
 * Ein Eintrag, der *auf* Mitternacht endet, zählt nicht dazu: 23:00–24:00 ist
 * ein ganz normaler Block am Tagesende und muss sich bearbeiten lassen.
 */
export function spansMidnight(entry: { startedAt: Date; endedAt: Date }): boolean {
  const start = instantToWall(entry.startedAt);
  const end = instantToWall(entry.endedAt);
  if (end.dayKey === start.dayKey) {
    return false;
  }
  return !(end.minutes === 0 && end.dayKey === addDays(start.dayKey, 1));
}

/**
 * Zeiteintrag → Position im Raster. Ein Eintrag über Mitternacht wird bis zum
 * Tagesende dargestellt; zurückgeschrieben wird diese gekürzte Fassung nie
 * (siehe `spansMidnight`), sonst gingen aus Altdaten still Stunden verloren.
 */
export function placementOf(entry: { startedAt: Date; endedAt: Date }): Placement {
  const start = instantToWall(entry.startedAt);
  const end = instantToWall(entry.endedAt);
  return {
    dayKey: start.dayKey,
    startMinutes: start.minutes,
    endMinutes: end.dayKey === start.dayKey ? end.minutes : MINUTES_PER_DAY,
  };
}

/**
 * Position im Raster → die beiden Zeitpunkte für die Datenbank.
 *
 * Der Guard greift genau einmal im Jahr: Liegen Beginn und Ende in derselben
 * Lücke der Frühjahrsumstellung, fallen beide auf denselben Zeitpunkt. Dann
 * bleibt die gezogene Dauer erhalten und der Block rutscht hinter den Sprung —
 * statt dass die Datenbank einen Eintrag mit Länge null ablehnt.
 */
export function instantsOf(placement: Placement): { startedAt: Date; endedAt: Date } {
  const startedAt = wallToInstant(placement.dayKey, placement.startMinutes);
  let endedAt = wallToInstant(placement.dayKey, placement.endMinutes);

  if (endedAt.getTime() <= startedAt.getTime()) {
    const wallMinutes = Math.max(
      MIN_DURATION_MINUTES,
      placement.endMinutes - placement.startMinutes,
    );
    endedAt = new Date(startedAt.getTime() + wallMinutes * 60_000);
  }

  return { startedAt, endedAt };
}

/**
 * Was am Ende wirklich gespeichert wird. An einem Umstelltag kann das von der
 * Eingabe abweichen — und dann muss die Ansage diese Zeit nennen und nicht die
 * eingegebene, sonst hört ein blinder Nutzer etwas anderes, als in der
 * Rechnung landet.
 */
export function effectivePlacement(placement: Placement): Placement {
  return placementOf(instantsOf(placement));
}
