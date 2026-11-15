import { Component } from '@angular/core';
import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  NavigationCancel,
  NavigationEnd,
  Router,
  provideRouter,
  withRouterConfig,
} from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';

import {
  LEAVE_WITHOUT_ASKING,
  LeaveIntent,
  ROUTER_PAGE_ID_KEY,
  RouteLeave,
  routerPageId,
} from './route-leave';

@Component({ template: '' })
class Blank {}

/**
 * Gegen den **echten** Router mit `canceledNavigationResolution: 'computed'`
 * (wie in app.config.ts) und die echte History von jsdom. Bricht, sobald
 * Angular den privaten Schluessel `ɵrouterPageId` umbenennt oder entfernt.
 */
describe('RouteLeave mit echtem Router', () => {
  let leave: RouteLeave;
  let intents: Array<LeaveIntent | null>;
  let block: boolean;

  beforeEach(async () => {
    intents = [];
    block = true;
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'a', component: Blank },
            {
              path: 'b',
              component: Blank,
              canDeactivate: [
                (_page: unknown, _route: unknown, _state: unknown, next: { url: string }) => {
                  intents.push(leave.intent(next.url));
                  return !block;
                },
              ],
            },
            { path: 'login', component: Blank },
          ],
          withRouterConfig({ canceledNavigationResolution: 'computed' }),
        ),
        // Wie in app.config.ts (dort: alle Anmeldeseiten).
        { provide: LEAVE_WITHOUT_ASKING, useValue: (url: string) => url.startsWith('/login') },
      ],
    });
    leave = TestBed.runInInjectionContext(() => new RouteLeave());
    const router = TestBed.inject(Router);
    // Wie beim Bootstrap der App: der Router hoert auf popstate.
    router.setUpLocationChangeListener();
    await router.navigateByUrl('/a');
    await router.navigateByUrl('/b');
    leave.remember();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('liest die Verlaufsposition unter dem privaten Schluessel des Routers', () => {
    const location = TestBed.inject(Location);
    const state = location.getState() as Record<string, unknown>;

    // Wird der Schluessel umbenannt, faellt dieser Test zuerst.
    expect(typeof state[ROUTER_PAGE_ID_KEY]).toBe('number');
    expect(routerPageId(location)).toBe(state[ROUTER_PAGE_ID_KEY]);
  });

  it('erkennt Zurueck im Browserverlauf als Schritt −1 statt als neue Navigation', async () => {
    const router = TestBed.inject(Router);
    const location = TestBed.inject(Location);
    const done = firstValueFrom(
      router.events.pipe(filter((event) => event instanceof NavigationCancel)),
    );
    // Nach dem Abbruch geht der Router per historyGo(+1) zurueck auf /b — das
    // kommt als eigenes popstate an.
    const restored = new Promise<void>((resolve) => {
      const subscription = location.subscribe((event) => {
        if (event.url === '/b') {
          subscription.unsubscribe();
          resolve();
        }
      });
    });

    location.back();
    await done;

    expect(intents).toEqual([{ url: '/a', historyDelta: -1 }]);
    // Abgebrochen: der Router hat den Verlauf zurueckgestellt.
    await restored;
    expect(location.path()).toBe('/b');
    expect(router.url).toBe('/b');
  });

  it('fuehrt eine geparkte Zurueck-Navigation per historyGo aus', async () => {
    const router = TestBed.inject(Router);
    const location = TestBed.inject(Location);
    block = false;
    const go = vi.spyOn(location, 'historyGo');
    const arrived = firstValueFrom(
      router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)),
    );

    leave.go({ url: '/a', historyDelta: -1 });
    await arrived;

    expect(go).toHaveBeenCalledWith(-1);
    expect(router.url).toBe('/a');
  });

  it('nennt einen Link ohne Verlaufsschritt und laesst /login ohne Rueckfrage gehen', async () => {
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/a');
    expect(intents).toEqual([{ url: '/a' }]);

    expect(leave.intent('/login?next=x')).toBeNull();
  });

  it('holt eine Navigation ohne Verlaufsschritt per navigateByUrl nach', async () => {
    const router = TestBed.inject(Router);
    block = false;
    const navigate = vi.spyOn(router, 'navigateByUrl');

    leave.go({ url: '/a' });

    expect(navigate).toHaveBeenCalledWith('/a');
  });
});

describe('RouteLeave ohne LEAVE_WITHOUT_ASKING', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('kennt keine Ausnahme — auch /login fragt nach', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const leave = TestBed.runInInjectionContext(() => new RouteLeave());

    expect(leave.intent('/login')).toEqual({ url: '/login' });
  });
});

describe('routerPageId', () => {
  it('liefert null, wenn der Schluessel fehlt (Fallback: navigateByUrl)', () => {
    const location = { getState: () => ({ navigationId: 3 }) } as unknown as Location;

    expect(routerPageId(location)).toBeNull();
  });
});
