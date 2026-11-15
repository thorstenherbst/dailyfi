import { MAX_RATE, formatRate, formatRateInput, parseRate } from './rate';

describe('parseRate', () => {
  it('nimmt Komma an — so tippt hier jemand', () => {
    // Number('95,50') ist NaN. Ohne diese Uebersetzung gaebe es entweder eine
    // Fehlermeldung oder, schlimmer, einen falschen Betrag in der Rechnung.
    expect(parseRate('95,50')).toEqual({ ok: true, value: 95.5 });
    expect(parseRate('0,25')).toEqual({ ok: true, value: 0.25 });
  });

  it('nimmt Punkt genauso an', () => {
    expect(parseRate('95.50')).toEqual({ ok: true, value: 95.5 });
    expect(parseRate('110')).toEqual({ ok: true, value: 110 });
  });

  it('versteht Tausenderpunkte nur zusammen mit einem Dezimalkomma', () => {
    expect(parseRate('1.250,50')).toEqual({ ok: true, value: 1250.5 });
    // Ohne Komma ist „1.250" eine Dezimalzahl und keine Tausenderangabe —
    // sonst wuerde aus 1.25 € still 125 €.
    expect(parseRate('1.25')).toEqual({ ok: true, value: 1.25 });
  });

  it('erlaubt leer: nicht jedes Projekt wird nach Stunden abgerechnet', () => {
    expect(parseRate('')).toEqual({ ok: true, value: null });
    expect(parseRate('   ')).toEqual({ ok: true, value: null });
  });

  it('raeumt Waehrungszeichen und Leerzeichen weg', () => {
    expect(parseRate(' 95,50 € ')).toEqual({ ok: true, value: 95.5 });
  });

  it('weist ab, was keine Zahl ist', () => {
    // '95€50' und '95 50' sind der Grund, warum nicht einfach alle
    // Sonderzeichen wegfliegen: sonst wuerde daraus still 9550.
    for (const input of ['abc', '95,5,5', '95,555', '1e3', '95€50', '95 50', ',', '-', '--5', '-abc']) {
      expect(parseRate(input), input).toEqual({ ok: false, problem: 'format' });
    }
  });

  it('nennt einen negativen Satz eigens', () => {
    for (const input of ['-5', '-95,50', '- 1.250,50', '-0,01']) {
      expect(parseRate(input), input).toEqual({ ok: false, problem: 'negative' });
    }
  });

  it('haelt die Obergrenze der Spalte numeric(10, 2) ein', () => {
    expect(MAX_RATE).toBe(99_999_999.99);
    expect(parseRate('99.999.999,99')).toEqual({ ok: true, value: 99_999_999.99 });
    expect(parseRate('99999999.99')).toEqual({ ok: true, value: 99_999_999.99 });
    for (const input of ['100000000', '100.000.000,00', '99999999,999']) {
      expect(parseRate(input).ok, input).toBe(false);
    }
    expect(parseRate('100000000')).toEqual({ ok: false, problem: 'too-large' });
    expect(parseRate('100.000.000,00')).toEqual({ ok: false, problem: 'too-large' });
    // Drei Nachkommastellen bleiben ein Formfehler, auch an der Grenze.
    expect(parseRate('99999999,999')).toEqual({ ok: false, problem: 'format' });
  });
});

describe('formatRate', () => {
  it('schreibt deutsch, mit zwei Stellen', () => {
    expect(formatRateInput(95.5)).toBe('95,50');
    expect(formatRateInput(1250.5)).toBe('1.250,50');
    expect(formatRateInput(null)).toBe('');
  });

  it('haengt fuer die Anzeige die Einheit an', () => {
    expect(formatRate(95.5)).toBe('95,50 €/h');
    expect(formatRate(null)).toBe('kein Satz');
  });

  it('kommt von der Anzeige zurueck zum Wert', () => {
    // Eingabefeld → Datenbank → Eingabefeld muss denselben Betrag ergeben.
    for (const value of [0, 0.25, 95.5, 110, 1250.5, MAX_RATE]) {
      expect(parseRate(formatRateInput(value))).toEqual({ ok: true, value });
    }
  });
});
