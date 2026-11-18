import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';

import { SessionStore } from '@lib/auth/data-access';
import { AuthCard, DpaConsent } from '@lib/auth/ui';
import { DPA_VERSION } from '@lib/legal/domain';
import { Icon } from '@lib/shared/ui';

/** Wie die Migration: 6 bis 40 Zeichen. Fängt Vertipper vor dem Serverweg ab. */
const CODE = /^.{6,40}$/;

const CODE_MISSING = 'Bitte den Einladungscode aus deiner Einladung eingeben.';
const INVALID_CODE = 'Dieser Einladungscode gilt nicht oder wurde bereits verwendet.';
const LOCKED =
  'Zu viele Fehlversuche. Bitte in einer Viertelstunde noch einmal versuchen — oder frag nach ' +
  'einem neuen Code.';
const SERVER_ERROR =
  'Der Einladungscode konnte gerade nicht geprüft werden. Bitte später noch einmal versuchen.';
const DPA_MISSING = 'Bitte bestätige, dass du dem AV-Vertrag zustimmst.';

/**
 * Freischaltung zur geschlossenen Beta. Hierher kommt, wer mit Apple angemeldet
 * ist, aber noch keinen Einladungscode eingelöst hat — beim ersten Mal also
 * jedes neue Konto.
 *
 * Der Code geht sofort an die Datenbank (`redeem_invite_code()`). Die
 * Zustimmung zum AV-Vertrag ist Pflicht und wird gleich danach gespeichert;
 * scheitert das, fängt `requireDpa` es ab und schickt auf die Zustimmungsseite.
 */
@Component({
  selector: 'app-register-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthCard, DpaConsent, Icon],
  styleUrl: './auth-form.scss',
  template: `
    <app-auth-card heading="Einladungscode eingeben" [lead]="lead()">
      <!-- novalidate: die Fehlermeldung gehört als Text ins Formular und
           nicht in eine flüchtige Browser-Blase. -->
      <form novalidate (submit)="onSubmit($event)">
        <div class="field">
          <label class="label" for="register-code">Einladungscode</label>
          <input
            class="input mono"
            id="register-code"
            #codeInput
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

        <app-dpa-consent
          inputId="register-dpa"
          [accepted]="dpaAccepted()"
          (acceptedChange)="onDpaChange($event)"
          [error]="dpaError()"
        />

        @if (errorMessage(); as message) {
          <p class="form-error" id="register-error" role="alert">
            <app-icon name="warn" /> {{ message }}
          </p>
        }

        <div class="actions">
          <button class="btn btn-primary" type="submit" [disabled]="pending()">
            <app-icon name="check" />
            {{ pending() ? 'Wird geprüft …' : 'Code einlösen' }}
          </button>
        </div>
      </form>

      <p class="footer">
        Falsches Konto?
        <button class="btn-link" type="button" (click)="onSignOut()">Abmelden</button>
      </p>
    </app-auth-card>
  `,
})
export class RegisterPage {
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly dpaConsent = viewChild(DpaConsent);
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');

  protected readonly code = signal('');
  protected readonly pending = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly dpaAccepted = signal(false);
  protected readonly dpaError = signal<string | null>(null);

  protected lead(): string {
    const address = this.session.user()?.email;
    const who = address ? `Angemeldet als ${address}. ` : '';
    return `${who}Dailyfi ist eine geschlossene Beta — für den Zugang fehlt noch dein Einladungscode.`;
  }

  protected read(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** Mit dem Haken ist der Fehler am Feld erledigt. */
  protected onDpaChange(accepted: boolean): void {
    this.dpaAccepted.set(accepted);
    if (accepted) {
      this.dpaError.set(null);
    }
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

    // Beides auf einmal prüfen: sonst nennt das leere Formular erst das eine
    // und das andere erst im zweiten Anlauf.
    this.errorMessage.set(CODE.test(code) ? null : CODE_MISSING);
    this.dpaError.set(this.dpaAccepted() ? null : DPA_MISSING);
    if (!this.dpaAccepted()) {
      this.dpaConsent()?.focus();
      return;
    }
    if (this.errorMessage()) {
      this.codeInput()?.nativeElement.focus();
      return;
    }

    this.pending.set(true);
    try {
      await this.redeem(code);
    } finally {
      this.pending.set(false);
    }
  }

  private async redeem(code: string): Promise<void> {
    const outcome = await this.session.redeemInviteCode(code);

    if (outcome === 'invalid') {
      this.errorMessage.set(INVALID_CODE);
      this.codeInput()?.nativeElement.focus();
      return;
    }
    if (outcome === 'locked') {
      this.errorMessage.set(LOCKED);
      return;
    }
    if (outcome === 'failed') {
      this.errorMessage.set(SERVER_ERROR);
      return;
    }

    // Scheitert das Speichern, schickt `requireDpa` auf die Zustimmungsseite.
    await this.session.acceptDpa(DPA_VERSION);
    await this.router.navigate(['/week']);
  }
}
