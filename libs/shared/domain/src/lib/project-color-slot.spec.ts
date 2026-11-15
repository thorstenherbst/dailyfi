import {
  PROJECT_COLOR_KEYS,
  isForeignProjectColor,
  projectColorClass,
  projectColorSlot,
} from './project-color-slot';

describe('Projektfarben-Slots', () => {
  it('kennt die sechs Schluessel des Designs', () => {
    expect(Object.values(PROJECT_COLOR_KEYS)).toEqual([
      '#2F5BD3',
      '#1A7A4A',
      '#8A6100',
      '#B3500E',
      '#4A4F57',
      '#0D7380',
    ]);
    expect(projectColorSlot('#2f5bd3')).toBe(1);
    expect(projectColorSlot('  #0D7380 ')).toBe(6);
  });

  it('bildet die gespeicherten Farben des alten Designs ohne Migration ab', () => {
    expect(projectColorSlot('#414BA8')).toBe(1); // Indigo → Kobalt
    expect(projectColorSlot('#4f46e5')).toBe(1); // DB-Default → Kobalt
    expect(projectColorSlot('#3F6B4C')).toBe(2); // Salbei → Smaragd
    expect(projectColorSlot('#8A5512')).toBe(3); // Bernstein → Senf
    expect(projectColorSlot('#a8412a')).toBe(4); // Terrakotta → Kupfer
    expect(projectColorSlot('#8C3A5E')).toBe(5); // Beere → Graphit
    expect(projectColorSlot('#256868')).toBe(6); // Petrol → Petrol
  });

  it('zeigt fremde Werte neutral als Graphit', () => {
    expect(isForeignProjectColor('#123456')).toBe(true);
    expect(isForeignProjectColor('#A8412A')).toBe(false);
    expect(projectColorSlot('#123456')).toBe(5);
    expect(projectColorClass('#123456')).toBe('pc5');
    expect(projectColorClass('#A8412A')).toBe('pc4');
  });
});
