import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ToastRegion } from './toast-region';
import { MAX_VISIBLE_TOASTS, ToastService } from './toast.service';

@Component({
  imports: [ToastRegion],
  template: `
    <button type="button" id="outside">Speichern</button>
    <main id="main" tabindex="-1"></main>
    <app-toast-region [aboveStatusBar]="true" />
  `,
})
class Host {}

interface Harness {
  fixture: ComponentFixture<Host>;
  element: HTMLElement;
  toasts: ToastService;
  render(): void;
  polite(): HTMLElement;
  urgent(): HTMLElement;
  items(): HTMLElement[];
}

function setup(): Harness {
  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  const element: HTMLElement = fixture.nativeElement;
  return {
    fixture,
    element,
    toasts: TestBed.inject(ToastService),
    render: () => fixture.detectChanges(),
    polite: () => element.querySelector<HTMLElement>('[role="status"]')!,
    urgent: () => element.querySelector<HTMLElement>('[role="alert"]')!,
    items: () => [...element.querySelectorAll<HTMLElement>('.toast')],
  };
}

/** Text einer Live-Region, Ansage fuer Ansage. */
function spoken(region: HTMLElement): string[] {
  return [...region.querySelectorAll('p')].map((p) => p.textContent!.replace(/\s+/g, ' ').trim());
}

describe('Toasts', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('Live-Regionen', () => {
    it('stehen von Anfang an im DOM, auch ohne Meldung', () => {
      const { polite, urgent, items } = setup();

      expect(polite().getAttribute('aria-live')).toBe('polite');
      expect(urgent().getAttribute('aria-live')).toBe('assertive');
      expect(items()).toEqual([]);
    });

    it('sind auch leer nicht versteckt (sonst fielen sie aus dem Accessibility-Tree)', () => {
      const { polite, urgent } = setup();

      for (const region of [polite(), urgent()]) {
        expect(region.hidden).toBe(false);
        expect(region.getAttribute('aria-hidden')).toBeNull();
        expect(region.style.display).toBe('');
        expect(getComputedStyle(region).display).not.toBe('none');
        // Visuell versteckt heisst hier `sr-only` (1 px, geclippt) — nie
        // `display: none` oder `visibility: hidden`.
        expect(region.classList).toContain('sr-only');
      }
    });

    // role=alert/status sind implizit atomar: ohne diese Attribute laese ein
    // Screenreader bei jeder neuen Meldung alle stehenden noch einmal vor.
    it('sagt nur die neue Meldung an, nicht die ganze Region (aria-atomic=false)', () => {
      const { polite, urgent, toasts, render } = setup();
      toasts.success('Eintrag gespeichert');
      toasts.error('Speichern fehlgeschlagen.');
      toasts.info('Woche geladen');
      render();

      for (const region of [polite(), urgent()]) {
        expect(region.getAttribute('aria-atomic')).toBe('false');
        expect(region.getAttribute('aria-relevant')).toBe('additions');
      }
      // Jede Ansage ist ein eigener Knoten, damit „additions" sie einzeln trifft.
      expect(spoken(polite())).toEqual(['Erfolg: Eintrag gespeichert', 'Info: Woche geladen']);
    });

    it('legt nur Fehler in die bestimmte Region, Warnung, Info und Erfolg in die hoefliche', () => {
      const { toasts, render, polite, urgent } = setup();

      toasts.info('Neue Woche.');
      toasts.success('Eintrag gespeichert');
      toasts.warning('Überschneidung:', { detail: '10:00–10:15' });
      render();

      expect(spoken(polite())).toEqual([
        'Info: Neue Woche.',
        'Erfolg: Eintrag gespeichert',
        'Warnung: Überschneidung: 10:00–10:15',
      ]);
      expect(spoken(urgent())).toEqual([]);

      toasts.error('Speichern fehlgeschlagen.', { detail: 'Keine Verbindung.' });
      render();

      expect(spoken(urgent())).toEqual(['Fehler: Speichern fehlgeschlagen. Keine Verbindung.']);
    });

    it('sagt einen Toast nicht noch einmal an, wenn er nachrueckt', () => {
      const { toasts, render, polite, items } = setup();
      toasts.info('Wartet.');
      const blockers = ['X', 'Y', 'Z'].map((text) => toasts.success(text));
      render();
      expect(items().some((item) => item.textContent?.includes('Wartet.'))).toBe(false);
      const before = [...polite().querySelectorAll('p')];

      toasts.dismiss(blockers[2]);
      render();

      // Sichtbar ist er jetzt — aber in der Live-Region kam nichts hinzu.
      expect(items().some((item) => item.textContent?.includes('Wartet.'))).toBe(true);
      const after = [...polite().querySelectorAll('p')];
      expect(after.every((node) => before.includes(node))).toBe(true);
      expect(spoken(polite()).filter((text) => text.includes('Wartet.'))).toHaveLength(1);
    });

    it('sagt dieselbe Meldung erneut an, wenn sie erneut kommt', () => {
      const { toasts, render, urgent } = setup();
      toasts.error('Laden fehlgeschlagen.');
      render();
      const first = urgent().querySelector('p');

      toasts.error('Laden fehlgeschlagen.');
      render();

      expect(spoken(urgent())).toEqual(['Fehler: Laden fehlgeschlagen.']);
      expect(urgent().querySelector('p')).not.toBe(first);
    });
  });

  describe('Typen', () => {
    it.each([
      ['info', 'Info'],
      ['success', 'Erfolg'],
      ['warning', 'Warnung'],
      ['error', 'Fehler'],
    ] as const)('zeigt %s mit Symbol und vorgelesener Art „%s"', (kind, label) => {
      const { toasts, render, items } = setup();

      toasts.show(kind, 'Text');
      render();

      const [toast] = items();
      expect(toast.classList).toContain(`is-${kind}`);
      expect(toast.querySelector('app-icon')).not.toBeNull();
      expect(toast.querySelector('.sr-only')?.textContent?.trim()).toBe(`${label}:`);
      expect(toast.textContent).toContain('Text');
    });

    it('trennt Ueberschrift und Detail lesbar', () => {
      const { toasts, render, items } = setup();

      toasts.success('Eintrag gespeichert', { detail: 'Relaunch, Dienstag 9:00 bis 10:00' });
      toasts.error('Speichern fehlgeschlagen.', { detail: 'Keine Verbindung.' });
      render();

      const texts = items().map((toast) =>
        toast.querySelector('.toast-text')!.textContent!.replace(/\s+/g, ' ').trim(),
      );
      expect(texts).toContain('Fehler: Speichern fehlgeschlagen. Keine Verbindung.');
      expect(texts).toContain('Erfolg: Eintrag gespeichert · Relaunch, Dienstag 9:00 bis 10:00');
    });
  });

  describe('Standzeit', () => {
    it('blendet Info und Erfolg nach 6 s aus, Warnungen nach 10 s', () => {
      const { toasts } = setup();
      toasts.info('Info');
      toasts.success('Erfolg');
      toasts.warning('Warnung');

      vi.advanceTimersByTime(5999);
      expect(toasts.toasts()).toHaveLength(3);
      vi.advanceTimersByTime(1);
      expect(toasts.toasts().map((toast) => toast.kind)).toEqual(['warning']);
      vi.advanceTimersByTime(4000);
      expect(toasts.toasts()).toEqual([]);
    });

    it('laesst Fehler stehen, bis man sie schliesst', () => {
      const { toasts } = setup();
      toasts.error('Speichern fehlgeschlagen.');

      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(toasts.toasts()).toHaveLength(1);
    });

    it('haelt die Zeit an, solange der Zeiger darauf liegt (WCAG 2.2.1)', () => {
      const { toasts, render, items } = setup();
      toasts.info('Info');
      render();

      vi.advanceTimersByTime(4000);
      items()[0].dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(60_000);
      expect(toasts.toasts()).toHaveLength(1);

      items()[0].dispatchEvent(new MouseEvent('mouseleave'));
      // Es laeuft die Restzeit weiter, nicht die volle Zeit von vorn.
      vi.advanceTimersByTime(1999);
      expect(toasts.toasts()).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(toasts.toasts()).toEqual([]);
    });

    it('haelt die Zeit an, solange der Fokus im Toast ist', () => {
      const { toasts, render, items } = setup();
      toasts.success('Gespeichert');
      render();

      items()[0].querySelector<HTMLButtonElement>('.toast-close')!.focus();
      vi.advanceTimersByTime(60_000);
      expect(toasts.toasts()).toHaveLength(1);

      (document.activeElement as HTMLElement).blur();
      vi.advanceTimersByTime(6000);
      expect(toasts.toasts()).toEqual([]);
    });
  });

  describe('Fokus nach dem Schliessen', () => {
    function enterRegion(harness: Harness, from: HTMLElement, target: HTMLElement): void {
      from.focus();
      target.focus();
      // jsdom setzt `relatedTarget` nicht; so kommt es auch im Browser an.
      target.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: from }));
      harness.render();
    }

    it('kehrt zum Element zurueck, das vor dem Betreten der Region den Fokus hatte', async () => {
      const harness = setup();
      harness.toasts.error('Kaputt.');
      harness.toasts.error('Auch kaputt.');
      harness.render();
      const outside = harness.element.querySelector<HTMLElement>('#outside')!;
      const close = harness.items()[0].querySelector<HTMLElement>('.toast-close')!;
      enterRegion(harness, outside, close);

      close.click();
      harness.render();
      await harness.fixture.whenStable();

      expect(document.activeElement).toBe(outside);
    });

    it('geht sonst auf „Schließen" des naechsten Toasts', async () => {
      const harness = setup();
      harness.toasts.error('Kaputt.');
      harness.toasts.error('Auch kaputt.');
      harness.render();
      const outside = harness.element.querySelector<HTMLElement>('#outside')!;
      const close = harness.items()[0].querySelector<HTMLElement>('.toast-close')!;
      enterRegion(harness, outside, close);
      outside.remove();

      close.click();
      harness.render();
      await harness.fixture.whenStable();

      const [left] = harness.items();
      expect(left.textContent).toContain('Auch kaputt.');
      expect(document.activeElement).toBe(left.querySelector('.toast-close'));
    });

    it('geht auf main, wenn kein Toast mehr steht', async () => {
      const harness = setup();
      harness.toasts.error('Kaputt.');
      harness.render();
      const close = harness.items()[0].querySelector<HTMLElement>('.toast-close')!;
      close.focus();

      close.click();
      harness.render();
      await harness.fixture.whenStable();

      expect(document.activeElement).toBe(harness.element.querySelector('main'));
    });

    it('gilt auch nach einem Klick auf die Aktion', async () => {
      const harness = setup();
      harness.toasts.error('Speichern fehlgeschlagen.', {
        action: { label: 'Erneut versuchen', run: () => undefined },
      });
      harness.render();
      const outside = harness.element.querySelector<HTMLElement>('#outside')!;
      const action = harness.items()[0].querySelector<HTMLElement>('.toast-action')!;
      enterRegion(harness, outside, action);

      action.click();
      harness.render();
      await harness.fixture.whenStable();

      expect(document.activeElement).toBe(outside);
    });
  });

  describe('Schliessen', () => {
    it('hat einen beschrifteten Schliessen-Knopf, der den Toast entfernt', () => {
      const { toasts, render, items } = setup();
      toasts.error('Kaputt.');
      render();

      const close = items()[0].querySelector<HTMLButtonElement>('.toast-close')!;
      expect(close.getAttribute('aria-label')).toBe('Meldung schließen');
      close.click();
      render();

      expect(items()).toEqual([]);
    });

    it('fuehrt eine Aktion aus und schliesst dabei', () => {
      const { toasts, render, items } = setup();
      const run = vi.fn();
      toasts.error('Speichern fehlgeschlagen.', { action: { label: 'Erneut versuchen', run } });
      render();

      items()[0].querySelector<HTMLButtonElement>('.toast-action')!.click();

      expect(run).toHaveBeenCalledOnce();
      expect(toasts.toasts()).toEqual([]);
    });
  });

  describe('Limit und Zusammenfassen', () => {
    it(`zeigt hoechstens ${MAX_VISIBLE_TOASTS}; aeltere ruecken nach, wenn Platz wird`, () => {
      const { toasts, render, items } = setup();
      const ids = ['A', 'B', 'C', 'D'].map((text) => toasts.success(text));
      render();

      expect(items()).toHaveLength(3);
      expect(items().some((toast) => toast.textContent?.includes('A'))).toBe(false);

      toasts.dismiss(ids[3]);
      render();

      expect(items()).toHaveLength(3);
      expect(items().some((toast) => toast.textContent?.includes('A'))).toBe(true);
    });

    it('verdraengt nie einen Fehler — das Limit gilt nur fuer die anderen', () => {
      const { toasts, render, items } = setup();
      toasts.error('Speichern fehlgeschlagen.');
      ['Eins', 'Zwei', 'Drei'].forEach((text) => toasts.success(text));
      render();

      const texts = items().map((toast) => toast.textContent ?? '');
      expect(texts.some((text) => text.includes('Speichern fehlgeschlagen.'))).toBe(true);
      // Neben einem Fehler bleiben zwei Plaetze: die beiden neuesten.
      expect(texts.some((text) => text.includes('Eins'))).toBe(false);
      expect(items()).toHaveLength(3);
    });

    it('zeigt alle Fehler, auch mehr als das Limit', () => {
      const { toasts, render, items } = setup();
      ['A', 'B', 'C', 'D'].forEach((text) => toasts.error(text));
      toasts.info('Info');
      render();

      expect(items().filter((toast) => toast.classList.contains('is-error'))).toHaveLength(4);
      expect(items().some((toast) => toast.classList.contains('is-info'))).toBe(false);
    });

    it('laesst einen wartenden Toast keine Zeit verlieren', () => {
      const { toasts } = setup();
      toasts.info('wartet');
      const blockers = ['X', 'Y', 'Z'].map((text) => toasts.error(text));

      vi.advanceTimersByTime(60_000);
      expect(toasts.toasts().map((toast) => toast.message)).toContain('wartet');

      toasts.dismiss(blockers[0]);
      vi.advanceTimersByTime(5999);
      expect(toasts.toasts().map((toast) => toast.message)).toContain('wartet');
      vi.advanceTimersByTime(1);
      expect(toasts.toasts().map((toast) => toast.message)).not.toContain('wartet');
    });

    it('fasst dieselbe Meldung zusammen, statt zu stapeln, und beginnt die Zeit neu', () => {
      const { toasts, render, items } = setup();
      toasts.info('Keine Verbindung.');
      vi.advanceTimersByTime(5000);
      toasts.info('Keine Verbindung.');
      render();

      expect(items()).toHaveLength(1);
      expect(items()[0].textContent).toContain('(2×)');
      vi.advanceTimersByTime(5999);
      expect(toasts.toasts()).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(toasts.toasts()).toEqual([]);
    });

    it('fasst nicht zusammen, was sich in Art oder Detail unterscheidet', () => {
      const { toasts } = setup();
      toasts.info('Gleich');
      toasts.error('Gleich');
      toasts.info('Gleich', { detail: 'anders' });

      expect(toasts.toasts()).toHaveLength(3);
    });
  });

  it('raeumt mit clear() alles weg', () => {
    const { toasts } = setup();
    toasts.error('A');
    toasts.info('B');

    toasts.clear();
    vi.advanceTimersByTime(10_000);

    expect(toasts.toasts()).toEqual([]);
  });
});
