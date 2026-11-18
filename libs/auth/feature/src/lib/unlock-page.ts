import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { RecoveryOutcome, SessionStore, VaultStore, safeReturnUrl } from '@lib/auth/data-access';
import { AuthCard } from '@lib/auth/ui';
import { Icon } from '@lib/shared/ui';

import { unlockMessage } from './vault-messages';

const RECOVERY_MESSAGES: Record<Exclude<RecoveryOutcome, 'ok'>, string> = {
  invalid: 'Das ist kein vollständiger Wiederherstellungsschlüssel. Er hat 52 Zeichen.',
  'wrong-key': 'Dieser Wiederherstellungsschlüssel passt nicht zu deinem Konto.',
  failed: 'Das hat nicht geklappt. Bitte versuche es noch einmal.',
};

/**
 * Entsperren nach jedem Öffnen: der Datenschlüssel liegt nur im
 * Arbeitsspeicher. Der Passkey wird erst auf Klick gefragt — Safari verlangt
 * für WebAuthn eine Nutzergeste.
 *
 * Fehlt der Passkey (neues Gerät, anderer Browser), entsperrt der
 * Wiederherstellungsschlüssel. Danach bietet die Seite an, gleich einen neuen
 * Passkey anzulegen.
 */
@Component({
  selector: 'app-unlock-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthCard, Icon],
  styleUrl: './auth-form.scss',
  template: `
    <app-auth-card heading="Daten entsperren" [lead]="lead()">
      @if (recovered()) {
        <div class="recovery">
          <h2 class="recovery-title" tabindex="-1" #recoveredHeading>Entsperrt</h2>
          <p>
            Lege jetzt einen neuen Passkey an. Dann brauchst du den Wiederherstellungsschlüssel beim
            nächsten Mal nicht.
          </p>
        </div>
        @if (errorMessage(); as message) {
          <p class="form-error" role="alert"><app-icon name="warn" /> {{ message }}</p>
        }
        <div class="actions">
          <button
            class="btn btn-primary"
            type="button"
            [attr.aria-disabled]="pending() || null"
            (click)="onAddPasskey()"
          >
            <app-icon name="lock" />
            {{ pending() ? 'Wird angelegt …' : 'Neuen Passkey anlegen' }}
          </button>
          <button class="btn btn-secondary" type="button" (click)="goOn()">Später</button>
        </div>
      } @else if (useRecovery()) {
        <form novalidate (submit)="onRecover($event)">
          <div class="field">
            <label class="label" for="recovery-input">Wiederherstellungsschlüssel</label>
            <input
              #recoveryInput
              class="input mono"
              id="recovery-input"
              type="text"
              name="recovery-key"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              required
              [attr.aria-invalid]="errorMessage() ? 'true' : null"
              [attr.aria-describedby]="
                errorMessage() ? 'recovery-hint recovery-error' : 'recovery-hint'
              "
              [value]="recoveryText()"
              (input)="recoveryText.set(read($event))"
            />
            <p class="hint" id="recovery-hint">52 Zeichen, Striche und Leerzeichen sind egal.</p>
          </div>
          @if (errorMessage(); as message) {
            <p class="form-error" id="recovery-error" role="alert">
              <app-icon name="warn" /> {{ message }}
            </p>
          }
          <div class="actions">
            <button class="btn btn-primary" type="submit" [attr.aria-disabled]="pending() || null">
              <app-icon name="lock" />
              {{ pending() ? 'Wird geprüft …' : 'Entsperren' }}
            </button>
            <button class="btn btn-secondary" type="button" (click)="showPasskey()">
              Doch mit Passkey
            </button>
          </div>
        </form>
      } @else {
        @if (errorMessage(); as message) {
          <p class="form-error" role="alert"><app-icon name="warn" /> {{ message }}</p>
        }
        <div class="actions">
          <button
            #passkeyButton
            class="btn btn-primary"
            type="button"
            [attr.aria-disabled]="pending() || null"
            (click)="onPasskey()"
          >
            <app-icon name="lock" />
            {{ pending() ? 'Warte auf den Passkey …' : 'Mit Passkey entsperren' }}
          </button>
          <button class="btn btn-secondary" type="button" (click)="showRecovery()">
            Wiederherstellungsschlüssel verwenden
          </button>
        </div>
      }

      <p class="footer">
        Anderes Konto?
        <button class="btn-link" type="button" (click)="onSignOut()">Abmelden</button>
      </p>
    </app-auth-card>
  `,
})
export class UnlockPage {
  private readonly vault = inject(VaultStore);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly recoveryInput = viewChild<ElementRef<HTMLInputElement>>('recoveryInput');
  private readonly recoveredHeading = viewChild<ElementRef<HTMLElement>>('recoveredHeading');
  private readonly passkeyButton = viewChild<ElementRef<HTMLButtonElement>>('passkeyButton');
  private readonly injector = inject(Injector);

  protected readonly pending = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly useRecovery = signal(false);
  protected readonly recoveryText = signal('');
  protected readonly recovered = signal(false);

  constructor() {
    // Beim Umschalten verschwindet der gedrückte Knopf; der Fokus geht dorthin,
    // wo es weitergeht.
    effect(() => {
      this.recoveryInput()?.nativeElement.focus();
    });
    effect(() => {
      this.recoveredHeading()?.nativeElement.focus();
    });

    // Der exportierbare Schlüssel aus der Wiederherstellung lebt nur so lange
    // wie diese Seite.
    inject(DestroyRef).onDestroy(() => this.vault.forgetRecovered());
  }

  protected lead(): string {
    const address = this.session.user()?.email;
    return address
      ? `Angemeldet als ${address}. Deine Daten sind verschlüsselt — entsperre sie mit deinem Passkey.`
      : 'Deine Daten sind verschlüsselt — entsperre sie mit deinem Passkey.';
  }

  protected read(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected showRecovery(): void {
    this.errorMessage.set(null);
    this.useRecovery.set(true);
  }

  protected showPasskey(): void {
    this.errorMessage.set(null);
    this.useRecovery.set(false);
    // Der gedrückte Knopf verschwindet mit dem Formular.
    afterNextRender(() => this.passkeyButton()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected async onPasskey(): Promise<void> {
    await this.busy(async () => {
      const outcome = await this.vault.unlockWithPasskey();
      if (outcome === 'ok') {
        await this.goOn();
        return;
      }
      this.errorMessage.set(unlockMessage(outcome));
    });
  }

  protected async onRecover(event: Event): Promise<void> {
    event.preventDefault();
    await this.busy(async () => {
      const outcome = await this.vault.unlockWithRecoveryKey(this.recoveryText());
      if (outcome === 'ok') {
        this.recoveryText.set('');
        this.recovered.set(true);
        return;
      }
      this.errorMessage.set(RECOVERY_MESSAGES[outcome]);
      this.recoveryInput()?.nativeElement.focus();
    });
  }

  protected async onAddPasskey(): Promise<void> {
    await this.busy(async () => {
      const outcome = await this.vault.addPasskey();
      if (outcome === 'ok') {
        await this.goOn();
        return;
      }
      this.errorMessage.set(unlockMessage(outcome));
    });
  }

  protected async goOn(): Promise<void> {
    this.vault.forgetRecovered();
    const target = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
    await this.router.navigateByUrl(target, { replaceUrl: true });
  }

  protected async onSignOut(): Promise<void> {
    await this.session.signOut();
    await this.router.navigate(['/login']);
  }

  private async busy(work: () => Promise<void>): Promise<void> {
    if (this.pending()) {
      return;
    }
    this.pending.set(true);
    this.errorMessage.set(null);
    try {
      await work();
    } finally {
      this.pending.set(false);
    }
  }
}
