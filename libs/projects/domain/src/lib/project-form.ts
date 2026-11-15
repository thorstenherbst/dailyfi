import { ClientDraft, ProjectDraft, ProjectRecord } from './project';
import { MAX_RATE, RateProblem, formatRateInput, parseRate } from './rate';

const RATE_MESSAGES: Record<RateProblem, string> = {
  format: 'Der Stundensatz muss eine Zahl sein, zum Beispiel 95 oder 95,50.',
  negative: 'Der Stundensatz darf nicht negativ sein.',
  'too-large': `Der Stundensatz darf höchstens ${formatRateInput(MAX_RATE)} € betragen.`,
};

/**
 * Felder einer Inline-Zeile in /projects, so wie sie im Formular stehen: alles
 * Text. Eine Kundenzeile nutzt nur `name`.
 */
export interface RowFormValues {
  readonly name: string;
  /** Gespeicherter Farbschluessel — auch ein alter oder fremder. */
  readonly color: string;
  /** Stundensatz, wie getippt („95,50"). */
  readonly rate: string;
  readonly clientId: string;
}

export type RowFormKey = keyof RowFormValues;

/** Welches Feld einen Fehler hat. */
export type RowFormField = 'name' | 'rate' | 'client';

export interface RowFormProblem {
  readonly field: RowFormField;
  readonly message: string;
}

export type RowFormResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: RowFormProblem };

/** Feldwerte eines gespeicherten Projekts. */
export function projectFormValues(project: ProjectRecord): RowFormValues {
  return {
    name: project.name,
    color: project.color,
    rate: formatRateInput(project.hourlyRate),
    clientId: project.clientId,
  };
}

/** Feldwerte eines neuen Projekts unter diesem Kunden. */
export function newProjectFormValues(clientId: string, color: string): RowFormValues {
  return { name: '', color, rate: '', clientId };
}

/** Feldwerte eines Kunden (nur der Name zaehlt). */
export function clientFormValues(name: string): RowFormValues {
  return { name, color: '', rate: '', clientId: '' };
}

/**
 * Kunde pruefen. Texte wie im frueheren Dialog: ein leerer Name geht nicht
 * zum Server.
 */
export function checkClientForm(values: RowFormValues): RowFormResult<ClientDraft> {
  const name = values.name.trim();
  if (name.length === 0) {
    return { ok: false, problem: { field: 'name', message: 'Bitte einen Namen eingeben.' } };
  }
  return { ok: true, value: { name } };
}

/**
 * Projekt pruefen, in der Reihenfolge des frueheren Dialogs: Kunde, Name,
 * Stundensatz (Komma wie Punkt, leer heisst „kein Satz").
 */
export function checkProjectForm(values: RowFormValues): RowFormResult<ProjectDraft> {
  if (values.clientId === '') {
    return { ok: false, problem: { field: 'client', message: 'Bitte einen Kunden wählen.' } };
  }
  const name = values.name.trim();
  if (name.length === 0) {
    return {
      ok: false,
      problem: { field: 'name', message: 'Bitte einen Projektnamen eingeben.' },
    };
  }
  const rate = parseRate(values.rate);
  if (!rate.ok) {
    return { ok: false, problem: { field: 'rate', message: RATE_MESSAGES[rate.problem] } };
  }
  return {
    ok: true,
    value: { clientId: values.clientId, name, color: values.color, hourlyRate: rate.value },
  };
}
