import { DayKey, weekDayKeys, wallToInstant } from '@lib/shared/util-time';
import { Project, TimeEntry } from '@lib/week/domain';

import {
  BlockView,
  HANDLE_MIN_MOVE_PX,
  HANDLE_SIZE_PX,
  buildColumns,
  handleInsetPx,
} from './week-grid-view';

const MONDAY: DayKey = '2026-09-14';
const DAYS = weekDayKeys(MONDAY);
const DI: DayKey = '2026-09-15';

const PROJECTS = new Map<string, Project>([
  ['p1', { id: 'p1', name: 'Relaunch', color: '#A8412A', clientName: 'Sandmann GmbH' }],
  ['p2', { id: 'p2', name: 'Wartung', color: '#123456', clientName: 'Nordlicht Medien' }],
]);

function entry(id: string, day: DayKey, from: number, to: number, extra: Partial<TimeEntry> = {}) {
  return {
    id,
    projectId: 'p1',
    startedAt: wallToInstant(day, from),
    endedAt: wallToInstant(day, to),
    description: '',
    ...extra,
  } satisfies TimeEntry;
}

function build(
  entries: TimeEntry[],
  preview: Parameters<typeof buildColumns>[0]['preview'] = null,
) {
  return buildColumns({
    days: DAYS,
    entries,
    projectsById: PROJECTS,
    today: DI,
    preview,
  });
}

function dayOf(columns: ReturnType<typeof build>, day: DayKey) {
  return columns.find((column) => column.key === day)!;
}

describe('buildColumns', () => {
  it('legt sieben Spalten an und markiert heute', () => {
    const columns = build([]);

    expect(columns).toHaveLength(7);
    expect(columns.map((column) => column.key)).toEqual(DAYS);
    expect(columns.filter((column) => column.isToday).map((column) => column.key)).toEqual([DI]);
  });

  it('setzt einen Eintrag an seine Uhrzeit', () => {
    const [block] = dayOf(build([entry('e1', DI, 555, 660)]), DI).blocks; // 9:15–11:00

    expect(block.timeLabel).toBe('09:15–11:00');
    // 60 px je Stunde: 9,25 h ab Mitternacht, 1,75 h hoch.
    expect(block.topPx).toBeCloseTo(9.25 * 60);
    expect(block.heightPx).toBeCloseTo(1.75 * 60);
    expect(block.widthCss).toBe('calc(100% - 6px)');
  });

  it('stellt Ueberlappungen nebeneinander', () => {
    const columns = build([entry('e1', DI, 540, 660), entry('e2', DI, 600, 720)]);
    const blocks = dayOf(columns, DI).blocks;

    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.widthCss)).toEqual(['calc(50% - 6px)', 'calc(50% - 6px)']);
    expect(blocks.map((block) => block.leftCss)).toEqual(['calc(0% + 3px)', 'calc(50% + 3px)']);
  });

  it('laesst nebeneinanderliegende Eintraege ganze Breite behalten', () => {
    const blocks = dayOf(build([entry('e1', DI, 540, 600), entry('e2', DI, 600, 660)]), DI).blocks;

    expect(blocks.map((block) => block.widthCss)).toEqual(['calc(100% - 6px)', 'calc(100% - 6px)']);
  });

  it('faerbt Bloecke ueber den Shared Kernel, alte Schluessel ohne Migration', () => {
    // p1 hat den alten Schluessel Terrakotta → Kupfer, p2 einen fremden → Graphit.
    const columns = build([
      entry('e1', DI, 540, 600),
      entry('e2', DI, 600, 660, { projectId: 'p2' }),
    ]);
    expect(dayOf(columns, DI).blocks.map((block) => block.colorClass)).toEqual(['pc4', 'pc5']);
  });

  it('benennt ein unbekanntes Projekt statt leer zu bleiben', () => {
    const [block] = dayOf(build([entry('e1', DI, 540, 600, { projectId: 'weg' })]), DI).blocks;

    expect(block.projectName).toBe('Unbekanntes Projekt');
    expect(block.clientName).toBe('');
    expect(block.colorClass).toBe('pc-none');
  });

  it('gibt Griffe ab 30 Minuten und laesst immer 24 px zum Verschieben', () => {
    const block = (minutes: number) =>
      dayOf(build([entry('e1', DI, 540, 540 + minutes)]), DI).blocks[0];

    // 15 Minuten: keine Griffe — die Mindesthoehe reicht nicht fuer drei Zonen.
    expect(block(15).showHandles).toBe(false);

    for (const minutes of [30, 45, 60, 120]) {
      const view = block(minutes);
      const inner = view.heightPx - 2 * view.handleInsetPx;
      expect(view.showHandles).toBe(true);
      // Griffe ueberlappen nicht und lassen in der Mitte ≥ 24 px frei …
      expect(inner).toBeGreaterThanOrEqual(HANDLE_MIN_MOVE_PX);
      // … und ragen hoechstens zur Haelfte (12 px) hinein.
      expect(view.handleInsetPx).toBeLessThanOrEqual(HANDLE_SIZE_PX / 2);
    }
    expect(block(30).handleInsetPx).toBe(3); // 30 px hoch: 3 + 24 + 3
    expect(block(60).handleInsetPx).toBe(12); // halb ueber der Kante
  });

  it('rechnet den Griff-Anteil fuer kurze Bloecke von der gezeichneten Hoehe', () => {
    expect(handleInsetPx(15)).toBe(0); // gezeichnet mit 24 px
    expect(handleInsetPx(48)).toBe(12);
    expect(handleInsetPx(36)).toBe(6);
  });

  describe('Griffe an Nachbarn', () => {
    // Trefferflaechen in px ab Mitternacht, wie sie das CSS zeichnet.
    const topHandle = (b: BlockView) => ({
      from: b.topPx - b.handleOutsetTopPx,
      to: b.topPx + b.handleInsetPx,
    });
    const bottomHandle = (b: BlockView) => ({
      from: b.topPx + b.heightPx - b.handleInsetPx,
      to: b.topPx + b.heightPx + b.handleOutsetBottomPx,
    });
    const blocksOf = (entries: TimeEntry[]) =>
      new Map(dayOf(build(entries), DI).blocks.map((b) => [b.id, b]));

    it('laesst bei direkt aufeinanderfolgenden Bloecken nichts ueber die Kante', () => {
      const blocks = blocksOf([entry('a', DI, 540, 600), entry('b', DI, 600, 660)]);
      const a = blocks.get('a')!;
      const b = blocks.get('b')!;

      // A unten und B oben liegen komplett im eigenen Block …
      expect(a.handleOutsetBottomPx).toBe(0);
      expect(b.handleOutsetTopPx).toBe(0);
      expect(bottomHandle(a).from).toBeGreaterThanOrEqual(a.topPx);
      expect(bottomHandle(a).to).toBeLessThanOrEqual(a.topPx + a.heightPx);
      expect(topHandle(b).from).toBeGreaterThanOrEqual(b.topPx);
      expect(topHandle(b).to).toBeLessThanOrEqual(b.topPx + b.heightPx);
      // … und ueberlappen sich nicht.
      expect(bottomHandle(a).to).toBeLessThanOrEqual(topHandle(b).from);
      // Die freien Kanten bleiben wie bisher.
      expect(a.handleOutsetTopPx).toBe(HANDLE_SIZE_PX - a.handleInsetPx);
      expect(b.handleOutsetBottomPx).toBe(HANDLE_SIZE_PX - b.handleInsetPx);
    });

    it('begrenzt den aeusseren Anteil auf die halbe Luecke', () => {
      // 10 px Luecke bei 60 px/h: 10 Minuten.
      const blocks = blocksOf([entry('a', DI, 540, 600), entry('b', DI, 610, 670)]);
      const a = blocks.get('a')!;
      const b = blocks.get('b')!;

      expect(b.topPx - (a.topPx + a.heightPx)).toBeCloseTo(10);
      expect(a.handleOutsetBottomPx).toBeLessThanOrEqual(5);
      expect(b.handleOutsetTopPx).toBeLessThanOrEqual(5);
      expect(bottomHandle(a).to).toBeLessThanOrEqual(topHandle(b).from + 1e-9);
    });

    it('laesst einen Block ohne Nachbarn wie bisher', () => {
      const [block] = dayOf(build([entry('a', DI, 540, 600)]), DI).blocks;

      expect(block.handleInsetPx).toBe(12);
      expect(block.handleOutsetTopPx).toBe(12);
      expect(block.handleOutsetBottomPx).toBe(12);
    });

    it('zaehlt Bloecke in einer anderen Spur nicht als Nachbarn', () => {
      // a und b ueberlappen (zwei Spuren), c schliesst nur an b an.
      const blocks = blocksOf([
        entry('a', DI, 540, 660),
        entry('b', DI, 600, 660),
        entry('c', DI, 720, 780),
      ]);

      expect(blocks.get('a')!.handleOutsetTopPx).toBe(12);
      expect(blocks.get('b')!.handleOutsetTopPx).toBe(12);
      // a und c teilen sich die Breite: 60 px Luecke, also voller Rest.
      expect(blocks.get('c')!.handleOutsetTopPx).toBe(12);
    });
  });

  it('zeichnet die laufende Geste statt der gespeicherten Position', () => {
    const rows = [entry('e1', DI, 555, 660)];
    const preview = {
      entryId: 'e1',
      placement: { dayKey: '2026-09-17', startMinutes: 780, endMinutes: 840 },
    };
    const columns = build(rows, preview);

    expect(dayOf(columns, DI).blocks).toHaveLength(0);
    expect(dayOf(columns, '2026-09-17').blocks[0].timeLabel).toBe('13:00–14:00');
  });

  it('nennt im Vorlesetext Projekt, Zeit und Beschreibung', () => {
    const [block] = dayOf(
      build([entry('e1', DI, 555, 660, { description: 'Datenmodell' })]),
      DI,
    ).blocks;

    expect(block.ariaLabel).toContain('Relaunch');
    expect(block.ariaLabel).toContain('9:15');
    expect(block.ariaLabel).toContain('Datenmodell');
  });

  it('weist am Umstelltag auf die abweichende abgerechnete Dauer hin', () => {
    // 29.03.2026: 02:00 fehlt, der Tag hat 23 Stunden. Ein Block von 01:00 bis
    // 04:00 ist drei Rasterstunden hoch, bringt aber nur zwei auf die Rechnung.
    const umstellung = dayOf(
      buildColumns({
        days: weekDayKeys('2026-03-23'),
        entries: [entry('e1', '2026-03-29', 60, 240)],
        projectsById: PROJECTS,
        today: '2026-03-23',
        preview: null,
      }),
      '2026-03-29',
    ).blocks[0];

    expect(umstellung.billedNote).not.toBeNull();
    expect(umstellung.ariaLabel).toContain('abgerechnet');

    // An einem gewoehnlichen Tag stimmen beide Dauern und der Hinweis entfaellt.
    expect(dayOf(build([entry('e1', DI, 60, 240)]), DI).blocks[0].billedNote).toBeNull();
  });
});
