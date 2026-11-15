import { Component, afterNextRender } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { SessionStore } from '@lib/auth/data-access';
import { AuthRetryableFetchError } from '@supabase/supabase-js';

import { SESSION_RECOVERY, SUPABASE, fail, guarded } from '@lib/shared/data-access-supabase';
import { ShellStatus, ToastService } from '@lib/shared/ui';
import { FakeSupabase } from '@lib/shared/data-access-supabase/testing';

import { LEAVE_WITHOUT_ASKING } from '@lib/shared/util-edit';

import { App } from './app';
import { appConfig } from './app.config';
import { isAuthPath } from './auth-paths';

@Component({ template: '' })
class Blank {}

async function setup(signedIn: boolean): Promise<{
  fixture: ComponentFixture<App>;
  element: HTMLElement;
  fake: FakeSupabase;
}> {
  const fake = new FakeSupabase();
  if (signedIn) {
    fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
    fake.betaAccess = true;
  }

  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter([
        { path: 'week', component: Blank },
        { path: 'login', component: Blank },
        { path: 'register', component: Blank },
        { path: 'auth/callback', component: Blank },
      ]),
      { provide: SUPABASE, useValue: fake.asClient() },
      // Wie in app.config.ts.
      { provide: SESSION_RECOVERY, useExisting: SessionStore },
    ],
  }).compileComponents();

  // Entspricht dem App-Initializer aus app.config.ts.
  await TestBed.inject(SessionStore).restore();

  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();

  return { fixture, element: fixture.nativeElement, fake };
}

describe('App', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('zeigt ohne Session weder Menü noch Statusleiste', async () => {
    const { element } = await setup(false);

    // Die alte Kopfzeile gibt es nicht mehr; die Wortmarke steht im
    // Seitenkopf jeder Seite (siehe Auth-Karte und die Feature-Seiten).
    expect(element.querySelector('header')).toBeNull();
    expect(element.querySelector('app-nav-menu')).toBeNull();
    expect(element.querySelector('app-status-bar')).toBeNull();
  });

  it('bietet einen Sprunglink zum Hauptinhalt', async () => {
    const { element } = await setup(false);

    const skipLink: HTMLAnchorElement | null = element.querySelector('a[href="#main"]');
    expect(skipLink?.textContent).toContain('Hauptinhalt');
    expect(element.querySelector('main#main')).not.toBeNull();
  });

  it('springt per Sprunglink ohne Navigation auf den Hauptinhalt', async () => {
    const { fixture, element } = await setup(true);
    document.body.appendChild(element);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl');
    const before = router.url;

    const link = element.querySelector<HTMLAnchorElement>('a.skip-link')!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    fixture.detectChanges();

    // Kein Neuladen: der Browser folgt dem href nicht, der Router auch nicht.
    expect(click.defaultPrevented).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(router.url).toBe(before);
    // Fokus auf <main>: der naechste Tab geht in den Inhalt, nicht zurueck in
    // die Navigation davor.
    const main = element.querySelector('main')!;
    expect(document.activeElement).toBe(main);
    expect(element.querySelector('app-nav-menu')!.compareDocumentPosition(main)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    element.remove();
  });

  it('zeigt abgemeldet weder Adresse noch Abmelden-Knopf', async () => {
    const { element } = await setup(false);

    expect(element.querySelector('button')).toBeNull();
    expect(element.textContent).not.toContain('@');
    // Auch die Navigation nicht: dort steht kein Weg, den ein Gast gehen kann.
    expect(element.querySelector('nav')).toBeNull();
  });

  it('zeigt mit Session, aber ohne Freischaltung kein Menü', async () => {
    const fake = new FakeSupabase();
    fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
    fake.betaAccess = false;
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), { provide: SUPABASE, useValue: fake.asClient() }],
    }).compileComponents();
    await TestBed.inject(SessionStore).restore();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    // Jedes Ziel fuehrte per Guard zurueck auf /register.
    expect(fixture.nativeElement.querySelector('app-nav-menu')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-status-bar')).toBeNull();
  });

  it('fuehrt angemeldet ueber das Rund-Menü zu Woche, Projekten und Reports', async () => {
    const { element } = await setup(true);

    const links = [...element.querySelectorAll<HTMLAnchorElement>('app-nav-menu nav a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/week',
      '/projects',
      '/reports',
    ]);
    expect(links.map((link) => link.textContent?.trim())).toEqual(['Woche', 'Projekte', 'Reports']);
  });

  it('zeigt angemeldet in der Statusleiste, welches Konto offen ist', async () => {
    const { element } = await setup(true);

    expect(element.querySelector('app-status-bar')?.textContent).toContain('thorsten@dailyfi.test');
  });

  it('reicht, was die Seite veröffentlicht, an die Statusleiste durch', async () => {
    const { fixture, element } = await setup(true);
    const owner = {};

    TestBed.inject(ShellStatus).publish(owner, {
      sync: 'synced',
      weekNumber: 38,
      weekTotal: '12,50 h',
    });
    fixture.detectChanges();

    const text = element.querySelector('app-status-bar')!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('synchronisiert');
    expect(text).toContain('KW 38');
    expect(text).toContain('Woche 12,50 h');
  });

  it('meldet ab und geht zur Anmeldung, nicht zurueck in die Anwendung', async () => {
    const { fixture, element, fake } = await setup(true);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const signOut = [...element.querySelectorAll<HTMLButtonElement>('app-status-bar button')].find(
      (button) => button.textContent?.trim() === 'Abmelden',
    )!;
    signOut.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fake.signOutCalls).toBe(1);
    expect(navigate).toHaveBeenCalledWith(['/login']);
    expect(element.querySelector('app-status-bar')).toBeNull();
  });

  describe('Sitzung abgelaufen', () => {
    function modal(element: HTMLElement): HTMLDialogElement | null {
      return element.querySelector('app-session-expired-dialog dialog');
    }

    async function settle(fixture: ComponentFixture<App>): Promise<void> {
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('erscheint, wenn die Sitzung unfreiwillig endet (SIGNED_OUT nach Refresh-Fehler)', async () => {
      const { fixture, element, fake } = await setup(true);
      await TestBed.inject(Router).navigateByUrl('/week');

      fake.emitAuthEvent('SIGNED_OUT', null);
      await settle(fixture);

      expect(modal(element)?.hasAttribute('open')).toBe(true);
      expect(modal(element)?.textContent).toContain('Sitzung abgelaufen');
      // Kein Schliessen-X, kein Abbrechen: nur der Weg zur Anmeldung.
      expect(
        [...modal(element)!.querySelectorAll('button')].map((b) => b.textContent?.trim()),
      ).toEqual(['Neu anmelden']);
    });

    it('erscheint bei einem Repository-Fehler „JWT abgelaufen", wenn kein Refresh hilft', async () => {
      const { fixture, element, fake } = await setup(true);
      await TestBed.inject(Router).navigateByUrl('/week');
      fake.refreshError = { message: 'Invalid Refresh Token', status: 400 };

      expect(() => fail({ message: 'JWT expired', code: 'PGRST301' })).toThrow();
      await settle(fixture);

      expect(fake.refreshCalls).toBe(1);
      expect(modal(element)?.hasAttribute('open')).toBe(true);
    });

    it('erscheint nicht, wenn der Refresh das Token erneuern kann', async () => {
      const { fixture, element, fake } = await setup(true);
      await TestBed.inject(Router).navigateByUrl('/week');

      expect(() => fail({ message: 'JWT expired', code: 'PGRST301' })).toThrow();
      await settle(fixture);

      expect(fake.refreshCalls).toBe(1);
      expect(modal(element)).toBeNull();
    });

    it('ist ein alertdialog mit Erstfokus auf „Neu anmelden"', async () => {
      const { fixture, element, fake } = await setup(true);
      await TestBed.inject(Router).navigateByUrl('/week');

      fake.emitAuthEvent('SIGNED_OUT', null);
      await settle(fixture);

      expect(modal(element)?.getAttribute('role')).toBe('alertdialog');
      expect(modal(element)?.querySelector('input')).toBeNull();
      expect(document.activeElement?.textContent?.trim()).toBe('Neu anmelden');
    });

    it('erscheint, wenn ein Zugriff mit 401 scheitert und kein Refresh hilft — ohne Wiederholung', async () => {
      const { fixture, element, fake } = await setup(true);
      await TestBed.inject(Router).navigateByUrl('/week');
      fake.refreshError = { message: 'Invalid Refresh Token', status: 400 };
      let attempts = 0;

      await expect(
        guarded(async () => {
          attempts += 1;
          return fail({ message: 'JWT expired', code: 'PGRST301' });
        }, TestBed.inject(SESSION_RECOVERY)),
      ).rejects.toMatchObject({ code: 'session-expired' });
      await settle(fixture);

      expect(attempts).toBe(1);
      expect(fake.refreshCalls).toBe(1);
      expect(modal(element)?.hasAttribute('open')).toBe(true);
    });

    it('wiederholt einen Zugriff nach erfolgreichem Refresh einmal, ohne Modal', async () => {
      const { fixture, element, fake } = await setup(true);
      await TestBed.inject(Router).navigateByUrl('/week');
      let attempts = 0;

      const result = await guarded(async () => {
        attempts += 1;
        return attempts === 1 ? fail({ message: 'JWT expired', code: 'PGRST301' }) : 'gespeichert';
      }, TestBed.inject(SESSION_RECOVERY));
      await settle(fixture);

      expect(result).toBe('gespeichert');
      expect(attempts).toBe(2);
      expect(fake.refreshCalls).toBe(1);
      expect(modal(element)).toBeNull();
    });

    it('erscheint nicht, wenn der Refresh nur am Netz scheitert', async () => {
      const { fixture, element, fake } = await setup(true);
      await TestBed.inject(Router).navigateByUrl('/week');
      fake.refreshError = new AuthRetryableFetchError('Failed to fetch', 0);

      await expect(
        guarded(
          async () => fail({ message: 'JWT expired', code: 'PGRST301' }),
          TestBed.inject(SESSION_RECOVERY),
        ),
      ).rejects.toMatchObject({ code: 'offline' });
      await settle(fixture);

      expect(modal(element)).toBeNull();
      expect(TestBed.inject(SessionStore).user()).not.toBeNull();
    });

    it('erscheint nicht bei einem RLS-Verbot (angemeldet, aber nicht erlaubt)', async () => {
      const { fixture, element, fake } = await setup(true);
      await TestBed.inject(Router).navigateByUrl('/week');

      expect(() => fail({ message: 'row-level security', code: '42501' })).toThrow();
      await settle(fixture);

      expect(fake.refreshCalls).toBe(0);
      expect(modal(element)).toBeNull();
    });

    it('erscheint nicht beim normalen Abmelden', async () => {
      const { fixture, element } = await setup(true);
      await TestBed.inject(Router).navigateByUrl('/week');

      const signOut = [
        ...element.querySelectorAll<HTMLButtonElement>('app-status-bar button'),
      ].find((button) => button.textContent?.trim() === 'Abmelden')!;
      signOut.click();
      await settle(fixture);
      await settle(fixture);

      expect(TestBed.inject(Router).url).toBe('/login');
      expect(modal(element)).toBeNull();
    });

    it('erscheint nicht beim ersten Laden ohne Session', async () => {
      const { fixture, element } = await setup(false);
      await TestBed.inject(Router).navigateByUrl('/week');
      await settle(fixture);

      expect(modal(element)).toBeNull();
    });

    it.each(['/login', '/register', '/auth/callback?code=abc'])(
      'erscheint nicht auf %s',
      async (url) => {
        const { fixture, element, fake } = await setup(true);
        await TestBed.inject(Router).navigateByUrl(url);

        fake.emitAuthEvent('SIGNED_OUT', null);
        await settle(fixture);

        expect(modal(element)).toBeNull();
      },
    );

    it('meldet bei „Neu anmelden" lokal ab und geht ohne Ruecksprung nach /login', async () => {
      const { fixture, element, fake } = await setup(true);
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/week');
      TestBed.inject(ToastService).error('Die Änderung konnte nicht gespeichert werden.');
      fake.emitAuthEvent('SIGNED_OUT', null);
      await settle(fixture);
      const navigate = vi.spyOn(router, 'navigate');

      modal(element)!.querySelector('button')!.click();
      await settle(fixture);
      await settle(fixture);

      expect(fake.signOutScopes).toEqual(['local']);
      expect(navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
      expect(router.url).toBe('/login');
      expect(modal(element)).toBeNull();
      // Meldungen der alten Sitzung bleiben nicht stehen.
      expect(TestBed.inject(ToastService).toasts()).toEqual([]);
    });
  });

  it('haelt die Live-Regionen der Toasts von Anfang an bereit, auch ohne Session', async () => {
    const { element } = await setup(false);

    expect(element.querySelector('app-toast-region [role="status"]')).not.toBeNull();
    expect(element.querySelector('app-toast-region [role="alert"]')).not.toBeNull();
  });
});

@Component({ template: '<h1 tabindex="-1">Woche</h1><button type="button">Im Inhalt</button>' })
class WeekLike {}

@Component({ template: '<h1>Projekte</h1>' })
class HeadingWithoutTabindex {}

@Component({ template: '<p>Ohne Ueberschrift</p>' })
class NoHeading {}

@Component({ template: '<h1 tabindex="-1">Selbst</h1><input aria-label="Feld" />' })
class FocusesItself {
  constructor() {
    afterNextRender(() =>
      (document.querySelector('input[aria-label="Feld"]') as HTMLInputElement).focus(),
    );
  }
}

describe('App: Fokus nach Seitenwechsel', () => {
  async function shell(): Promise<{ fixture: ComponentFixture<App>; router: Router }> {
    const fake = new FakeSupabase();
    fake.user = { id: 'u1', email: 'thorsten@dailyfi.test' };
    fake.betaAccess = true;
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([
          { path: 'week', component: WeekLike },
          { path: 'projects', component: HeadingWithoutTabindex },
          { path: 'reports', component: NoHeading },
          { path: 'self', component: FocusesItself },
        ]),
        { provide: SUPABASE, useValue: fake.asClient() },
        { provide: SESSION_RECOVERY, useExisting: SessionStore },
      ],
    }).compileComponents();
    await TestBed.inject(SessionStore).restore();
    const fixture = TestBed.createComponent(App);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return { fixture, router: TestBed.inject(Router) };
  }

  async function go(fixture: ComponentFixture<App>, router: Router, url: string): Promise<void> {
    await router.navigateByUrl(url);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  });

  it('laesst den Fokus beim ersten Laden, wo er ist', async () => {
    const { fixture, router } = await shell();

    await go(fixture, router, '/week');

    expect(document.activeElement).toBe(document.body);
  });

  it('setzt ihn nach einem Wechsel auf die h1 der neuen Seite', async () => {
    const { fixture, router } = await shell();
    await go(fixture, router, '/week');
    // Wie nach einem Klick im Rund-Menue: der Fokus steht im Menue.
    fixture.nativeElement.querySelector('app-nav-menu button')?.focus();

    await go(fixture, router, '/projects');

    const heading = fixture.nativeElement.querySelector('main h1') as HTMLElement;
    expect(heading.textContent).toBe('Projekte');
    expect(document.activeElement).toBe(heading);
    // Ohne tabindex liesse sich die Ueberschrift gar nicht fokussieren.
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('faellt ohne h1 auf main zurueck', async () => {
    const { fixture, router } = await shell();
    await go(fixture, router, '/week');

    await go(fixture, router, '/reports');

    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('main'));
  });

  it('bewegt ihn nicht, wenn sich nur Query oder Fragment aendern', async () => {
    const { fixture, router } = await shell();
    await go(fixture, router, '/week');
    const inside = fixture.nativeElement.querySelector('main button') as HTMLElement;
    inside.focus();

    await go(fixture, router, '/week?woche=2026-09-14');
    await go(fixture, router, '/week#raster');

    expect(document.activeElement).toBe(inside);
  });

  it('ueberschreibt keinen Fokus, den die neue Seite selbst gesetzt hat', async () => {
    const { fixture, router } = await shell();
    await go(fixture, router, '/week');

    await go(fixture, router, '/self');

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Feld');
  });
});

describe('Anmeldeseiten als eine Quelle', () => {
  it('erkennt die Anmeldeseiten, auch mit Query, Fragment und Unterpfad', () => {
    for (const url of ['/login', '/login?next=%2Fweek', '/register#x', '/auth/callback?code=abc']) {
      expect(isAuthPath(url), url).toBe(true);
    }
    for (const url of ['/week', '/projects', '/loginx', '/']) {
      expect(isAuthPath(url), url).toBe(false);
    }
  });

  it('gibt sie der Utility als Ausnahme fuer ungespeicherte Aenderungen', () => {
    const provider = appConfig.providers.find(
      (candidate): candidate is { provide: unknown; useValue: unknown } =>
        typeof candidate === 'object' &&
        candidate !== null &&
        'provide' in candidate &&
        candidate.provide === LEAVE_WITHOUT_ASKING,
    );

    expect(provider?.useValue).toBe(isAuthPath);
  });
});
