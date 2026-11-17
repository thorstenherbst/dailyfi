import { Component, Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  DPA_VERSION,
  DPA_VERSION_DATE,
  PRIVACY_POLICY_DATE,
  PROVIDER,
  formatLegalDate,
} from '@lib/legal/domain';

import { DpaPage } from './dpa-page';
import { ImprintPage } from './imprint-page';
import { PrivacyPage } from './privacy-page';
import { ProviderField } from './provider-field';

async function render(page: Type<unknown>): Promise<HTMLElement> {
  await TestBed.configureTestingModule({
    imports: [page],
    providers: [provideRouter([])],
  }).compileComponents();
  const fixture = TestBed.createComponent(page);
  fixture.detectChanges();
  return fixture.nativeElement;
}

@Component({ template: '' })
class Blank {}

const PAGES: readonly [string, Type<unknown>, string][] = [
  ['Impressum', ImprintPage, 'Impressum'],
  ['Datenschutz', PrivacyPage, 'Datenschutzerklärung'],
  ['AV-Vertrag', DpaPage, 'Vertrag zur Auftragsverarbeitung'],
];

describe('Rechtstexte', () => {
  describe.each(PAGES)('%s', (_name, page, heading) => {
    it('hat genau eine h1 und darunter h2-Abschnitte', async () => {
      const element = await render(page);

      const headings = element.querySelectorAll('h1');
      expect(headings).toHaveLength(1);
      expect(headings[0].textContent?.trim()).toBe(heading);
      expect(element.querySelectorAll('article.prose h2').length).toBeGreaterThan(1);
    });

    it('zeigt Wortmarke und den Weg zurueck', async () => {
      const element = await render(page);

      expect(element.querySelector('.pagehead .wordmark')).not.toBeNull();
      expect(element.querySelector('.pagehead a[href="/"]')?.textContent).toContain('Zurück');
    });

    it('verlinkt im Fuss alle drei Rechtstexte', async () => {
      const element = await render(page);

      const links = [...element.querySelectorAll<HTMLAnchorElement>('footer nav a')];
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '/impressum',
        '/datenschutz',
        '/avv',
      ]);
    });

    it('hebt die Angaben zum Anbieter als Platzhalter hervor', async () => {
      const element = await render(page);

      const marks = [...element.querySelectorAll('mark.placeholder')].map((mark) =>
        mark.textContent?.trim(),
      );
      expect(marks).toContain(PROVIDER.name);
      expect(marks).toContain(PROVIDER.email);
      // Kein Platzhalter steht ungekennzeichnet im Text.
      for (const text of marks) {
        expect(text).toMatch(/^\[\[.+\]\]$/);
      }
      const plain = [...element.querySelectorAll('article *:not(mark)')]
        .flatMap((node) => [...node.childNodes])
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '');
      expect(plain.join(' ')).not.toContain('[[');
    });
  });

  it('nennt im Impressum alle Pflichtangaben und keinen Link zur OS-Plattform', async () => {
    const element = await render(ImprintPage);

    const marks = [...element.querySelectorAll('mark.placeholder')].map((m) => m.textContent);
    for (const value of [PROVIDER.street, PROVIDER.city, PROVIDER.vatId]) {
      expect(marks).toContain(value);
    }
    expect(element.textContent).toContain('§ 5 DDG');
    expect(element.textContent).toContain('Verbraucherschlichtungsstelle');
    expect(element.querySelector('a[href*="ec.europa.eu"]')).toBeNull();
  });

  it('zeigt im AV-Vertrag die Version aus der Konstante', async () => {
    const element = await render(DpaPage);

    expect(element.querySelector('.prose-meta')?.textContent?.trim()).toBe(
      `Version ${DPA_VERSION} vom ${formatLegalDate(DPA_VERSION_DATE)}`,
    );
  });

  it('nennt in der Datenschutzerklaerung den Stand', async () => {
    const element = await render(PrivacyPage);

    expect(element.querySelector('.prose-meta')?.textContent).toContain(
      formatLegalDate(PRIVACY_POLICY_DATE),
    );
    expect(element.textContent).toContain('Supabase Pte. Ltd.');
    expect(element.textContent).toContain('Vercel Inc.');
    expect(element.textContent).toContain('§ 25 Abs. 2 Nr. 2 TDDDG');
    expect(element.textContent).toContain('Nachweis des Vertragsschlusses');
  });
});

@Component({
  imports: [ProviderField],
  template: `<app-provider-field [value]="value()" [link]="link()" />`,
})
class FieldHost {
  readonly value = signal('[[E-Mail]]');
  readonly link = signal<'mail' | 'tel' | null>('mail');
}

describe('ProviderField', () => {
  async function setup(): Promise<{ host: FieldHost; element: HTMLElement; render: () => void }> {
    await TestBed.configureTestingModule({ imports: [FieldHost] }).compileComponents();
    const fixture = TestBed.createComponent(FieldHost);
    fixture.detectChanges();
    return {
      host: fixture.componentInstance,
      element: fixture.nativeElement,
      render: () => fixture.detectChanges(),
    };
  }

  it('verlinkt einen Platzhalter nicht', async () => {
    const { element } = await setup();

    expect(element.querySelector('mark.placeholder')?.textContent).toBe('[[E-Mail]]');
    expect(element.querySelector('a')).toBeNull();
  });

  it('zeigt eine echte Angabe ohne Hervorhebung, auf Wunsch als Link', async () => {
    const { host, element, render } = await setup();

    host.value.set('hallo@dailyfi.test');
    render();
    expect(element.querySelector('mark')).toBeNull();
    expect(element.querySelector('a')?.getAttribute('href')).toBe('mailto:hallo@dailyfi.test');

    host.value.set('+49 30 123 45');
    host.link.set('tel');
    render();
    expect(element.querySelector('a')?.getAttribute('href')).toBe('tel:+493012345');

    host.link.set(null);
    render();
    expect(element.querySelector('a')).toBeNull();
    expect(element.textContent?.trim()).toBe('+49 30 123 45');
  });
});

describe('Rechtstexte: aktuelle Seite', () => {
  it('markiert die aktuelle Seite im Fuss mit aria-current', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'datenschutz', component: PrivacyPage },
          { path: '**', component: Blank },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/datenschutz');

    const links = [
      ...harness.routeNativeElement!.querySelectorAll<HTMLAnchorElement>('footer nav a'),
    ];
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, 'page', null]);
  });
});
