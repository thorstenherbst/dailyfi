import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileString } from 'sass';

/**
 * Bei 1024 px muessen E-Mail und „Abmelden" in die Statusleiste passen. jsdom
 * rechnet kein Layout, darum werden die Regeln des echten SCSS geprueft (wie
 * in toast-styles.spec.ts): nur die E-Mail darf schrumpfen, der Link
 * „Rechtliches" und „Abmelden" bleiben ganz und brechen nicht um.
 */
describe('Styles der Statusleiste', () => {
  const styles = resolve(process.cwd(), 'libs/shared/styles/src');
  const file = resolve(process.cwd(), 'libs/shared/ui/src/lib/status-bar.scss');
  const css = compileString(readFileSync(file, 'utf8'), {
    loadPaths: [styles],
    url: new URL(`file://${file}`),
  }).css;

  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => [selector.trim(), body] as const,
  );
  const body = (selector: string): string =>
    rules
      .filter(([candidate]) => candidate === selector)
      .map(([, declarations]) => declarations)
      .join(';');

  it('laesst nichts ausser der E-Mail schrumpfen', () => {
    expect(body(':host > *')).toMatch(/flex-shrink\s*:\s*0/);
    expect(body('.right')).toMatch(/min-width\s*:\s*0/);
    expect(body('.email')).toMatch(/min-width\s*:\s*0/);
    expect(body('.email')).toMatch(/text-overflow\s*:\s*ellipsis/);
    expect(body('.btn-link')).toMatch(/flex-shrink\s*:\s*0/);
  });

  it('haelt „Rechtliches" klein: waechst nicht, bricht nicht um, Ziel ≥ 24 px', () => {
    const legal = body('.legal');
    expect(legal).toMatch(/flex\s*:\s*none/);
    expect(legal).toMatch(/white-space\s*:\s*nowrap/);
    expect(legal).toMatch(/min-height\s*:\s*24px/);
  });
});
