import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AXIS_WIDTH_PX, HOUR_HEIGHT_PX } from './week-time';

/**
 * Drift-Schutz: Das Raster rechnet Zeigerpositionen in TS-Pixeln, gezeichnet
 * wird mit den SCSS-Tokens (`--hour-h`, `--axis-w`). Laufen beide auseinander,
 * landen gezogene Bloecke neben der Maus. Gelesen wird die Quelle der Tokens,
 * `$layout` in `abstracts/_tokens.scss`.
 */
function layoutToken(name: string): number {
  // Relativ zu dieser Datei, nicht zum Arbeitsverzeichnis. Ueber den Pfad
  // statt `new URL(…)`: Unter jsdom ist `URL` die jsdom-Klasse, die `fs`
  // nicht als Datei-URL annimmt.
  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, '../../../styles/src/abstracts/_tokens.scss');
  const source = readFileSync(file, 'utf8');
  const layout = /\$layout:\s*\(([\s\S]*?)\);/.exec(source)?.[1];
  if (!layout) {
    throw new Error(`$layout nicht gefunden in ${file}`);
  }
  const value = new RegExp(`(?:^|[\\s,(])${name}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(layout)?.[1];
  if (!value) {
    throw new Error(`${name} nicht in $layout`);
  }
  return Number(value);
}

describe('Rastergeometrie TS ↔ SCSS', () => {
  it('nutzt dieselbe Stundenhoehe wie $layout.hour-h', () => {
    expect(HOUR_HEIGHT_PX).toBe(layoutToken('hour-h'));
  });

  it('nutzt dieselbe Achsenbreite wie $layout.axis-w', () => {
    expect(AXIS_WIDTH_PX).toBe(layoutToken('axis-w'));
  });
});
