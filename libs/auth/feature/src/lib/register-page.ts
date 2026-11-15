import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { SessionStore } from '@lib/auth/data-access';
import { forgetInviteCode, readInviteCode, rememberInviteCode } from '@lib/auth/domain';
import { AuthCard } from '@lib/auth/ui';
import { Icon } from '@lib/shared/ui';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Wie die Migration: 6 bis 40 Zeichen. Fängt Vertipper vor dem Serverweg ab. */
const CODE = /^.{6,40}$/;

const INVALID_CODE = 'Dieser Einladungscode gilt nicht oder wurde bereits verwendet.';
const LOCKED =
  'Zu viele Fehlversuche. Bitte in einer Viertelstunde noch einmal versuchen — oder frag nach ' +
  'einem neuen Code.';
const SERVER_ERROR = 'Der Einladungscode konnte gerade nicht geprüft werden.';

/** Warum der Rücksprung hierher geschickt hat. */
const REASONS: Record<string, string> = {
  'invalid-code': INVALID_CODE,
  locked: LOCKED,
  'server-error': `${SERVER_ERROR} Der Code steht noch im Feld — bitte noch einmal absenden.`,
};

/**
 * Registrierung zur geschlossenen Beta. Zwei Zustände, eine Seite:
 *
 * - **ohne Session:** Einladungscode und Adresse. Der Code reist mit der
 *   Anmeldeanfrage mit und wird in der Datenbank geprüft, **bevor** ein Konto
 *   entsteht (`before_user_created`). Eingelöst wird er trotzdem erst beim
 *   Rücksprung: bis zur Bestätigung per Mail kann viel passieren, und ein Code
 *   an einer nie geöffneten Mail wäre sonst verbrannt.
 * - **mit Session, ohne Freischaltung:** nur der Code. Hierher kommt, wessen
 *   Code beim Rücksprung nicht getragen hat, wer den Link in einem anderen
 *   Browser geöffnet hat — oder wen eine Serverstörung beim Einlösen erwischt
 *   hat. Im letzten Fall steht der Code noch im Feld.
 */
@Component({
  selector: 'app-register-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthCard, Icon, RouterLink],
  styleUrl: './auth-form.scss',
  template: `
    <app-auth-card [heading]="heading()" [lead]="lead()">
      <p class="sr-only" role="status">{{ liveMessage() }}</p>

      @if (sentTo(); as address) {
        <div class="sent">
          <div class="sent-head">
            <app-icon name="ok" />
            <h2 class="sent-title" tabindex="-1" #sentHeading>Mail ist unterwegs</h2>
          </div>
          <p>
            Wir haben einen Bestätigungslink an <strong>{{ address }}</strong> geschickt. Öffne ihn
            in diesem Browser — danach wird dein Einladungscode geprüft.
          </p>
          <div class="actions">
            <button class="btn btn-secondary" type="button" (click)="reset()">
              Angaben ändern
            </button>
          </div>
        </div>
      } @else {
        <form novalidate (submit)="onSubmit($event)">
          <div class="field">
            <label class="label" for="register-code">Einladungscode</label>
            <input
              class="input mono"
              id="register-code"
              type="text"
              name="invite-code"
              autocomplete="off"
              spellcheck="false"
              required
              [attr.aria-invalid]="errorMessage() ? 'true' : null"
              [attr.aria-describedby]="errorMessage() ? 'register-error' : null"
              [value]="code()"
              (input)="code.set(read($event))"
            />
          </div>

          @if (!signedIn()) {
            <div class="field">
              <label class="label" for="register-email">E-Mail-Adresse</label>
              <input
                class="input"
                id="register-email"
                type="email"
                name="email"
                autocomplete="email"
                required
                [attr.aria-invalid]="errorMessage() ? 'true' : null"
                [attr.aria-describedby]="
                  errorMessage() ? 'register-error register-email-hint' : 'register-email-hint'
                "
                [value]="email()"
                (input)="email.set(read($event))"
              />
              <p class="hint" id="register-email-hint">
                Wir prüfen den Code sofort und schicken dir dann den Bestätigungslink.
              </p>
            </div>
          }

          @if (errorMessage(); as message) {
            <p class="form-error" id="register-error" role="alert">
              <app-icon name="warn" /> {{ message }}
            </p>
          }

          <div class="actions">
            <button class="btn btn-primary" type="submit" [disabled]="pending()">
              <app-icon [name]="signedIn() ? 'check' : 'mail'" />
              {{ submitLabel() }}
            </button>
          </div>
        </form>

        @if (signedIn()) {
          <p class="footer">
            Falsches Konto?
            <button class="btn-link" type="button" (click)="onSignOut()">Abmelden</button>
          </p>
        } @else {
          <p class="footer">Schon ein Konto? <a routerLink="/login">Anmelden</a></p>
        }
      }
    </app-auth-card>
  `,
})
export class RegisterPage {
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly sentHeading = viewChild<ElementRef<HTMLElement>>('sentHeading');

  protected readonly code = signal('');
  protected readonly email = signal('');
  protected readonly pending = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly sentTo = signal<string | null>(null);
  protected readonly liveMessage = signal('');

  protected readonly signedIn = this.session.signedIn;

  protected readonly heading = computed(() =>
    this.signedIn() ? 'Einladungscode eingeben' : 'Registrieren',
  );

  constructor() {
    const reason = this.route.snapshot.queryParamMap.get('reason');

    // Der Rücksprung schickt hierher, wenn der Code nicht getragen hat. Ohne
    // diesen Hinweis stünde das Formular grundlos da.
    if (reason && REASONS[reason]) {
      this.errorMessage.set(REASONS[reason]);
    }

    // Nach einer Störung oder einer Sperre liegt der Code noch im Speicher —
    // eintragen, damit ein Klick reicht.
    if (reason === 'server-error' || reason === 'locked') {
      this.code.set(readInviteCode() ?? '');
    }

    effect(() => {
      this.sentHeading()?.nativeElement.focus();
    });
  }

  protected lead(): string | null {
    if (this.sentTo()) {
      return null;
    }
    const address = this.session.user()?.email;
    return address
      ? `Angemeldet als ${address}. Für den Zugang fehlt noch dein Einladungscode.`
      : 'Dailyfi ist eine geschlossene Beta. Du brauchst einen Einladungscode.';
  }

  protected submitLabel(): string {
    if (this.pending()) {
      return this.signedIn() ? 'Wird geprüft …' : 'Wird gesendet …';
    }
    return this.signedIn() ? 'Code einlösen' : 'Registrieren';
  }

  protected read(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected reset(): void {
    this.sentTo.set(null);
    this.errorMessage.set(null);
    this.liveMessage.set('');
    forgetInviteCode();
  }

  protected async onSignOut(): Promise<void> {
    await this.session.signOut();
    await this.router.navigate(['/login']);
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.pending()) {
      return;
    }

    const code = this.code().trim();
    const address = this.email().trim();

    // Beide Felder auf einmal prüfen: sonst nennt das leere Formular erst den
    // Code und die fehlende Adresse erst im zweiten Anlauf.
    const missing = this.complain(code, address);
    if (missing) {
      this.errorMessage.set(missing);
      return;
    }

    this.errorMessage.set(null);
    this.pending.set(true);
    try {
      await (this.signedIn() ? this.redeem(code) : this.requestLink(code, address));
    } finally {
      this.pending.set(false);
    }
  }

  /** Ein Satz für alles, was im Formular fehlt — oder `null`, wenn nichts fehlt. */
  private complain(code: string, address: string): string | null {
    const codeOk = CODE.test(code);
    const addressOk = this.signedIn() || EMAIL.test(address);

    if (codeOk && addressOk) {
      return null;
    }
    if (!codeOk && !addressOk) {
      return 'Bitte den Einladungscode und eine gültige E-Mail-Adresse eingeben.';
    }
    return codeOk
      ? 'Bitte eine gültige E-Mail-Adresse eingeben.'
      : 'Bitte den Einladungscode aus deiner Einladung eingeben.';
  }

  /** Mit Session: der Code geht sofort an die Datenbank. */
  private async redeem(code: string): Promise<void> {
    const outcome = await this.session.redeemInviteCode(code);

    if (outcome === 'invalid') {
      forgetInviteCode();
      this.errorMessage.set(INVALID_CODE);
      return;
    }
    if (outcome === 'locked') {
      this.errorMessage.set(LOCKED);
      return;
    }
    if (outcome === 'failed') {
      // Der Code bleibt liegen: die Störung sagt nichts über ihn.
      this.errorMessage.set(`${SERVER_ERROR} Bitte später noch einmal versuchen.`);
      return;
    }

    forgetInviteCode();
    await this.router.navigate(['/week']);
  }

  /** Ohne Session: Code prüfen lassen, Magic Link anfordern, Code merken. */
  private async requestLink(code: string, address: string): Promise<void> {
    const outcome = await this.session.requestSignupLink(address, code);

    if (outcome === 'invalid-code') {
      this.errorMessage.set(INVALID_CODE);
      return;
    }
    if (outcome === 'rate-limited') {
      this.errorMessage.set(
        'Es wurden gerade zu viele Mails angefordert. Bitte in einigen Minuten erneut versuchen.',
      );
      return;
    }
    if (outcome === 'failed') {
      this.errorMessage.set('Die Mail konnte nicht verschickt werden. Bitte später erneut.');
      return;
    }

    rememberInviteCode(code);
    this.sentTo.set(address);
    this.liveMessage.set(
      `Bestätigungslink für ${address} angefordert. Sieh in deinem Postfach nach.`,
    );
  }
}
