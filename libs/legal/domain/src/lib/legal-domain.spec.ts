import { isPlaceholder } from './provider';
import { DPA_VERSION_DATE, formatLegalDate } from './versions';

describe('isPlaceholder', () => {
  it('erkennt Angaben in doppelten eckigen Klammern', () => {
    expect(isPlaceholder('[[PLZ Ort]]')).toBe(true);
    expect(isPlaceholder(' [[E-Mail]] ')).toBe(true);
  });

  it('laesst echte Angaben als Text stehen', () => {
    expect(isPlaceholder('10115 Berlin')).toBe(false);
    expect(isPlaceholder('[Ort]')).toBe(false);
    expect(isPlaceholder('')).toBe(false);
  });
});

describe('formatLegalDate', () => {
  it('schreibt das Datum aus, ohne in den Vortag zu rutschen', () => {
    expect(formatLegalDate('2026-11-17')).toBe('17. November 2026');
    expect(formatLegalDate('2027-01-01')).toBe('1. Januar 2027');
  });

  it('fuehrt die Fassung des AV-Vertrags als ISO-Datum', () => {
    expect(DPA_VERSION_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
