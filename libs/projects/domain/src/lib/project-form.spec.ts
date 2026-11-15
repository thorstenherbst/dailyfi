import {
  checkClientForm,
  checkProjectForm,
  clientFormValues,
  newProjectFormValues,
  projectFormValues,
} from './project-form';

describe('Inline-Zeile: Pruefung', () => {
  describe('Kunde', () => {
    // Aus projects-page.spec (Dialog): „weist einen leeren Namen ab, ohne den Server zu fragen".
    it('weist einen leeren Namen ab', () => {
      expect(checkClientForm(clientFormValues('   '))).toEqual({
        ok: false,
        problem: { field: 'name', message: 'Bitte einen Namen eingeben.' },
      });
    });

    it('nimmt den Namen ohne Rand an', () => {
      expect(checkClientForm(clientFormValues('  Bäcker & Sohn '))).toEqual({
        ok: true,
        value: { name: 'Bäcker & Sohn' },
      });
    });
  });

  describe('Projekt', () => {
    const values = { ...newProjectFormValues('c1', '#0D7380'), name: 'Wartung', rate: '110,50' };

    it('liefert den Entwurf mit Komma-Stundensatz', () => {
      expect(checkProjectForm(values)).toEqual({
        ok: true,
        value: { clientId: 'c1', name: 'Wartung', color: '#0D7380', hourlyRate: 110.5 },
      });
    });

    // Aus project-dialog.ts: „Bitte einen Kunden wählen." (bisher ohne Test).
    it('verlangt einen Kunden', () => {
      expect(checkProjectForm({ ...values, clientId: '' })).toEqual({
        ok: false,
        problem: { field: 'client', message: 'Bitte einen Kunden wählen.' },
      });
    });

    // Aus project-dialog.ts: „Bitte einen Projektnamen eingeben." (bisher ohne Test).
    it('verlangt einen Namen', () => {
      expect(checkProjectForm({ ...values, name: ' ' })).toEqual({
        ok: false,
        problem: { field: 'name', message: 'Bitte einen Projektnamen eingeben.' },
      });
    });

    // Aus projects-page.spec (Dialog): „nimmt keinen unsinnigen Stundensatz an".
    it('nimmt keinen unsinnigen Stundensatz an', () => {
      expect(checkProjectForm({ ...values, rate: 'neunzig' })).toEqual({
        ok: false,
        problem: {
          field: 'rate',
          message: 'Der Stundensatz muss eine Zahl sein, zum Beispiel 95 oder 95,50.',
        },
      });
    });

    it('nennt einen negativen und einen zu grossen Satz eigens', () => {
      expect(checkProjectForm({ ...values, rate: '-5' })).toEqual({
        ok: false,
        problem: { field: 'rate', message: 'Der Stundensatz darf nicht negativ sein.' },
      });
      expect(checkProjectForm({ ...values, rate: '100.000.000,00' })).toEqual({
        ok: false,
        problem: {
          field: 'rate',
          message: 'Der Stundensatz darf höchstens 99.999.999,99 € betragen.',
        },
      });
    });

    it('erlaubt ein Projekt ohne Satz', () => {
      const result = checkProjectForm({ ...values, rate: '' });
      expect(result.ok && result.value.hourlyRate).toBeNull();
    });

    it('gibt eine fremde Farbe unveraendert weiter', () => {
      const result = checkProjectForm({ ...values, color: '#123456' });
      expect(result.ok && result.value.color).toBe('#123456');
    });

    it('liest ein gespeichertes Projekt in Feldwerte (Satz deutsch)', () => {
      expect(
        projectFormValues({
          id: 'p1',
          clientId: 'c1',
          name: 'Relaunch',
          color: '#A8412A',
          hourlyRate: 95.5,
          archivedAt: null,
        }),
      ).toEqual({ name: 'Relaunch', color: '#A8412A', rate: '95,50', clientId: 'c1' });
    });
  });
});
