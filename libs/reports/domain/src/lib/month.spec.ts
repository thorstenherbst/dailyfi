import {
  currentMonthKey,
  firstDayOf,
  formatMonth,
  lastDayOf,
  monthKeyOf,
  monthRange,
  shiftMonth,
  toMonthKey,
} from './month';

describe('Monatsgrenzen', () => {
  it('beginnt um Mitternacht in Europe/Berlin, nicht in der Zeitzone des Rechners', () => {
    // Winter: UTC+1. Die Grenze liegt am 31.12. um 23:00 UTC.
    expect(monthRange('2026-01').from.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    // Sommer: UTC+2.
    expect(monthRange('2026-07').from.toISOString()).toBe('2026-06-30T22:00:00.000Z');
  });

  it('ist im Umstellmonat eine Stunde kuerzer als 31 × 24 h', () => {
    const { from, to } = monthRange('2026-03');

    expect(from.toISOString()).toBe('2026-02-28T23:00:00.000Z');
    expect(to.toISOString()).toBe('2026-03-31T22:00:00.000Z');
    // 743 statt 744: am 29.03. fehlt eine Stunde. Rechnete man den Monat als
    // 31 Tage à 24 h, griffe die Abfrage eine Stunde in den April.
    expect((to.getTime() - from.getTime()) / 3_600_000).toBe(743);
  });

  it('ist im Oktober eine Stunde laenger', () => {
    const { from, to } = monthRange('2026-10');

    expect((to.getTime() - from.getTime()) / 3_600_000).toBe(745);
  });

  it('ordnet einen Zeitpunkt dem Monat zu, in dem er in Berlin liegt', () => {
    // 31.10.2026 23:30 UTC ist in Berlin der 1. November, 00:30.
    expect(monthKeyOf(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11');
    expect(monthKeyOf(new Date('2026-10-31T22:30:00Z'))).toBe('2026-10');
  });

  it('rechnet ueber die Jahresgrenze', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-03', -14)).toBe('2025-01');
  });

  it('kennt den ersten und den letzten Tag', () => {
    expect(firstDayOf('2026-02')).toBe('2026-02-01');
    expect(lastDayOf('2026-02')).toBe('2026-02-28');
    expect(lastDayOf('2028-02')).toBe('2028-02-29'); // Schaltjahr
    expect(lastDayOf('2026-12')).toBe('2026-12-31');
  });

  it('schreibt den Monat deutsch aus', () => {
    expect(formatMonth('2026-10')).toBe('Oktober 2026');
    expect(formatMonth('2026-01')).toBe('Januar 2026');
  });

  it('nimmt den laufenden Monat aus der Wandzeit in Berlin', () => {
    expect(currentMonthKey(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11');
    expect(toMonthKey(2026, 3)).toBe('2026-03');
  });
});
