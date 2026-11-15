import {
  DayKey,
  MINUTES_PER_DAY,
  MIN_DURATION_MINUTES,
  Placement,
  formatClock,
  snapToQuarter,
} from '@lib/shared/util-time';

/**
 * Was im Detail-Panel steht — genau so, wie es getippt wurde. Uhrzeiten
 * bleiben Text, bis gespeichert wird: „9:1" ist beim Tippen ein Zwischenstand
 * und kein Fehler.
 */
export interface EntryFormValues {
  readonly dayKey: DayKey;
  readonly from: string;
  readonly to: string;
  readonly projectId: string;
  readonly description: string;
}

export type EntryFormKey = keyof EntryFormValues;

/** Woran ein Fehler haengt (und welches Feld per `aria-describedby` darauf zeigt). */
export type EntryFormField = 'day' | 'project' | 'time';

export interface EntryFormProblem {
  readonly field: EntryFormField;
  readonly message: string;
  /** Welche Zeitfelder als ungueltig markiert werden (`aria-invalid`). */
  readonly invalid: readonly ('from' | 'to')[];
  /** Beim Runden: so stehen die Zeitfelder jetzt. */
  readonly rounded?: { readonly from: string; readonly to: string };
}

export type EntryFormResult =
  | {
      readonly ok: true;
      readonly placement: Placement;
      readonly projectId: string;
      readonly description: string;
    }
  | { readonly ok: false; readonly problem: EntryFormProblem };

/** Formularwerte aus einer Position und dem Inhalt eines Eintrags. */
export function entryFormValues(
  placement: Placement,
  projectId: string | null,
  description: string,
): EntryFormValues {
  return {
    dayKey: placement.dayKey,
    from: formatClock(placement.startMinutes),
    to: formatClock(placement.endMinutes),
    projectId: projectId ?? '',
    description,
  };
}

export function sameEntryForm(a: EntryFormValues, b: EntryFormValues): boolean {
  return (
    a.dayKey === b.dayKey &&
    a.from === b.from &&
    a.to === b.to &&
    a.projectId === b.projectId &&
    a.description === b.description
  );
}

/**
 * `HH:MM` → Minuten seit Mitternacht, `null` bei Unsinn. Die Minutenpruefung
 * ist nicht pedantisch: ohne sie wurde `09:99` klaglos als 10:45 gespeichert.
 * `24:00` ist erlaubt (Tagesende), alles danach nicht — ein Eintrag endet
 * spaetestens um Mitternacht.
 */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 24) {
    return null;
  }
  const total = hours * 60 + minutes;
  return total >= 0 && total <= MINUTES_PER_DAY ? total : null;
}

/**
 * Wo der Eintrag gerade stuende — fuer den Entwurfsblock im Raster und die
 * Dauer im Panel. `null`, solange die Zeiten (noch) keinen Sinn ergeben.
 */
export function formPlacement(values: EntryFormValues): Placement | null {
  const start = parseClock(values.from);
  const end = parseClock(values.to);
  if (!values.dayKey || start === null || end === null || end - start < MIN_DURATION_MINUTES) {
    return null;
  }
  return { dayKey: values.dayKey, startMinutes: start, endMinutes: end };
}

/** Eine Zeile: Zeilenumbrueche (eingefuegter Text) werden zu Leerzeichen. */
function normalizeDescription(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

function problem(
  field: EntryFormField,
  message: string,
  invalid: readonly ('from' | 'to')[] = [],
  rounded?: { from: string; to: string },
): EntryFormResult {
  return { ok: false, problem: { field, message, invalid, rounded } };
}

/**
 * Pruefen vor dem Speichern — dieselben Regeln und Texte wie frueher im
 * Eintrags-Dialog, nur haengt der Fehler jetzt an seinem Feld.
 *
 * Reihenfolge wie im Dialog: Tag, Projekt, Uhrzeiten lesbar, Viertelstunden,
 * Ende nach Beginn, Mindestdauer. Gemeldet wird der erste Fehler.
 *
 * Ein Ende nach Mitternacht laesst sich nicht eingeben (`parseClock` endet bei
 * 24:00). Was an einem Umstelltag gespeichert wird, entscheidet `instantsOf`;
 * das Panel zeigt danach die tatsaechlich gespeicherte Zeit.
 */
export function checkEntryForm(values: EntryFormValues): EntryFormResult {
  if (!values.dayKey) {
    return problem('day', 'Bitte einen Tag wählen.');
  }
  if (!values.projectId) {
    return problem(
      'project',
      'Bitte ein Projekt wählen — ohne Projekt lässt sich die Zeit nicht abrechnen.',
    );
  }

  const rawStart = parseClock(values.from);
  const rawEnd = parseClock(values.to);
  if (rawStart === null || rawEnd === null) {
    const invalid: ('from' | 'to')[] = [];
    if (rawStart === null) invalid.push('from');
    if (rawEnd === null) invalid.push('to');
    return problem('time', 'Bitte gültige Uhrzeiten angeben, zum Beispiel 09:15.', invalid);
  }

  const start = snapToQuarter(rawStart);
  const end = snapToQuarter(rawEnd);

  // Gerundet wird sichtbar: der Nutzer darf nicht raten muessen, welche Zeit
  // gleich in der Rechnung steht.
  if (start !== rawStart || end !== rawEnd) {
    return problem(
      'time',
      `Auf Viertelstunden gerundet: ${formatClock(start)} bis ${formatClock(end)}. ` +
        'Noch einmal „Speichern", wenn das so passt.',
      [],
      { from: formatClock(start), to: formatClock(end) },
    );
  }

  if (end < start) {
    return problem('time', 'Das Ende liegt vor dem Beginn.', ['to']);
  }
  if (end - start < MIN_DURATION_MINUTES) {
    return problem('time', 'Der Eintrag muss mindestens 15 Minuten lang sein.', ['to']);
  }

  return {
    ok: true,
    placement: { dayKey: values.dayKey, startMinutes: start, endMinutes: end },
    projectId: values.projectId,
    description: normalizeDescription(values.description),
  };
}
