import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { NavItem, NavMenu } from './nav-menu';

@Component({ template: '' })
class Blank {}

@Component({
  imports: [NavMenu],
  template: `
    <app-nav-menu [items]="items" />
    <button type="button" id="outside">Woanders</button>
  `,
})
class Host {
  readonly items: readonly NavItem[] = [
    { path: '/week', label: 'Woche', icon: 'week' },
    { path: '/projects', label: 'Projekte', icon: 'projects' },
    { path: '/reports', label: 'Reports', icon: 'reports' },
  ];
}

interface Harness {
  fixture: ComponentFixture<Host>;
  trigger: HTMLButtonElement;
  list: HTMLUListElement;
  links: HTMLAnchorElement[];
  host: HTMLElement;
  outside: HTMLButtonElement;
  key(target: HTMLElement, key: string): Promise<void>;
  settle(): Promise<void>;
}

async function setup(): Promise<Harness> {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      provideRouter([
        { path: 'week', component: Blank },
        { path: 'projects', component: Blank },
        { path: 'reports', component: Blank },
      ]),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  // Fokus funktioniert in jsdom nur an Elementen im Dokument.
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  await fixture.whenStable();

  const element: HTMLElement = fixture.nativeElement;
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  return {
    fixture,
    host: element.querySelector('app-nav-menu')!,
    trigger: element.querySelector('.fab-trigger')!,
    list: element.querySelector('ul')!,
    links: [...element.querySelectorAll<HTMLAnchorElement>('nav a')],
    outside: element.querySelector('#outside')!,
    settle,
    async key(target: HTMLElement, key: string): Promise<void> {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await settle();
    },
  };
}

/** Ein echter Mausklick hat `detail >= 1`; `click()` in jsdom hat 0. */
function mouseClick(target: HTMLElement): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
}

function pointer(type: string, target: Element, pointerType = 'mouse'): void {
  const event = new MouseEvent(type, { bubbles: type === 'pointerdown', cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
}

describe('NavMenu', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('ist zu: Ausloeser beschriftet, Ziele inert', async () => {
    const { trigger, list } = await setup();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-label')).toBe('Navigation öffnen');
    expect(trigger.getAttribute('aria-controls')).toBe(list.id);
    expect(list.hasAttribute('inert')).toBe(true);
  });

  it('heftet sich per Mausklick an und schliesst beim zweiten Klick', async () => {
    const { trigger, list, settle } = await setup();

    mouseClick(trigger);
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-label')).toBe('Navigation schließen');
    expect(list.hasAttribute('inert')).toBe(false);

    mouseClick(trigger);
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(list.hasAttribute('inert')).toBe(true);
  });

  it.each(['Enter', ' '])('oeffnet mit %j und setzt den Fokus auf das erste Ziel', async (key) => {
    const { trigger, links, key: press } = await setup();
    trigger.focus();

    await press(trigger, key);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(links[0]);
  });

  it.each(['Enter', ' '])(
    'unterdrueckt bei %j den Standard, damit der Browser keinen Folge-Klick schickt',
    async (key) => {
      const { trigger, settle } = await setup();
      trigger.focus();

      // Echtes Browserverhalten: nach `preventDefault()` im keydown kommt
      // kein `click` mehr. Der Test schickt deshalb auch keinen hinterher.
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      trigger.dispatchEvent(event);
      await settle();

      expect(event.defaultPrevented).toBe(true);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    },
  );

  it('nimmt nach Tastatur-Oeffnen und Esc den naechsten echten Mausklick an', async () => {
    const { trigger, links, key, settle } = await setup();
    trigger.focus();
    await key(trigger, 'Enter'); // kein keyup auf dem Ausloeser: Fokus ist im Menue
    await key(links[0], 'Escape');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    mouseClick(trigger);
    await settle();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('spannt die Hover-Bruecke nur im Hover-Modus, nicht angeheftet', async () => {
    vi.useFakeTimers();
    const { host, trigger, settle } = await setup();

    pointer('pointerenter', host);
    vi.advanceTimersByTime(80);
    await settle();
    expect(host.classList.contains('is-hover')).toBe(true);

    mouseClick(trigger); // heftet an
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(host.classList.contains('is-hover')).toBe(false);
  });

  it('legt den Ausloeser in die Landmarke Hauptnavigation', async () => {
    const { trigger } = await setup();

    expect(trigger.closest('nav')?.getAttribute('aria-label')).toBe('Hauptnavigation');
  });

  it('oeffnet bei einem Klick ohne Zeiger (Screenreader) und fokussiert das erste Ziel', async () => {
    const { trigger, links, settle } = await setup();

    trigger.click();
    await settle();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(links[0]);
  });

  it('wandert mit den Pfeiltasten im Kreis, Home und End springen ans Ende', async () => {
    const { trigger, links, key } = await setup();
    trigger.focus();
    await key(trigger, 'Enter');

    await key(links[0], 'ArrowDown');
    expect(document.activeElement).toBe(links[1]);
    await key(links[1], 'ArrowRight');
    expect(document.activeElement).toBe(links[2]);
    await key(links[2], 'ArrowDown');
    expect(document.activeElement).toBe(links[0]);
    await key(links[0], 'ArrowUp');
    expect(document.activeElement).toBe(links[2]);
    await key(links[2], 'ArrowLeft');
    expect(document.activeElement).toBe(links[1]);
    await key(links[1], 'Home');
    expect(document.activeElement).toBe(links[0]);
    await key(links[0], 'End');
    expect(document.activeElement).toBe(links[2]);
  });

  it('schliesst mit Esc und gibt den Fokus an den Ausloeser zurueck', async () => {
    const { trigger, links, list, key } = await setup();
    trigger.focus();
    await key(trigger, 'Enter');
    await key(links[0], 'ArrowDown');

    await key(links[1], 'Escape');

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    // Sofort inert, nicht erst nach der Schliess-Animation.
    expect(list.hasAttribute('inert')).toBe(true);
  });

  it('schliesst, wenn der Fokus das Menue verlaesst (Tab heraus)', async () => {
    const { trigger, links, outside, key, settle } = await setup();
    trigger.focus();
    await key(trigger, 'Enter');

    links[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    await settle();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('bleibt offen, solange der Fokus zwischen den Zielen wandert', async () => {
    const { trigger, links, key, settle } = await setup();
    trigger.focus();
    await key(trigger, 'Enter');

    links[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: links[1] }));
    await settle();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('schliesst bei einem Klick ausserhalb', async () => {
    const { trigger, outside, settle } = await setup();
    mouseClick(trigger);
    await settle();

    pointer('pointerdown', outside);
    await settle();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('schliesst auch, wenn das Ziel des Klicks die Weitergabe stoppt (Block im Raster)', async () => {
    const { trigger, outside, settle } = await setup();
    // Wie der Block im Wochenraster: pointerdown startet eine Geste und
    // laesst das Ereignis nicht bis zum document durch.
    outside.addEventListener('pointerdown', (event) => event.stopPropagation());
    mouseClick(trigger);
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    pointer('pointerdown', outside);
    await settle();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('oeffnet nach Tastatur-Oeffnen und Esc beim naechsten Klick ohne Zeiger', async () => {
    const { trigger, links, key, settle } = await setup();
    trigger.focus();
    await key(trigger, 'Enter'); // kein Folge-Klick im Browser
    await key(links[0], 'Escape');

    trigger.click(); // Screenreader-Klick (detail 0)
    await settle();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('schliesst angeheftet mit Enter', async () => {
    const { trigger, key, settle } = await setup();
    mouseClick(trigger);
    await settle();
    trigger.focus();

    await key(trigger, 'Enter');

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('oeffnet nach Enter auf dem angehefteten Ausloeser beim naechsten Screenreader-Klick', async () => {
    const { trigger, links, key, settle } = await setup();
    mouseClick(trigger);
    await settle();
    trigger.focus();
    await key(trigger, 'Enter'); // schliesst; der Browser schickt keinen Klick

    trigger.click(); // Screenreader-Klick (detail 0) — darf nicht verschluckt werden
    await settle();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(links[0]);
  });

  it('oeffnet bei Hover nach kurzem Verweilen und schliesst nach dem Verlassen', async () => {
    vi.useFakeTimers();
    const { host, trigger, settle } = await setup();

    pointer('pointerenter', host);
    vi.advanceTimersByTime(79);
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    vi.advanceTimersByTime(1);
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    pointer('pointerleave', host);
    vi.advanceTimersByTime(399);
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    vi.advanceTimersByTime(1);
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('reagiert bei Touch nicht auf Hover', async () => {
    vi.useFakeTimers();
    const { host, trigger, settle } = await setup();

    pointer('pointerenter', host, 'touch');
    vi.advanceTimersByTime(500);
    await settle();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('markiert den aktuellen Bereich mit aria-current und als Text', async () => {
    const { fixture, links, settle } = await setup();

    await TestBed.inject(Router).navigateByUrl('/projects');
    await settle();

    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, 'page', null]);
    expect(links[1].textContent).toContain('· aktuell');
    expect(links[0].textContent).not.toContain('aktuell');
    expect(fixture).toBeTruthy();
  });

  it('schliesst nach der Wahl eines Ziels und laesst den Fokus nicht im inerten Menue', async () => {
    const { trigger, links, key, settle } = await setup();
    trigger.focus();
    await key(trigger, 'Enter');

    links[2].click();
    await settle();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });
});
