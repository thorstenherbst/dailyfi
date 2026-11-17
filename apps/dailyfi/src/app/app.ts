import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { SessionStore } from '@lib/auth/data-access';
import {
  NavItem,
  NavMenu,
  SessionExpiredDialog,
  ShellStatus,
  StatusBar,
  ToastRegion,
  ToastService,
} from '@lib/shared/ui';

import { isAuthPath, pathOf } from './auth-paths';

@Component({
  imports: [RouterOutlet, NavMenu, StatusBar, ToastRegion, SessionExpiredDialog],
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);

  protected readonly status = inject(ShellStatus).snapshot;

  private readonly mainRef = viewChild.required<ElementRef<HTMLElement>>('main');

  protected readonly navItems: readonly NavItem[] = [
    { path: '/week', label: 'Woche', icon: 'week' },
    { path: '/projects', label: 'Projekte', icon: 'projects' },
    { path: '/reports', label: 'Reports', icon: 'reports' },
  ];

  /**
   * Menue und Statusleiste nur fuer, wer wirklich in die Anwendung darf. Ohne
   * Freischaltung (Registrierung mit Session) fuehrte jedes Ziel per Guard
   * zurueck auf `/register` — die Seite hat dafuer ihr eigenes „Abmelden".
   * Dasselbe gilt fuer die Zustimmung zum AV-Vertrag: bis dahin fuehrt jedes
   * Ziel zurueck auf `/zustimmung`.
   */
  protected readonly shell = computed(() =>
    this.session.hasBetaAccess() && pathOf(this.url()) !== '/zustimmung'
      ? this.session.user()
      : null,
  );

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /**
   * „Sitzung abgelaufen" nur in der Anwendung: auf den Anmeldeseiten ist die
   * Session ohnehin weg, und ein Modal dort waere nur im Weg.
   */
  protected readonly sessionExpired = computed(
    () => this.session.sessionExpired() && !isAuthPath(this.url()),
  );

  constructor() {
    this.focusPageAfterNavigation();
  }

  /**
   * Nach einem Seitenwechsel landete der Fokus auf `body` (die alte Seite ist
   * weg) oder blieb im Menue — fuer Tastatur und Screenreader ein Abbruch.
   * Darum geht er auf die `h1` der neuen Seite (`tabindex="-1"`), sonst auf
   * `main`. Den Seitentitel setzt der Router selbst.
   *
   * - Nicht beim ersten Laden: da steht der Fokus ohnehin am Anfang.
   * - Nicht, wenn sich nur Query oder Fragment aendern — es ist dieselbe Seite.
   * - Nicht, wenn die neue Seite den Fokus schon selbst in `main` gesetzt hat.
   *
   * Ein sichtbarer Ring nach einem Mausklick bleibt aus, ohne eigene Logik: der
   * Browser vererbt `:focus-visible` bei programmatischem Fokus vom vorher
   * fokussierten Element (Klick → kein Ring, Tastatur → Ring).
   */
  private focusPageAfterNavigation(): void {
    let lastPath: string | null = null;
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        const path = pathOf(event.urlAfterRedirects);
        const previous = lastPath;
        lastPath = path;
        if (previous === null || previous === path) {
          return;
        }
        afterNextRender(() => this.focusPageHeading(), { injector: this.injector });
      });
  }

  private focusPageHeading(): void {
    const main = this.mainRef().nativeElement;
    const active = document.activeElement;
    if (active && active !== main && main.contains(active)) {
      return;
    }
    const heading = main.querySelector<HTMLElement>('h1');
    if (heading && !heading.hasAttribute('tabindex')) {
      heading.setAttribute('tabindex', '-1');
    }
    (heading ?? main).focus({ preventScroll: true });
  }

  /**
   * Sprunglink ohne Navigation: Route und Zustand bleiben, der Fokus landet auf
   * `main` (tabindex="-1"), der naechste Tab geht in den Inhalt. Enter auf dem
   * Link loest ebenfalls `click` aus.
   */
  protected skipToMain(event: Event): void {
    event.preventDefault();
    const main = this.mainRef().nativeElement;
    main.focus();
    main.scrollIntoView?.({ block: 'start' });
  }

  /**
   * Nach dem Abmelden fuehrt kein Weg zurueck in die Anwendung: `/login` statt
   * `/week`, sonst schoebe der Guard eine zweite Umleitung hinterher.
   */
  protected async onSignOut(): Promise<void> {
    await this.session.signOut();
    // Meldungen gehoeren zur alten Sitzung.
    this.toasts.clear();
    await this.router.navigate(['/login']);
  }

  /**
   * „Neu anmelden": lokal abmelden und ohne Ruecksprung zur Anmeldung — die
   * Seite dahinter wuerde ohne Sitzung nur noch scheitern.
   */
  protected async onRelogin(): Promise<void> {
    await this.session.endExpiredSession();
    this.toasts.clear();
    await this.router.navigate(['/login'], { replaceUrl: true });
  }
}
