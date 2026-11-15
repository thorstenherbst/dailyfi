import { formatClock } from '@lib/shared/util-time';

import {
  EntryFormValues,
  checkEntryForm,
  entryFormValues,
  formPlacement,
  parseClock,
  sameEntryForm,
} from './entry-form';
import { effectivePlacement } from './placement';

const BASE: EntryFormValues = {
  dayKey: '2026-09-15',
  from: '09:15',
  to: '11:00',
  projectId: 'p1',
  description: 'Datenmodell',
};

/**
 * Die Regeln stammen aus dem frueheren Eintrags-Dialog (`entry-dialog.ts`) und
 * gelten unveraendert im Panel. Neu ist nur, an welchem Feld der Fehler steht.
 */
describe('checkEntryForm', () => {
  it.each<[string, Partial<EntryFormValues>, string, string, string[]]>([
    ['ohne Tag', { dayKey: '' }, 'day', 'Bitte einen Tag wählen.', []],
    [
      'ohne Projekt',
      { projectId: '' },
      'project',
      'Bitte ein Projekt wählen — ohne Projekt lässt sich die Zeit nicht abrechnen.',
      [],
    ],
    [
      'unlesbarer Beginn',
      { from: '9 Uhr' },
      'time',
      'Bitte gültige Uhrzeiten angeben, zum Beispiel 09:15.',
      ['from'],
    ],
    [
      'Minuten ueber 59 (09:99 war frueher 10:45)',
      { to: '09:99' },
      'time',
      'Bitte gültige Uhrzeiten angeben, zum Beispiel 09:15.',
      ['to'],
    ],
    [
      'nach Mitternacht (24:15)',
      { to: '24:15' },
      'time',
      'Bitte gültige Uhrzeiten angeben, zum Beispiel 09:15.',
      ['to'],
    ],
    [
      'beide Zeiten unlesbar',
      { from: '', to: 'x' },
      'time',
      'Bitte gültige Uhrzeiten angeben, zum Beispiel 09:15.',
      ['from', 'to'],
    ],
    [
      'Ende vor Beginn',
      { from: '11:00', to: '09:00' },
      'time',
      'Das Ende liegt vor dem Beginn.',
      ['to'],
    ],
    [
      'Ende gleich Beginn',
      { from: '11:00', to: '11:00' },
      'time',
      'Der Eintrag muss mindestens 15 Minuten lang sein.',
      ['to'],
    ],
  ])('%s', (_label, change, field, message, invalid) => {
    const result = checkEntryForm({ ...BASE, ...change });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.field).toBe(field);
      expect(result.problem.message).toBe(message);
      expect(result.problem.invalid).toEqual(invalid);
    }
  });

  it('meldet den Tag vor dem Projekt und das Projekt vor den Zeiten (wie im Dialog)', () => {
    const result = checkEntryForm({ ...BASE, dayKey: '', projectId: '', from: 'x' });
    expect(!result.ok && result.problem.field).toBe('day');

    const second = checkEntryForm({ ...BASE, projectId: '', from: 'x' });
    expect(!second.ok && second.problem.field).toBe('project');
  });

  it('rundet sichtbar auf Viertelstunden und verlangt ein zweites Speichern', () => {
    const result = checkEntryForm({ ...BASE, from: '09:08', to: '10:52' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.rounded).toEqual({ from: '09:15', to: '10:45' });
      expect(result.problem.message).toBe(
        'Auf Viertelstunden gerundet: 09:15 bis 10:45. Noch einmal „Speichern", wenn das so passt.',
      );
    }
    // Mit den gerundeten Werten geht es durch.
    expect(checkEntryForm({ ...BASE, from: '09:15', to: '10:45' }).ok).toBe(true);
  });

  it('nimmt 24:00 als Tagesende an', () => {
    const result = checkEntryForm({ ...BASE, from: '23:00', to: '24:00' });
    expect(result).toEqual({
      ok: true,
      placement: { dayKey: '2026-09-15', startMinutes: 1380, endMinutes: 1440 },
      projectId: 'p1',
      description: 'Datenmodell',
    });
  });

  it('schreibt die Notiz einzeilig und ohne Rand', () => {
    const result = checkEntryForm({ ...BASE, description: '  Checkout\n  testen \r\n' });
    expect(result.ok && result.description).toBe('Checkout testen');
  });

  /**
   * Fruehjahrsumstellung 29.03.2026: 02:00–03:00 gibt es in Berlin nicht. Das
   * Formular laesst die Eingabe durch (sie ist lesbar und sinnvoll lang);
   * gespeichert wird, was `instantsOf` daraus macht — und genau das zeigt das
   * Panel nach dem Speichern (`effectivePlacement`).
   */
  it('laesst eine Zeit in der Umstellungsluecke durch; gespeichert wird hinter dem Sprung', () => {
    const result = checkEntryForm({ ...BASE, dayKey: '2026-03-29', from: '02:00', to: '03:00' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const stored = effectivePlacement(result.placement);
      expect(stored.dayKey).toBe('2026-03-29');
      expect(formatClock(stored.startMinutes)).toBe('03:00');
      expect(stored.endMinutes - stored.startMinutes).toBe(60);
    }
  });
});

describe('Formularwerte', () => {
  it('liest HH:MM und H:MM, nicht aber Unsinn', () => {
    expect(parseClock('09:15')).toBe(555);
    expect(parseClock(' 9:15 ')).toBe(555);
    expect(parseClock('24:00')).toBe(1440);
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('9.15')).toBeNull();
  });

  it('macht aus Position und Inhalt die Feldwerte', () => {
    const values = entryFormValues(
      { dayKey: '2026-09-15', startMinutes: 555, endMinutes: 660 },
      null,
      '',
    );
    expect(values).toEqual({
      dayKey: '2026-09-15',
      from: '09:15',
      to: '11:00',
      projectId: '',
      description: '',
    });
    expect(sameEntryForm(values, { ...values })).toBe(true);
    expect(sameEntryForm(values, { ...values, description: ' ' })).toBe(false);
  });

  it('zeigt den Entwurf nur, solange die Zeiten Sinn ergeben', () => {
    expect(formPlacement(BASE)).toEqual({
      dayKey: '2026-09-15',
      startMinutes: 555,
      endMinutes: 660,
    });
    expect(formPlacement({ ...BASE, to: '09:1' })).toBeNull();
    expect(formPlacement({ ...BASE, to: '09:15' })).toBeNull();
  });
});
