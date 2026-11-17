import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { SessionStore, safeReturnUrl } from '@lib/auth/data-access';
import { AuthCard, DpaConsent } from '@lib/auth/ui';
import { DPA_VERSION } from '@lib/legal/domain';
import { Icon, ToastService } from '@lib/shared/ui';

const MISSING = 'Bitte bestätige, dass du dem AV-Vertrag zustimmst.';

/**
 * Zustimmung zum AV-Vertrag. Hierher schickt `requireDpa`, wenn das Konto der
 * aktuellen Fassung (`DPA_VERSION`) noch nicht zugestimmt hat — nach der
 * Registrierung ohne gespeicherte Zustimmung oder nach einer neuen Fassung.
 *
 * Danach geht es zur urspruenglich angefragten Adresse (`returnUrl`). Scheitert
 * das Speichern, bleibt die Seite stehen und meldet es als Toast; der Haken
 * bleibt gesetzt, ein Klick reicht fuer den naechsten Versuch.
 */
@Component({
  selector: 'app-consent-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthCard, DpaConsent, Icon],
  styleUrl: './auth-form.scss',
  template: `
    <app-auth-card heading="AV-Vertrag zustimmen" [lead]="lead">
      <form novalidate (submit)="onSubmit($event)">
        <p class="hint">
          In Dailyfi trägst du Daten deiner Kunden ein. Dafür schließt du mit uns einen Vertrag zur
          Auftragsverarbeitung. Ohne Zustimmung lässt sich Dailyfi nicht nutzen.
        </p>

        <app-dpa-consent
          inputId="consent-dpa"
          [accepted]="accepted()"
          (acceptedChange)="onAcceptedChange($event)"
          [error]="errorMessage()"
        />

        <div class="actions">
          <button class="btn btn-primary" type="submit" [disabled]="pending()">
            <app-icon name="check" />
            {{ pending() ? 'Wird gespeichert …' : 'Zustimmen und weiter' }}
          </button>
        </div>
      </form>

      <p class="footer">
        Nicht jetzt?
        <button class="btn-link" type="button" (click)="onSignOut()">Abmelden</button>
      </p>
    </app-auth-card>
  `,
})
export class ConsentPage {
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastService);
  private readonly consent = viewChild.required(DpaConsent);

  protected readonly accepted = signal(false);
  protected readonly pending = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly lead = 'Bevor es weitergeht, brauchen wir deine Zustimmung.';

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.pending()) {
      return;
    }
    if (!this.accepted()) {
      this.errorMessage.set(MISSING);
      this.consent().focus();
      return;
    }

    this.errorMessage.set(null);
    this.pending.set(true);
    try {
      if (await this.session.acceptDpa(DPA_VERSION)) {
        const target = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
        await this.router.navigateByUrl(target, { replaceUrl: true });
        return;
      }
      this.toasts.error('Zustimmung konnte nicht gespeichert werden.', {
        detail: 'Bitte noch einmal versuchen.',
      });
    } finally {
      this.pending.set(false);
    }
  }

  /** Mit dem Haken ist der Fehler am Feld erledigt. */
  protected onAcceptedChange(accepted: boolean): void {
    this.accepted.set(accepted);
    if (accepted) {
      this.errorMessage.set(null);
    }
  }

  protected async onSignOut(): Promise<void> {
    await this.session.signOut();
    await this.router.navigate(['/login']);
  }
}
