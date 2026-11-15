import { Location } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';
import { CanDeactivateFn, Router } from '@angular/router';

/** Was der Guard von einer Seite braucht — ohne sie zu importieren (lazy bleibt lazy). */
export interface LeavesWithUnsavedCheck {
  canLeave(url: string): boolean;
}

/**
 * Verlassen einer Seite mit ungespeicherten Eingaben: nicht still verwerfen und
 * kein Modal. Die Navigation wird abgebrochen, die Seite zeigt ihren Hinweis
 * „Ungespeicherte Änderungen" mit „Speichern"/„Verwerfen", und beides fuehrt
 * die Navigation danach aus (`canLeave` der Seite, siehe `RouteLeave`).
 */
export const unsavedChangesGuard: CanDeactivateFn<LeavesWithUnsavedCheck> = (
  page,
  _route,
  _state,
  next,
) => page.canLeave(next.url);

/**
 * Ziele, die ohne Rueckfrage gehen duerfen (`url` mit Query/Fragment). Die App
 * stellt das bereit — sie weiss, welche Seiten es ohne Sitzung gibt; die
 * Utility kennt keine Routen. Ohne Angabe: keine Ausnahme.
 */
export const LEAVE_WITHOUT_ASKING = new InjectionToken<(url: string) => boolean>(
  'LEAVE_WITHOUT_ASKING',
  { providedIn: 'root', factory: () => () => false },
);

/** Eine Navigation, die geparkt werden kann. */
export interface LeaveIntent {
  readonly url: string;
  /**
   * Kam die Navigation aus dem Browserverlauf (Zurueck/Vor): so viele Schritte
   * dorthin — statt eines neuen Verlaufseintrags.
   */
  readonly historyDelta?: number;
}

/**
 * Schluessel, unter dem der Router die Position im Browserverlauf in
 * `history.state` ablegt (`canceledNavigationResolution: 'computed'`).
 *
 * **Private Angular-API** (das `ɵ` sagt es). Es gibt keinen oeffentlichen Weg,
 * die Position zu lesen. Faellt der Schluessel weg oder wird umbenannt, liefert
 * `routerPageId` `null`, und eine geparkte Zurueck-Navigation wird nach
 * „Verwerfen" als normale Navigation (`navigateByUrl`) nachgeholt — mit einem
 * Verlaufseintrag zu viel, aber ohne dass etwas verloren geht.
 * `route-leave.spec.ts` prueft das gegen einen echten Router und bricht, sobald
 * Angular den Schluessel aendert.
 */
export const ROUTER_PAGE_ID_KEY = 'ɵrouterPageId';

/** Position dieser Seite im Browserverlauf, `null`: unbekannt. */
export function routerPageId(location: Location): number | null {
  const state = location.getState() as Record<string, unknown> | null;
  const id = state?.[ROUTER_PAGE_ID_KEY];
  return typeof id === 'number' ? id : null;
}

/**
 * Was eine Seite mit Guard braucht, um eine abgebrochene Navigation spaeter
 * richtig nachzuholen. Im Injektionskontext anlegen (Feld der Seite), in
 * `ngOnInit` `remember()` aufrufen.
 */
export class RouteLeave {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly leavesWithoutAsking = inject(LEAVE_WITHOUT_ASKING);
  /** Position dieser Seite im Browserverlauf. */
  private here: number | null = null;

  /** Die eigene Verlaufsposition merken (sobald die Seite steht). */
  remember(): void {
    this.here = routerPageId(this.location);
  }

  /**
   * Die Absicht zu einer Navigation nach `url` — oder `null`, wenn sie ohne
   * Rueckfrage gehen darf (`LEAVE_WITHOUT_ASKING`; in der App die
   * Anmeldeseiten: die erreicht man nur, wenn die Sitzung vorbei ist, und
   * speichern ginge dann ohnehin nicht mehr).
   */
  intent(url: string): LeaveIntent | null {
    if (this.leavesWithoutAsking(url)) {
      return null;
    }
    const historyDelta = this.popstateDelta();
    return historyDelta === undefined ? { url } : { url, historyDelta };
  }

  /** Eine geparkte Navigation ausfuehren. */
  go(intent: LeaveIntent): void {
    // Aus dem Browserverlauf: dorthin gehen, statt einen neuen Eintrag
    // anzulegen — sonst stuende die Seite danach doppelt im Verlauf und „Vor"
    // liefe ins Leere.
    if (intent.historyDelta) {
      this.location.historyGo(intent.historyDelta);
    } else {
      void this.router.navigateByUrl(intent.url);
    }
  }

  /**
   * Kommt die Navigation aus dem Browserverlauf, steht der Browser schon auf
   * dem Ziel. Der Router (`'computed'`) geht nach dem Abbruch genau so viele
   * Schritte zurueck; die geparkte Absicht geht sie spaeter wieder hin.
   * `undefined`: kein Verlaufsschritt (Link, Menue) oder Position unbekannt.
   */
  private popstateDelta(): number | undefined {
    if (this.router.currentNavigation()?.trigger !== 'popstate') {
      return undefined;
    }
    const target = routerPageId(this.location);
    const here = this.here;
    return target !== null && here !== null && target !== here ? target - here : undefined;
  }
}
