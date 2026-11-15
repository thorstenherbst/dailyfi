import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { SessionStore } from '@lib/auth/data-access';
import { AuthCard } from '@lib/auth/ui';
import { Icon } from '@lib/shared/ui';

/** Grob genug, um Tippfehler zu fangen, ohne gueltige Adressen abzuweisen. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Anmeldung per Magic Link. Ein Feld, ein Knopf.
 *
 * Die Seite meldet nach dem Absenden **immer** dasselbe — bei bekannter wie bei
 * unbekannter Adresse, bei Erfolg wie bei Drosselung. Jede Unterscheidung, die
 * bis hierher durchschlüge, machte aus der Anmeldeseite ein Verzeichnis der
 * Adressen, die bei Dailyfi ein Konto haben. Die Begründung im Einzelnen steht
 * über `requestLoginLink` in `auth/data-access` (`session.ts`).
 */
@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthCard, Icon, RouterLink],
  styleUrl: './auth-form.scss',
  template: `
    <app-auth-card heading="Anmelden" [lead]="lead()">
      <!-- Steht dauerhaft im Dokument und wird nur befüllt: eine Live-Region,
           die erst zusammen mit ihrem Text entsteht, sagen Screenreader nicht
           an. -->
      <p class="sr-only" role="status">{{ liveMessage() }}</p>

      @if (sentTo(); as address) {
        <div class="sent">
          <!-- Der Absenden-Knopf verschwindet mit dem Formular; ohne diesen
               Sprung fiele der Tastaturfokus auf den Dokumentkörper. -->
          <div class="sent-head">
            <app-icon name="ok" />
            <h2 class="sent-title" tabindex="-1" #sentHeading>Mail ist unterwegs</h2>
          </div>
          <p>
            Wenn es zu <strong>{{ address }}</strong> ein Konto gibt, ist ein Anmeldelink unterwegs.
            Öffne ihn in diesem Browser.
          </p>
          <p class="hint">
            Keine Mail bekommen? Sieh im Spam-Ordner nach oder fordere den Link in ein paar Minuten
            erneut an.
          </p>
          <div class="actions">
            <button class="btn btn-secondary" type="button" (click)="reset()">
              Andere Adresse verwenden
            </button>
          </div>
        </div>
      } @else {
        <!-- novalidate: die Fehlermeldung gehört als Text ins Formular und
             nicht in eine flüchtige Browser-Blase. -->
        <form novalidate (submit)="onSubmit($event)">
          <div class="field">
            <label class="label" for="login-email">E-Mail-Adresse</label>
            <input
              class="input"
              id="login-email"
              type="email"
              name="email"
              autocomplete="email"
              required
              [attr.aria-invalid]="errorMessage() ? 'true' : null"
              [attr.aria-describedby]="errorMessage() ? 'login-email-error' : null"
              [value]="email()"
              (input)="email.set(read($event))"
            />
          </div>

          @if (errorMessage(); as message) {
            <p class="form-error" id="login-email-error" role="alert">
              <app-icon name="warn" /> {{ message }}
            </p>
          }

          <div class="actions">
            <button class="btn btn-primary" type="submit" [disabled]="pending()">
              <app-icon name="mail" />
              {{ pending() ? 'Wird gesendet …' : 'Anmeldelink anfordern' }}
            </button>
          </div>
        </form>

        <p class="footer">
          Noch kein Konto? <a routerLink="/register">Mit Einladungscode registrieren</a>
        </p>
      }
    </app-auth-card>
  `,
})
export class LoginPage {
  private readonly session = inject(SessionStore);
  private readonly sentHeading = viewChild<ElementRef<HTMLElement>>('sentHeading');

  protected readonly email = signal('');
  protected readonly pending = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  /** Nicht `null` heisst: abgeschickt, die Karte zeigt die Bestätigung. */
  protected readonly sentTo = signal<string | null>(null);
  /** Text der dauerhaften Live-Region. */
  protected readonly liveMessage = signal('');

  constructor() {
    effect(() => {
      this.sentHeading()?.nativeElement.focus();
    });
  }

  protected lead(): string | null {
    return this.sentTo() ? null : 'Wir schicken dir einen Link zum Anmelden — kein Passwort.';
  }

  protected read(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected reset(): void {
    this.sentTo.set(null);
    this.errorMessage.set(null);
    this.liveMessage.set('');
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.pending()) {
      return;
    }

    const address = this.email().trim();
    if (!EMAIL.test(address)) {
      this.errorMessage.set('Bitte eine gültige E-Mail-Adresse eingeben.');
      return;
    }

    this.pending.set(true);
    this.errorMessage.set(null);
    try {
      await this.session.requestLoginLink(address);
      this.sentTo.set(address);
      this.liveMessage.set(`Anmeldelink für ${address} angefordert. Sieh in deinem Postfach nach.`);
    } finally {
      this.pending.set(false);
    }
  }
}
