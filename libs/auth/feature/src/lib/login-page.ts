import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';

import { SessionStore } from '@lib/auth/data-access';
import { AuthCard } from '@lib/auth/ui';
import { Icon } from '@lib/shared/ui';

/**
 * Anmeldung mit Apple. Ein Knopf, kein Formular: Konto, Passwort und zweiter
 * Faktor liegen bei Apple. Neue Konten kommen genauso herein und geben danach
 * ihren Einladungscode ein (`/register`).
 *
 * Der Knopf folgt den Vorgaben von Apple fuer „Sign in with Apple" (schwarz mit
 * weissem Logo, im Dunkelmodus umgekehrt); seine Farben stehen deshalb als
 * eigene Tokens im Theme und nicht in der Dailyfi-Palette.
 */
@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthCard, Icon],
  styleUrl: './auth-form.scss',
  template: `
    <app-auth-card heading="Anmelden" lead="Mit deiner Apple-ID — ohne eigenes Passwort.">
      <!-- Steht dauerhaft im Dokument und wird nur befüllt: eine Live-Region,
           die erst zusammen mit ihrem Text entsteht, sagen Screenreader nicht
           an. -->
      <p class="sr-only" role="status">{{ liveMessage() }}</p>

      @if (errorMessage(); as message) {
        <p class="form-error" role="alert"><app-icon name="warn" /> {{ message }}</p>
      }

      <div class="actions">
        <button
          class="btn btn-apple"
          type="button"
          [attr.aria-disabled]="pending() || null"
          (click)="onApple()"
        >
          <svg class="apple-logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
            />
          </svg>
          {{ pending() ? 'Weiter zu Apple …' : 'Mit Apple anmelden' }}
        </button>
      </div>

      <p class="footer">
        Neu bei Dailyfi? Melde dich genauso an — danach gibst du deinen Einladungscode ein.
      </p>
      <p class="hint">
        Bisher per Mail-Link angemeldet? Wähle bei Apple „E-Mail-Adresse teilen“ mit derselben
        Adresse, dann bleibt dein Konto mit allen Daten erhalten.
      </p>
    </app-auth-card>
  `,
})
export class LoginPage {
  private readonly session = inject(SessionStore);

  protected readonly pending = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  /** Text der dauerhaften Live-Region. */
  protected readonly liveMessage = signal('');

  constructor() {
    // Zurueck von Apple holt Safari die Seite aus dem Back/Forward-Cache —
    // mit dem alten Zustand. Der Knopf stuende dann gesperrt da.
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        this.pending.set(false);
        this.liveMessage.set('');
      }
    };
    globalThis.addEventListener('pageshow', onPageShow);
    inject(DestroyRef).onDestroy(() => globalThis.removeEventListener('pageshow', onPageShow));
  }

  protected async onApple(): Promise<void> {
    if (this.pending()) {
      return;
    }

    this.pending.set(true);
    this.errorMessage.set(null);
    this.liveMessage.set('Weiterleitung zu Apple …');

    const outcome = await this.session.signInWithApple();

    // Bei Erfolg verlaesst der Browser gleich die Seite; der Knopf bleibt so
    // lange gesperrt, damit ein zweiter Klick keinen zweiten Start ausloest.
    // Gesperrt per `aria-disabled`, nicht `disabled`: so bleibt der Fokus auf
    // dem Knopf, falls der Start scheitert.
    if (outcome === 'failed') {
      this.pending.set(false);
      this.liveMessage.set('');
      this.errorMessage.set(
        'Die Anmeldung mit Apple ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.',
      );
    }
  }
}
