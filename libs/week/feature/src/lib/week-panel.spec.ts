import { signal } from '@angular/core';

import { Placement } from '@lib/shared/util-time';
import { EntryFormValues, entryFormValues } from '@lib/week/domain';

import { WeekPanel } from './week-panel';

const BLOCK: Placement = { dayKey: '2026-09-15', startMinutes: 555, endMinutes: 660 };
const OTHER: Placement = { dayKey: '2026-09-16', startMinutes: 600, endMinutes: 660 };

/** Der „Store": Feldwerte je Eintrag, veraenderlich wie im Raster. */
function setup(): {
  panel: WeekPanel;
  stored: ReturnType<typeof signal<Record<string, EntryFormValues>>>;
} {
  const stored = signal<Record<string, EntryFormValues>>({
    e1: entryFormValues(BLOCK, 'p1', 'Datenmodell'),
    e2: entryFormValues(OTHER, 'p2', ''),
  });
  const panel = new WeekPanel((id) => stored()[id] ?? null);
  return { panel, stored };
}

describe('WeekPanel', () => {
  describe('Zustaende', () => {
    it('startet leer', () => {
      const { panel } = setup();

      expect(panel.mode()).toBe('empty');
      expect(panel.values()).toBeNull();
      expect(panel.notice()).toBe(false);
      expect(panel.confirmMessage()).toBeNull();
    });

    // Aus week-dialogs.spec: „legt ohne Projektvorauswahl an".
    it('legt ohne Projektvorauswahl an', () => {
      const { panel } = setup();
      panel.openCreate(BLOCK, 'grid');

      // Am Projekt haengt die Rechnung — ein vorbelegtes waere schnell
      // versehentlich uebernommen.
      expect(panel.mode()).toBe('create');
      expect(panel.values()).toEqual({
        dayKey: '2026-09-15',
        from: '09:15',
        to: '11:00',
        projectId: '',
        description: '',
      });
      expect(panel.entryId()).toBeNull();
      expect(panel.origin()).toBe('grid');
    });

    // Aus week-dialogs.spec: „gibt beim Bearbeiten die Kennung zurueck".
    it('bearbeitet mit Kennung und den gespeicherten Werten', () => {
      const { panel } = setup();
      panel.openEdit('e1');

      expect(panel.mode()).toBe('edit');
      expect(panel.entryId()).toBe('e1');
      expect(panel.values()).toEqual(entryFormValues(BLOCK, 'p1', 'Datenmodell'));
    });

    // Aus week-dialogs.spec: „vergisst die Kennung nach dem Schliessen" und
    // „haelt Anlegen und Bearbeiten auseinander".
    it('vergisst die Kennung nach dem Schliessen und beim Wechsel zum Anlegen', () => {
      const { panel } = setup();
      panel.openEdit('e1');
      panel.close();
      expect(panel.entryId()).toBeNull();

      panel.openEdit('e1');
      panel.openCreate(OTHER, 'button');
      // Sonst speicherte ein danach angelegter Eintrag ueber den alten.
      expect(panel.entryId()).toBeNull();
      expect(panel.mode()).toBe('create');
    });

    it('ist leer, wenn der bearbeitete Eintrag verschwindet', () => {
      const { panel, stored } = setup();
      panel.openEdit('e1');

      stored.update(({ e2 }) => ({ e2 }));

      expect(panel.mode()).toBe('empty');
      expect(panel.entryId()).toBeNull();
    });
  });

  describe('Ungespeicherte Aenderungen', () => {
    it('ist nach dem Oeffnen nicht dirty, nach dem Tippen schon — und nach dem Zuruecktippen nicht mehr', () => {
      const { panel } = setup();
      panel.openEdit('e1');
      expect(panel.dirty()).toBe(false);

      panel.change('description', 'Neu');
      expect(panel.dirty()).toBe(true);
      expect(panel.values()?.description).toBe('Neu');

      panel.change('description', 'Datenmodell');
      expect(panel.dirty()).toBe(false);
    });

    it('fuehrt ohne Aenderungen jede Absicht sofort aus', () => {
      const { panel } = setup();
      panel.openEdit('e1');

      expect(panel.request({ kind: 'select', entryId: 'e2' })).toBe(true);
      expect(panel.notice()).toBe(false);
    });

    it('wechselt mit Aenderungen nicht, sondern parkt die Absicht und zeigt den Hinweis', () => {
      const { panel } = setup();
      panel.openEdit('e1');
      panel.change('from', '10:00');

      const allowed = panel.request({ kind: 'select', entryId: 'e2' });

      expect(allowed).toBe(false);
      expect(panel.entryId()).toBe('e1');
      expect(panel.values()?.from).toBe('10:00');
      expect(panel.notice()).toBe(true);
      expect(panel.pending()).toEqual({ kind: 'select', entryId: 'e2' });
    });

    it('gibt die geparkte Absicht beim Verwerfen heraus', () => {
      const { panel } = setup();
      panel.openEdit('e1');
      panel.change('from', '10:00');
      panel.request({ kind: 'create', placement: OTHER, origin: 'grid' });

      const action = panel.takePending();
      panel.discardEdits();

      expect(action).toEqual({ kind: 'create', placement: OTHER, origin: 'grid' });
      expect(panel.dirty()).toBe(false);
      expect(panel.notice()).toBe(false);
      expect(panel.values()?.from).toBe('09:15');
    });

    it('haelt Absicht und Eingaben, wenn das Speichern scheitert', () => {
      const { panel } = setup();
      panel.openEdit('e1');
      panel.change('description', 'Neu');
      panel.request({ kind: 'select', entryId: 'e2' });

      panel.beginSave();
      expect(panel.busy()).toBe(true);
      panel.saveFailed();

      expect(panel.busy()).toBe(false);
      expect(panel.notice()).toBe(true);
      expect(panel.pending()).toEqual({ kind: 'select', entryId: 'e2' });
      expect(panel.values()?.description).toBe('Neu');
    });

    it('bleibt nach dem Speichern mit dem gespeicherten Eintrag offen', () => {
      const { panel, stored } = setup();
      panel.openCreate(OTHER, 'button');
      panel.change('projectId', 'p1');
      panel.beginSave();
      // Der Store legt an; der Server vergibt die Kennung.
      stored.update((all) => ({ ...all, n1: entryFormValues(OTHER, 'p1', '') }));
      panel.saved('n1');

      expect(panel.mode()).toBe('edit');
      expect(panel.entryId()).toBe('n1');
      expect(panel.dirty()).toBe(false);
      expect(panel.values()?.projectId).toBe('p1');
    });
  });

  describe('Waehrend des Speicherns', () => {
    it('parkt jede Absicht still — ohne Hinweis — und gibt sie nach dem Erfolg heraus', () => {
      const { panel } = setup();
      panel.openEdit('e1');
      panel.change('description', 'Neu');
      panel.beginSave();

      expect(panel.request({ kind: 'select', entryId: 'e2' })).toBe(false);
      expect(panel.notice()).toBe(false);
      expect(panel.entryId()).toBe('e1');

      panel.saved('e1');
      expect(panel.notice()).toBe(false);
      expect(panel.takePending()).toEqual({ kind: 'select', entryId: 'e2' });
    });

    it('parkt auch ohne Getipptes (Enter auf unveraendertem Eintrag)', () => {
      const { panel } = setup();
      panel.openEdit('e1');
      panel.beginSave();

      expect(panel.request({ kind: 'week', delta: 1 })).toBe(false);
      expect(panel.notice()).toBe(false);
      panel.saved('e1');
      expect(panel.pending()).toEqual({ kind: 'week', delta: 1 });
    });

    it('zeigt den Hinweis erst, wenn das Speichern scheitert — die Absicht bleibt geparkt', () => {
      const { panel } = setup();
      panel.openEdit('e1');
      panel.change('description', 'Neu');
      panel.beginSave();
      panel.request({ kind: 'leave', intent: { url: '/projects' } });

      panel.saveFailed();

      expect(panel.notice()).toBe(true);
      expect(panel.pending()).toEqual({ kind: 'leave', intent: { url: '/projects' } });
      expect(panel.noticeMessage()).toBe(
        'Erst speichern oder verwerfen — danach verlässt du die Woche.',
      );
    });
  });

  describe('Hinweistext', () => {
    it('nennt die geparkte Absicht und zaehlt jede neue mit', () => {
      const { panel } = setup();
      panel.openEdit('e1');
      panel.change('description', 'Neu');

      panel.request({ kind: 'week', delta: -1 });
      expect(panel.noticeMessage()).toContain('danach geht es zur vorigen Woche');
      const revision = panel.noticeRevision();

      panel.request({ kind: 'select', entryId: 'e2' });
      expect(panel.noticeMessage()).toContain('danach öffnet sich der gewählte Eintrag');
      expect(panel.noticeRevision()).toBe(revision + 1);
    });
  });

  describe('Raster ↔ Panel', () => {
    it('uebernimmt Von/Bis aus dem Raster, solange nichts getippt ist', () => {
      const { panel, stored } = setup();
      panel.openEdit('e1');

      stored.update((all) => ({
        ...all,
        e1: entryFormValues({ ...BLOCK, startMinutes: 540, endMinutes: 645 }, 'p1', 'Datenmodell'),
      }));

      expect(panel.values()?.from).toBe('09:00');
      expect(panel.values()?.to).toBe('10:45');
      expect(panel.notice()).toBe(false);
    });

    it('folgt dem Raster in nicht getippten Feldern — ohne Hinweis, Speichern nimmt beides', () => {
      const { panel, stored } = setup();
      panel.openEdit('e1');
      panel.change('description', 'Neu');

      // Block im Raster verschoben (Pfeil oder Maus), sofort gespeichert.
      stored.update((all) => ({
        ...all,
        e1: entryFormValues({ ...BLOCK, startMinutes: 540, endMinutes: 645 }, 'p1', 'Datenmodell'),
      }));

      expect(panel.conflict()).toBe(false);
      expect(panel.notice()).toBe(false);
      expect(panel.dirty()).toBe(true);
      // Was „Speichern" schreiben wird: die Notiz mit der neuen Lage.
      expect(panel.values()).toEqual(
        entryFormValues({ ...BLOCK, startMinutes: 540, endMinutes: 645 }, 'p1', 'Neu'),
      );
    });

    it('meldet einen Konflikt, wenn ein getipptes Feld im Raster geaendert wird, und sagt, was die Knoepfe tun', () => {
      const { panel, stored } = setup();
      panel.openEdit('e1');
      panel.change('to', '11:30');

      // ⇧↓ im Raster: Ende 11:00 → 11:15.
      stored.update((all) => ({
        ...all,
        e1: entryFormValues({ ...BLOCK, endMinutes: 675 }, 'p1', 'Datenmodell'),
      }));

      expect(panel.values()?.to).toBe('11:30');
      expect(panel.conflict()).toBe(true);
      expect(panel.notice()).toBe(true);
      expect(panel.noticeMessage()).toBe(
        'Die Zeit wurde im Raster geändert (jetzt 9:15–11:15). ' +
          'Speichern übernimmt deine Eingabe 9:15–11:30, Verwerfen behält das Raster.',
      );
      // „Verwerfen" heisst hier: den Stand aus dem Raster uebernehmen.
      expect(panel.takePending()).toEqual({ kind: 'adopt' });
      panel.discardEdits();
      expect(panel.values()?.to).toBe('11:15');
      expect(panel.notice()).toBe(false);
    });

    it('meldet einen Konflikt beim getippten Tag, wenn der Block im Raster den Tag wechselt', () => {
      const { panel, stored } = setup();
      panel.openEdit('e1');
      panel.change('dayKey', '2026-09-17');

      // → im Raster: Dienstag → Mittwoch.
      stored.update((all) => ({
        ...all,
        e1: entryFormValues({ ...BLOCK, dayKey: '2026-09-16' }, 'p1', 'Datenmodell'),
      }));

      expect(panel.conflict()).toBe(true);
      expect(panel.noticeMessage()).toBe(
        'Der Tag wurde im Raster geändert (jetzt Mittwoch). ' +
          'Speichern übernimmt deine Eingabe Donnerstag, Verwerfen behält das Raster.',
      );
    });

    it('kein Konflikt, wenn das Raster genau auf den getippten Wert geht', () => {
      const { panel, stored } = setup();
      panel.openEdit('e1');
      panel.change('to', '11:15');

      stored.update((all) => ({
        ...all,
        e1: entryFormValues({ ...BLOCK, endMinutes: 675 }, 'p1', 'Datenmodell'),
      }));

      expect(panel.conflict()).toBe(false);
    });

    // Sonst bliebe das Panel dirty, und Speichern
    // schickte einen identischen Schreibzugriff.
    it('nimmt ein Feld aus dem Overlay, wenn das Raster genau auf den getippten Wert geht', () => {
      const { panel, stored } = setup();
      panel.openEdit('e1');
      panel.change('to', '11:15');
      expect(panel.dirty()).toBe(true);

      stored.update((all) => ({
        ...all,
        e1: entryFormValues({ ...BLOCK, endMinutes: 675 }, 'p1', 'Datenmodell'),
      }));

      expect(panel.dirty()).toBe(false);
      expect(panel.notice()).toBe(false);
      // Das Feld folgt wieder dem Raster — auch beim naechsten Schritt.
      stored.update((all) => ({
        ...all,
        e1: entryFormValues({ ...BLOCK, endMinutes: 690 }, 'p1', 'Datenmodell'),
      }));
      expect(panel.values()?.to).toBe('11:30');
      expect(panel.conflict()).toBe(false);
    });

    it('behaelt andere getippte Felder, wenn nur eines vom Raster eingeholt wird', () => {
      const { panel, stored } = setup();
      panel.openEdit('e1');
      panel.change('to', '11:15');
      panel.change('description', 'Getippt');

      stored.update((all) => ({
        ...all,
        e1: entryFormValues({ ...BLOCK, endMinutes: 675 }, 'p1', 'Datenmodell'),
      }));

      expect(panel.dirty()).toBe(true);
      expect(panel.values()).toMatchObject({ to: '11:15', description: 'Getippt' });
    });

    // Die Basis eines (wieder) getippten Feldes ist der
    // Stand der Quelle beim Aufnehmen, nicht der vom ersten Tippen.
    it('meldet keinen Konflikt, wenn ein vom Raster eingeholtes Feld neu getippt wird', () => {
      const { panel, stored } = setup();
      panel.openEdit('e1');
      panel.change('to', '11:15');
      // ⇧↓ im Raster: der Store folgt auf 11:15.
      stored.update((all) => ({
        ...all,
        e1: entryFormValues({ ...BLOCK, endMinutes: 675 }, 'p1', 'Datenmodell'),
      }));

      panel.change('to', '11:00');

      expect(panel.conflict()).toBe(false);
      expect(panel.notice()).toBe(false);
      expect(panel.dirty()).toBe(true);
      expect(panel.values()?.to).toBe('11:00');
    });

    it('meldet weiter einen Konflikt, wenn das Raster ein getipptes Feld danach woanders hinsetzt', () => {
      const { panel, stored } = setup();
      panel.openEdit('e1');
      panel.change('to', '11:15');
      stored.update((all) => ({
        ...all,
        e1: entryFormValues({ ...BLOCK, endMinutes: 675 }, 'p1', 'Datenmodell'),
      }));
      panel.change('to', '11:00');

      stored.update((all) => ({
        ...all,
        e1: entryFormValues({ ...BLOCK, endMinutes: 690 }, 'p1', 'Datenmodell'),
      }));

      expect(panel.conflict()).toBe(true);
      expect(panel.noticeMessage()).toContain('jetzt 9:15–11:30');
    });

    it('verliert nichts, wenn das eigene Speichern optimistisch anzeigt und dann scheitert', () => {
      const { panel, stored } = setup();
      panel.openEdit('e1');
      panel.change('from', '09:00');
      panel.beginSave();
      const before = stored();
      stored.update((all) => ({
        ...all,
        e1: entryFormValues({ ...BLOCK, startMinutes: 540 }, 'p1', 'Datenmodell'),
      }));

      // Zurueckgerollt.
      stored.set(before);
      panel.saveFailed();

      expect(panel.dirty()).toBe(true);
      expect(panel.values()?.from).toBe('09:00');
    });

    it('meldet waehrend des eigenen Speicherns keinen Konflikt', () => {
      const { panel, stored } = setup();
      panel.openEdit('e1');
      panel.change('from', '09:00');
      panel.beginSave();

      // Optimistisch: der Store hat die neue Zeit schon.
      stored.update((all) => ({
        ...all,
        e1: entryFormValues({ ...BLOCK, startMinutes: 540 }, 'p1', 'Datenmodell'),
      }));

      expect(panel.conflict()).toBe(false);
      expect(panel.notice()).toBe(false);
    });
  });

  describe('Fehler am Feld', () => {
    it('loescht den Fehler, wenn das betroffene Feld geaendert wird — nicht bei anderen', () => {
      const { panel } = setup();
      panel.openCreate(BLOCK, 'grid');
      panel.problem.set({ field: 'project', message: 'Bitte ein Projekt wählen', invalid: [] });

      panel.change('description', 'x');
      expect(panel.problem()).not.toBeNull();

      panel.change('projectId', 'p1');
      expect(panel.problem()).toBeNull();
    });

    it('schreibt die gerundeten Zeiten in die Felder', () => {
      const { panel } = setup();
      panel.openCreate(BLOCK, 'grid');
      panel.applyRounding('09:15', '10:45');

      expect(panel.values()?.from).toBe('09:15');
      expect(panel.values()?.to).toBe('10:45');
    });
  });

  // Unveraendert aus week-dialogs.spec.ts uebernommen.
  describe('Loeschrueckfrage', () => {
    it('fragt vor dem Loeschen mit dem Text des Blocks', () => {
      const { panel } = setup();
      panel.askDelete('e1', 'Relaunch, Dienstag 9:15 bis 11:00');

      expect(panel.confirmSubject()).toBe('Relaunch, Dienstag 9:15 bis 11:00');
      expect(panel.confirmMessage()).toBe('Der Eintrag wird endgültig gelöscht.');
      expect(panel.confirmDelete()).toBe('e1');
      expect(panel.confirmMessage()).toBeNull();
    });

    it('loescht nach dem Abbrechen nichts', () => {
      const { panel } = setup();
      panel.askDelete('e1', 'Relaunch');
      panel.cancelDelete();

      expect(panel.confirmMessage()).toBeNull();
      // Entscheidend: die Kennung ist weg, ein spaeteres Bestaetigen trifft
      // nicht doch noch den alten Eintrag.
      expect(panel.confirmDelete()).toBeNull();
    });
  });
});
