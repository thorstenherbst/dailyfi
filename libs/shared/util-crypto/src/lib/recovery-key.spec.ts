import { formatRecoveryKey, generateRecoveryKey, parseRecoveryKey } from './recovery-key';

describe('Wiederherstellungsschluessel', () => {
  it('schreibt 32 Bytes als 52 Zeichen in Vierergruppen', () => {
    const text = formatRecoveryKey(generateRecoveryKey());

    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('liest zurueck, was er geschrieben hat', () => {
    for (let i = 0; i < 50; i++) {
      const bytes = generateRecoveryKey();
      expect(parseRecoveryKey(formatRecoveryKey(bytes))).toEqual(bytes);
    }
  });

  it('nimmt Kleinschreibung, Leerzeichen und verwechselbare Zeichen hin', () => {
    const bytes = new Uint8Array(32);
    const text = formatRecoveryKey(bytes); // nur Nullen

    expect(
      parseRecoveryKey(` ${text.toLowerCase().replaceAll('0', 'o').replaceAll('-', ' ')} `),
    ).toEqual(bytes);
  });

  it('weist falsche Laenge, fremde Zeichen und gesetzte Fuellbits ab', () => {
    const text = formatRecoveryKey(generateRecoveryKey());

    expect(parseRecoveryKey(text.slice(0, -1))).toBeNull();
    expect(parseRecoveryKey(`${text}0`)).toBeNull();
    expect(parseRecoveryKey(text.replace(/.$/, 'U'))).toBeNull();
    // Das letzte Zeichen traegt 4 Fuellbits, die null sein muessen.
    expect(parseRecoveryKey(text.replace(/.$/, '1'))).toBeNull();
  });
});
