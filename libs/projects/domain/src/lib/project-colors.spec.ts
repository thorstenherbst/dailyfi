import { DEFAULT_PROJECT_COLOR, PROJECT_COLORS, colorName } from './project-colors';

describe('Projektfarben', () => {
  it('bietet die sechs Projektfarben an', () => {
    expect(PROJECT_COLORS.map((color) => color.name)).toEqual([
      'Kobalt',
      'Smaragd',
      'Senf',
      'Kupfer',
      'Graphit',
      'Petrol',
    ]);
    expect(PROJECT_COLORS.map((color) => color.slot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(PROJECT_COLORS.every((color) => /^#[0-9A-F]{6}$/.test(color.value))).toBe(true);
    expect(DEFAULT_PROJECT_COLOR).toBe('#2F5BD3');
  });

  it('gibt jeder Farbe einen Namen — auch einer alten', () => {
    // Die Farbe darf nie die einzige Information sein.
    expect(colorName('#2f5bd3')).toBe('Kobalt');
    expect(colorName('  #1A7A4A ')).toBe('Smaragd');
    expect(colorName('#A8412A')).toBe('Kupfer'); // Terrakotta, ohne Migration
  });

  it('nennt einen fremden Wert so, wie er gezeigt wird: als Graphit', () => {
    // Block und Farbpunkt zeigen Graphit; die Liste sagt dasselbe und nennt
    // den gespeicherten Wert dazu.
    expect(colorName('#123456')).toBe('Graphit (eigener Wert #123456)');
  });
});
