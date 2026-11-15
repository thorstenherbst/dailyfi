import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileString } from 'sass';

/**
 * Die Live-Regionen der Toasts duerfen von keiner CSS-Regel versteckt werden —
 * auch nicht im leeren Zustand. Angular laesst in einem leeren `@for` nur
 * Kommentarknoten stehen, `:empty` greift also; eine Regel
 * `:empty { display: none }` nahm beide Regionen aus dem Accessibility-Tree,
 * und die erste Ansage ging verloren.
 *
 * jsdom laedt die globalen Styles nicht, `getComputedStyle` beweist dort nichts.
 * Darum wird hier das echte SCSS uebersetzt und jede Regel geprueft, die eine
 * Region treffen kann.
 */
describe('Styles der Toast-Region', () => {
  const root = resolve(process.cwd(), 'libs/shared/styles/src');
  const css = compileString(readFileSync(resolve(root, 'index.scss'), 'utf8'), {
    loadPaths: [root],
    url: new URL(`file://${resolve(root, 'index.scss')}`),
    silenceDeprecations: ['import'],
  }).css;

  /** Alle Regeln als [Selektor, Deklarationen], ohne @media-Verschachtelung. */
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => [selector.trim(), body] as const,
  );

  /** Selektoren, die eine der Regionen (`.toast-live.sr-only` in `.toast-region`) treffen koennen. */
  const touchesRegion = (selector: string): boolean =>
    /\.toast-(live|stack|region)\b|\.sr-only\b/.test(selector);

  it('versteckt die Regionen mit keiner Regel', () => {
    const hiding = rules.filter(
      ([selector, body]) =>
        touchesRegion(selector) &&
        /display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden/.test(body),
    );

    expect(hiding).toEqual([]);
  });

  it('hat keine :empty-Regel fuer Toasts mehr', () => {
    expect(rules.filter(([selector]) => /\.toast[\w-]*:empty/.test(selector))).toEqual([]);
  });

  it('laesst die leere Region keine Klicks schlucken', () => {
    const region = rules.find(([selector]) => selector === '.toast-region');
    expect(region?.[1]).toMatch(/pointer-events\s*:\s*none/);
  });

  /**
   * Toasts liegen nie ueber dem Detail-Panel. Solange eine Seite ein
   * Panel zeigt (`data-side-panel` am <html>), rueckt die Region um Panelbreite
   * + 16 px nach links — nur ab 1024 px, darunter gibt es kein Panel.
   */
  it('rueckt die Toasts neben das Panel, solange eines steht', () => {
    const region = rules.find(([selector]) => selector === '.toast-region');
    expect(region?.[1]).toMatch(/right\s*:\s*var\(--toast-inset-right/);

    const inset = css.match(
      /@media \(min-width: 1024px\)\s*\{\s*:root\[data-side-panel\]\s*\{([^}]*)\}/,
    );
    expect(inset?.[1]).toMatch(/--toast-inset-right:\s*calc\(var\(--panel-w\) \+ 16px\)/);
  });

  /** Das offene Rund-Menue reicht samt Hover-Bruecke bis x = 304 px. */
  it('laesst ab 1024 px links Platz fuer das offene Rund-Menue (304 + 16 px)', () => {
    const wide = css.match(/@media \(min-width: 1024px\)\s*\{\s*\.toast-region\s*\{([^}]*)\}/);
    expect(wide?.[1]).toMatch(
      /max-width:\s*min\(460px, (calc\()?100vw - var\(--toast-inset-right, 16px\) - 320px\)?\)/,
    );
  });

  it('gibt dem Panel 340 px, unter 1280 px 300 px', () => {
    expect(css).toMatch(/:root\s*\{\s*--panel-w:\s*340px;/);
    expect(css).toMatch(/@media \(max-width: 1279\.98px\)\s*\{\s*:root\s*\{\s*--panel-w:\s*300px;/);
  });
});
