import {
  HOUR_HEIGHT_PX,
  MINUTES_PER_DAY,
  SNAP_MINUTES,
  assignLanes,
  addDays,
  dayLengthMinutes,
  describePlacement,
  dstDayOfWeek,
  durationHours,
  formatClock,
  formatHours,
  formatWeekRange,
  formatWeekRangeShort,
  instantToWall,
  isoWeekNumber,
  minutesToPx,
  movePlacement,
  placementFromDrag,
  pxToMinutes,
  pxToSnappedMinutes,
  resizePlacement,
  samePlacement,
  shiftDay,
  snapToQuarter,
  startOfWeek,
  sumHours,
  wallToInstant,
  weekDayKeys,
} from './week-time';

describe('Pixel und Viertelstunden', () => {
  it('rechnet eine Stunde in die Rasterhoehe um', () => {
    expect(minutesToPx(60)).toBe(HOUR_HEIGHT_PX);
    expect(minutesToPx(15)).toBe(15);
    expect(minutesToPx(0)).toBe(0);
  });

  it('rechnet Pixel zurueck in Minuten', () => {
    expect(pxToMinutes(60)).toBe(60);
    expect(pxToMinutes(15)).toBe(15);
  });

  it('rundet auf die naechste Viertelstunde', () => {
    expect(snapToQuarter(0)).toBe(0);
    expect(snapToQuarter(7)).toBe(0);
    expect(snapToQuarter(8)).toBe(15);
    expect(snapToQuarter(37)).toBe(30);
    expect(snapToQuarter(38)).toBe(45);
    expect(snapToQuarter(-8)).toBe(-15);
  });

  it('rastet eine Pixelposition auf eine Viertelstunde ein und bleibt im Tag', () => {
    // 9:00 liegt bei 9 * 60 px.
    expect(pxToSnappedMinutes(9 * HOUR_HEIGHT_PX)).toBe(540);
    // Ein paar Pixel darunter rastet noch auf 9:00 ein.
    expect(pxToSnappedMinutes(9 * HOUR_HEIGHT_PX + 5)).toBe(540);
    // Deutlich weiter unten auf 9:15.
    expect(pxToSnappedMinutes(9 * HOUR_HEIGHT_PX + 11)).toBe(555);
    expect(pxToSnappedMinutes(-40)).toBe(0);
    expect(pxToSnappedMinutes(99_999)).toBe(1440);
  });

  it('macht aus einem Zug einen Block von mindestens einer Viertelstunde', () => {
    expect(placementFromDrag('2026-09-15', 545, 610)).toEqual({
      dayKey: '2026-09-15',
      startMinutes: 540,
      endMinutes: 615,
    });
    // Nach oben gezogen: Anfang und Ende tauschen.
    expect(placementFromDrag('2026-09-15', 660, 600)).toEqual({
      dayKey: '2026-09-15',
      startMinutes: 600,
      endMinutes: 660,
    });
    // Nur geklickt: 15 Minuten.
    expect(placementFromDrag('2026-09-15', 540, 542)).toEqual({
      dayKey: '2026-09-15',
      startMinutes: 540,
      endMinutes: 555,
    });
    // Am Tagesende bleibt der Block im Tag.
    expect(placementFromDrag('2026-09-15', 1440, 1440)).toEqual({
      dayKey: '2026-09-15',
      startMinutes: 1425,
      endMinutes: 1440,
    });
  });
});

describe('Woche', () => {
  it('beginnt am Montag', () => {
    expect(startOfWeek('2026-09-20')).toBe('2026-09-14'); // Sonntag
    expect(startOfWeek('2026-09-14')).toBe('2026-09-14'); // Montag
    expect(startOfWeek('2026-09-17')).toBe('2026-09-14'); // Donnerstag
  });

  it('liefert sieben Tage Montag bis Sonntag', () => {
    expect(weekDayKeys('2026-09-14')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
  });

  it('kennt die Kalenderwoche nach ISO 8601', () => {
    expect(isoWeekNumber('2026-09-14')).toBe(38);
    expect(isoWeekNumber('2026-09-20')).toBe(38);
    expect(isoWeekNumber('2026-01-01')).toBe(1);
    expect(isoWeekNumber('2025-12-29')).toBe(1); // gehoert schon zu 2026
  });

  it('beschriftet die Woche, auch ueber den Monatswechsel', () => {
    expect(formatWeekRange('2026-09-14')).toBe('14.–20. September 2026');
    expect(formatWeekRange('2026-03-30')).toBe('30. März – 5. April 2026');
  });

  it('rechnet ueber den Monatswechsel hinweg in Kalendertagen', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('Sommerzeit in Europe/Berlin', () => {
  it('stellt am 29.03.2026 von 02:00 auf 03:00 vor', () => {
    // Mitternacht ist noch Winterzeit (UTC+1).
    expect(wallToInstant('2026-03-29', 0).toISOString()).toBe('2026-03-28T23:00:00.000Z');
    // 03:00 ist schon Sommerzeit (UTC+2).
    expect(wallToInstant('2026-03-29', 3 * 60).toISOString()).toBe('2026-03-29T01:00:00.000Z');
    // 02:30 gibt es an diesem Tag nicht. Die Luecke hat keine reale Dauer und
    // faellt deshalb auf den ersten Zeitpunkt zusammen, den es wieder gibt.
    expect(instantToWall(wallToInstant('2026-03-29', 150))).toEqual({
      dayKey: '2026-03-29',
      minutes: 180,
    });
  });

  it('bildet beide Umstelltage monoton ab', () => {
    for (const dayKey of ['2026-03-29', '2026-10-25']) {
      for (let minutes = 0; minutes < MINUTES_PER_DAY; minutes += SNAP_MINUTES) {
        const here = wallToInstant(dayKey, minutes).getTime();
        const next = wallToInstant(dayKey, minutes + SNAP_MINUTES).getTime();
        expect(next, `${dayKey} ${formatClock(minutes)}`).toBeGreaterThanOrEqual(here);
      }
    }
  });

  it('waechst ausserhalb der Luecke echt', () => {
    // Nur die Luecke 02:00–03:00 am 29.03. bildet ein Plateau — sonst nichts.
    const inGap = (minutes: number): boolean => minutes >= 120 && minutes < 180;
    for (let minutes = 0; minutes < MINUTES_PER_DAY; minutes += SNAP_MINUTES) {
      if (inGap(minutes) || inGap(minutes + SNAP_MINUTES)) {
        continue;
      }
      expect(
        wallToInstant('2026-03-29', minutes + SNAP_MINUTES).getTime(),
        `29.03. ${formatClock(minutes)}`,
      ).toBeGreaterThan(wallToInstant('2026-03-29', minutes).getTime());
    }
    for (let minutes = 0; minutes < MINUTES_PER_DAY; minutes += SNAP_MINUTES) {
      expect(
        wallToInstant('2026-10-25', minutes + SNAP_MINUTES).getTime(),
        `25.10. ${formatClock(minutes)}`,
      ).toBeGreaterThan(wallToInstant('2026-10-25', minutes).getTime());
    }
  });

  it('kennt die Laenge eines Umstelltages', () => {
    expect(dayLengthMinutes('2026-03-29')).toBe(23 * 60);
    expect(dayLengthMinutes('2026-10-25')).toBe(25 * 60);
    expect(dayLengthMinutes('2026-09-15')).toBe(24 * 60);
  });

  it('findet den Umstelltag einer Woche', () => {
    expect(dstDayOfWeek('2026-03-23')).toEqual({ dayKey: '2026-03-29', hours: 23 });
    expect(dstDayOfWeek('2026-10-19')).toEqual({ dayKey: '2026-10-25', hours: 25 });
    expect(dstDayOfWeek('2026-09-14')).toBeNull();
  });

  it('weist kaputte Tagesschluessel zurueck, statt ins Jahr 1900 zu rechnen', () => {
    expect(() => wallToInstant('', 540)).toThrow(RangeError);
    expect(() => wallToInstant('2026-13-01', 540)).toThrow(RangeError);
    expect(() => wallToInstant('2026-02-30', 540)).toThrow(RangeError);
  });

  it('erkennt unveraenderte Positionen', () => {
    const a = { dayKey: '2026-09-15', startMinutes: 540, endMinutes: 600 };
    expect(samePlacement(a, { ...a })).toBe(true);
    expect(samePlacement(a, { ...a, startMinutes: 555 })).toBe(false);
    expect(samePlacement(a, { ...a, dayKey: '2026-09-16' })).toBe(false);
  });

  it('zaehlt am kurzen Tag nur die real gearbeiteten Stunden', () => {
    const start = wallToInstant('2026-03-29', 60); // 01:00
    const end = wallToInstant('2026-03-29', 4 * 60); // 04:00
    expect(durationHours(start, end)).toBe(2);
  });

  it('zaehlt am langen Tag im Oktober die Stunde doppelt', () => {
    const start = wallToInstant('2026-10-25', 60); // 01:00 Sommerzeit
    const end = wallToInstant('2026-10-25', 4 * 60); // 04:00 Winterzeit
    expect(durationHours(start, end)).toBe(4);
  });

  it('haelt die Woche mit Zeitumstellung trotzdem bei sieben Tagen', () => {
    const monday = startOfWeek('2026-03-29');
    expect(monday).toBe('2026-03-23');
    expect(weekDayKeys(monday)).toHaveLength(7);
    expect(weekDayKeys(monday)[6]).toBe('2026-03-29');

    // Die Woche ist real eine Stunde kuerzer als 7 x 24 h.
    const from = wallToInstant(monday, 0);
    const to = wallToInstant(addDays(monday, 7), 0);
    expect(durationHours(from, to)).toBe(167);
  });

  it('ueberlebt die Rueckrechnung Zeitpunkt → Wandzeit → Zeitpunkt', () => {
    for (const dayKey of weekDayKeys('2026-10-19')) {
      for (const minutes of [0, 345, 540, 1425]) {
        const instant = wallToInstant(dayKey, minutes);
        expect(instantToWall(instant)).toEqual({ dayKey, minutes });
      }
    }
  });
});

describe('Wochensumme', () => {
  const entry = (day: string, from: number, to: number) => ({
    startedAt: wallToInstant(day, from),
    endedAt: wallToInstant(day, to),
  });

  it('summiert die Stunden der Woche', () => {
    const entries = [
      entry('2026-09-14', 9 * 60, 12 * 60 + 30), // 3,50
      entry('2026-09-15', 8 * 60 + 15, 12 * 60), // 3,75
      entry('2026-09-17', 13 * 60, 17 * 60), // 4,00
    ];
    expect(sumHours(entries)).toBeCloseTo(11.25, 10);
    expect(formatHours(sumHours(entries))).toBe('11,25');
  });

  it('zeigt immer zwei Nachkommastellen mit Komma', () => {
    expect(formatHours(0)).toBe('0,00');
    expect(formatHours(31.25)).toBe('31,25');
    expect(formatHours(8)).toBe('8,00');
    expect(formatHours(1 / 3)).toBe('0,33');
  });

  it('zaehlt die Zeitumstellung in der Wochensumme mit', () => {
    expect(formatHours(sumHours([entry('2026-03-29', 60, 4 * 60)]))).toBe('2,00');
    expect(formatHours(sumHours([entry('2026-10-25', 60, 4 * 60)]))).toBe('4,00');
  });
});

describe('Blockbewegung', () => {
  const block = { dayKey: '2026-09-15', startMinutes: 555, endMinutes: 660 }; // 9:15–11:00

  it('verschiebt und behaelt die Dauer', () => {
    expect(movePlacement(block, -15)).toEqual({
      dayKey: '2026-09-15',
      startMinutes: 540,
      endMinutes: 645,
    });
  });

  it('laesst den Block nicht aus dem Tag laufen', () => {
    expect(movePlacement(block, -10_000)).toEqual({
      dayKey: '2026-09-15',
      startMinutes: 0,
      endMinutes: 105,
    });
    expect(movePlacement(block, 10_000)).toEqual({
      dayKey: '2026-09-15',
      startMinutes: 1335,
      endMinutes: 1440,
    });
  });

  it('aendert die Dauer und bleibt bei mindestens 15 Minuten', () => {
    expect(resizePlacement(block, 15).endMinutes).toBe(675);
    expect(resizePlacement(block, -10_000)).toEqual({
      dayKey: '2026-09-15',
      startMinutes: 555,
      endMinutes: 570,
    });
  });

  it('wechselt den Tag und behaelt die Uhrzeit', () => {
    expect(shiftDay(block, 1).dayKey).toBe('2026-09-16');
    expect(shiftDay(block, -1)).toEqual({ ...block, dayKey: '2026-09-14' });
  });

  it('sagt die Position in ganzen Worten an', () => {
    expect(describePlacement('Relaunch', block)).toBe('Relaunch, Dienstag 9:15 bis 11:00');
  });
});

describe('Ueberlappungen', () => {
  it('legt sich nicht beruehrende Blocke jeweils auf die volle Breite', () => {
    const lanes = assignLanes([
      { startMinutes: 540, endMinutes: 600 },
      { startMinutes: 600, endMinutes: 660 },
    ]);
    expect(lanes.map((l) => [l.lane, l.lanes])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it('legt ueberlappende Blocke nebeneinander', () => {
    const lanes = assignLanes([
      { startMinutes: 540, endMinutes: 660 },
      { startMinutes: 600, endMinutes: 720 },
    ]);
    expect(lanes.map((l) => [l.lane, l.lanes])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it('gibt eine freie Spalte wieder her', () => {
    const lanes = assignLanes([
      { startMinutes: 540, endMinutes: 600 }, // A
      { startMinutes: 550, endMinutes: 700 }, // B ueberlappt A
      { startMinutes: 610, endMinutes: 660 }, // C passt wieder in A's Spalte
    ]);
    expect(lanes.map((l) => l.lane)).toEqual([0, 1, 0]);
    expect(lanes.every((l) => l.lanes === 2)).toBe(true);
  });
});

describe('formatWeekRangeShort', () => {
  const TODAY = '2026-11-09';

  it('kuerzt die Woche im selben Monat', () => {
    expect(formatWeekRangeShort('2026-11-02', TODAY)).toBe('2.–8. Nov');
  });

  it('nennt beide Monate ueber einen Monatswechsel', () => {
    expect(formatWeekRangeShort('2026-11-30', TODAY)).toBe('30. Nov – 6. Dez');
  });

  it('nennt das Jahr nur, wenn es nicht das aktuelle ist', () => {
    expect(formatWeekRangeShort('2026-12-28', TODAY)).toBe('28. Dez – 3. Jan 2027');
    expect(formatWeekRangeShort('2025-12-29', TODAY)).toBe('29. Dez 2025 – 4. Jan');
    expect(formatWeekRangeShort('2025-11-03', TODAY)).toBe('3.–9. Nov 2025');
    expect(formatWeekRangeShort('2026-03-02', TODAY)).toBe('2.–8. Mär');
  });
});
