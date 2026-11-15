import { signal } from '@angular/core';

import { EditSession } from './edit-session';

interface Values {
  readonly name: string;
  readonly rate: string;
}

type Intent = { readonly kind: 'open'; readonly id: string } | { readonly kind: 'close' };

function setup(initial: Values | null = { name: 'Relaunch', rate: '95,00' }) {
  const source = signal<Values | null>(initial);
  const session = new EditSession<Values, Intent>(() => source());
  return { source, session };
}

describe('EditSession', () => {
  describe('Overlay', () => {
    it('zeigt die Quelle, solange nichts getippt ist', () => {
      const { session } = setup();

      expect(session.values()).toEqual({ name: 'Relaunch', rate: '95,00' });
      expect(session.dirty()).toBe(false);
      expect(session.edits()).toEqual({});
    });

    it('legt Getipptes feldweise ueber die Quelle; nicht getippte Felder folgen ihr', () => {
      const { session, source } = setup();
      session.change('name', 'Relaunch 2027');

      source.set({ name: 'Relaunch', rate: '110,00' });

      expect(session.values()).toEqual({ name: 'Relaunch 2027', rate: '110,00' });
      expect(session.edits()).toEqual({ name: 'Relaunch 2027' });
      expect(session.dirty()).toBe(true);
    });

    it('ist nach dem Zuruecktippen auf den gespeicherten Wert nicht mehr dirty', () => {
      const { session } = setup();
      session.change('name', 'X');
      session.change('name', 'Relaunch');

      expect(session.dirty()).toBe(false);
    });

    it('ohne Quelle: keine Werte, nicht dirty, Tippen geht ins Leere', () => {
      const { session } = setup(null);
      session.change('name', 'X');

      expect(session.values()).toBeNull();
      expect(session.dirty()).toBe(false);
    });

    it('nimmt ein Feld heraus, wenn die Quelle genau den getippten Wert annimmt', () => {
      const { session, source } = setup();
      session.change('rate', '110,00');

      source.set({ name: 'Relaunch', rate: '110,00' });

      expect(session.dirty()).toBe(false);
      // … und es folgt danach wieder der Quelle.
      source.set({ name: 'Relaunch', rate: '120,00' });
      expect(session.values()?.rate).toBe('120,00');
      expect(session.conflict()).toBe(false);
    });

    it('meldet einen Konflikt, wenn sich ein getipptes Feld in der Quelle anders aendert', () => {
      const { session, source } = setup();
      session.change('rate', '110,00');

      source.set({ name: 'Relaunch', rate: '100,00' });

      expect(session.conflictKeys()).toEqual(['rate']);
      expect(session.notice()).toBe(true);
      // Nichts ueberschrieben.
      expect(session.values()?.rate).toBe('110,00');
    });

    it('nimmt beim erneuten Tippen die aktuelle Quelle als Basis', () => {
      const { session, source } = setup();
      session.change('rate', '110,00');
      source.set({ name: 'Relaunch', rate: '110,00' });

      session.change('rate', '90,00');

      expect(session.conflict()).toBe(false);
      expect(session.dirty()).toBe(true);
    });

    it('behaelt die Basis, solange ein Feld durchgehend getippt bleibt', () => {
      const { session, source } = setup();
      session.change('rate', '1');
      source.set({ name: 'Relaunch', rate: '100,00' });
      session.change('rate', '11');

      // Die Quelle hat sich unter dem Tippen geaendert: das bleibt ein Konflikt.
      expect(session.conflict()).toBe(true);
    });

    it('raeumt waehrend des eigenen Speicherns nichts weg — scheitert es, ist das Getippte noch da', () => {
      const { session, source } = setup();
      session.change('rate', '110,00');
      session.beginSave();
      source.set({ name: 'Relaunch', rate: '110,00' }); // optimistisch

      expect(session.conflict()).toBe(false);
      source.set({ name: 'Relaunch', rate: '95,00' }); // zurueckgerollt
      session.saveFailed();

      expect(session.values()?.rate).toBe('110,00');
      expect(session.dirty()).toBe(true);
    });

    it('raeumt waehrend eines fremden Schreibvorgangs nichts weg — rollt er zurueck, bleibt das Getippte', () => {
      const source = signal<Values | null>({ name: 'Relaunch', rate: '95,00' });
      const pending = signal(false);
      const session = new EditSession<Values, Intent>(() => source(), { pending: () => pending() });
      session.change('rate', '110,00');

      // Fremd und optimistisch genau auf den getippten Wert …
      pending.set(true);
      source.set({ name: 'Relaunch', rate: '110,00' });
      expect(session.edits()).toEqual({ rate: '110,00' });
      expect(session.conflict()).toBe(false);

      // … gescheitert: erst Rollback, dann fertig (Vertrag „Rollback vor Ende").
      source.set({ name: 'Relaunch', rate: '95,00' });
      pending.set(false);

      expect(session.values()?.rate).toBe('110,00');
      expect(session.dirty()).toBe(true);
      expect(session.conflict()).toBe(false);
    });

    it('nimmt ein Feld heraus, sobald ein fremder Schreibvorgang den getippten Wert bestaetigt', () => {
      const source = signal<Values | null>({ name: 'Relaunch', rate: '95,00' });
      const pending = signal(false);
      const session = new EditSession<Values, Intent>(() => source(), { pending: () => pending() });
      session.change('rate', '110,00');

      pending.set(true);
      source.set({ name: 'Relaunch', rate: '110,00' });
      expect(session.dirty()).toBe(true);

      pending.set(false);
      expect(session.dirty()).toBe(false);
    });

    it('discard verwirft das Getippte, restart auch die geparkte Absicht', () => {
      const { session } = setup();
      session.change('name', 'X');
      session.request({ kind: 'close' });

      session.discard();
      expect(session.dirty()).toBe(false);
      expect(session.pending()).toEqual({ kind: 'close' });

      session.change('name', 'Y');
      session.request({ kind: 'close' });
      session.restart();
      expect(session.dirty()).toBe(false);
      expect(session.pending()).toBeNull();
    });
  });

  describe('Absichten', () => {
    it('laesst ohne Getipptes sofort gehen', () => {
      const { session } = setup();

      expect(session.request({ kind: 'open', id: 'b' })).toBe(true);
      expect(session.pending()).toBeNull();
      expect(session.notice()).toBe(false);
    });

    it('parkt mit Getipptem, zeigt den Hinweis und zaehlt jede Absicht', () => {
      const { session } = setup();
      session.change('name', 'X');

      expect(session.request({ kind: 'open', id: 'b' })).toBe(false);
      expect(session.request({ kind: 'open', id: 'b' })).toBe(false);

      expect(session.notice()).toBe(true);
      expect(session.noticeRevision()).toBe(2);
      expect(session.takePending()).toEqual({ kind: 'open', id: 'b' });
      expect(session.pending()).toBeNull();
    });

    it('parkt waehrend des Speicherns still und gibt die Absicht nach dem Erfolg heraus', () => {
      const { session } = setup();
      session.change('name', 'X');
      session.beginSave();

      expect(session.request({ kind: 'close' })).toBe(false);
      expect(session.notice()).toBe(false);

      session.saved();
      expect(session.dirty()).toBe(false);
      expect(session.takePending()).toEqual({ kind: 'close' });
    });

    it('haelt einen schon stehenden Hinweis waehrend des Speicherns fest', () => {
      const { session } = setup();
      session.change('name', 'X');
      session.request({ kind: 'close' });
      session.beginSave();

      expect(session.notice()).toBe(true);
      expect(session.busy()).toBe(true);

      session.saveFailed();
      expect(session.notice()).toBe(true);
      expect(session.pending()).toEqual({ kind: 'close' });
    });

    it('vergisst die geparkte Absicht, wenn alles zurueckgetippt ist', () => {
      const { session } = setup();
      session.change('name', 'X');
      session.change('rate', '110,00');
      session.request({ kind: 'open', id: 'b' });

      session.change('name', 'Relaunch');
      expect(session.pending()).toEqual({ kind: 'open', id: 'b' });

      session.change('rate', '95,00');
      expect(session.dirty()).toBe(false);
      expect(session.pending()).toBeNull();
      expect(session.notice()).toBe(false);
    });

    it('dropPending vergisst die Absicht', () => {
      const { session } = setup();
      session.change('name', 'X');
      session.request({ kind: 'close' });
      session.dropPending();

      expect(session.pending()).toBeNull();
      expect(session.notice()).toBe(false);
    });
  });
});
