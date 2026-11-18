import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';

import { SessionStore, SetUpStep, VaultStore } from '@lib/auth/data-access';
import { AuthCard } from '@lib/auth/ui';
import { Icon } from '@lib/shared/ui';
import { FileDownload } from '@lib/shared/util-browser';

import { setUpMessage } from './vault-messages';

const NOT_CONFIRMED = 'Bitte bestätige, dass du den Wiederherstellungsschlüssel aufbewahrt hast.';

/**
 * Erstes Einrichten der Verschlüsselung. Hierher schickt `requireUnlocked`,
 * solange das Konto noch keinen Datenschlüssel hat.
 *
 * Passkey anlegen (bei Safari mit einem zweiten Klick zum Bestätigen), dann den
 * Wiederherstellungsschlüssel zeigen. Gespeichert wird erst, wenn bestätigt
 * ist, dass er aufbewahrt wurde: geht die Seite vorher zu, ist nichts
 * eingerichtet, und es beginnt beim nächsten Mal von vorn — statt mit einem
 * Konto, dessen Wiederherstellungsschlüssel niemand kennt.
 */
@Component({
  selector: 'app-vault-setup-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthCard, Icon],
  styleUrl: './auth-form.scss',
  template: `
    <app-auth-card heading="Verschlüsselung einrichten" [lead]="lead">
      <p class="sr-only" role="status">{{ liveMessage() }}</p>

      @if (recoveryKey(); as key) {
        <form novalidate (submit)="onContinue($event)">
          <div class="recovery">
            <h2 class="recovery-title" tabindex="-1" #recoveryHeading>
              Dein Wiederherstellungsschlüssel
            </h2>
            <p>
              Ohne Passkey ist er der einzige Weg zu deinen Daten. Wir haben ihn nicht und können
              ihn nicht ersetzen. Bewahre ihn sicher auf, etwa im Passwortmanager oder ausgedruckt.
            </p>
            <p class="recovery-key" id="recovery-key">{{ key }}</p>
            <div class="recovery-actions">
              <button class="btn btn-secondary" type="button" (click)="onCopy(key)">
                <app-icon name="check" /> Kopieren
              </button>
              <button class="btn btn-secondary" type="button" (click)="onSave(key)">
                <app-icon name="download" /> Als Datei speichern
              </button>
            </div>
          </div>

          <div class="field">
            <label class="check" for="recovery-stored">
              <input
                #confirmBox
                type="checkbox"
                id="recovery-stored"
                name="recovery-stored"
                required
                [checked]="confirmed()"
                [attr.aria-invalid]="confirmError() ? 'true' : null"
                [attr.aria-describedby]="confirmError() ? 'recovery-stored-error' : null"
                (change)="onConfirmChange($event)"
              />
              <span>Ich habe den Wiederherstellungsschlüssel sicher aufbewahrt.</span>
            </label>
            @if (confirmError(); as message) {
              <p class="form-error" id="recovery-stored-error" role="alert">
                <app-icon name="warn" /> {{ message }}
              </p>
            }
          </div>

          @if (errorMessage(); as message) {
            <p class="form-error" role="alert"><app-icon name="warn" /> {{ message }}</p>
          }

          <div class="actions">
            <button class="btn btn-primary" type="submit" [attr.aria-disabled]="pending() || null">
              <app-icon name="check" />
              {{ pending() ? 'Wird gespeichert …' : 'Einrichtung abschließen' }}
            </button>
          </div>
        </form>
      } @else {
        <p class="hint">
          Dafür legst du einen Passkey an — mit Face ID, Touch ID oder dem Gerätecode, gespeichert
          im iCloud-Schlüsselbund. Er entsperrt deine Daten bei jedem Öffnen. Danach bekommst du
          einen Wiederherstellungsschlüssel für den Notfall.
        </p>

        @if (errorMessage(); as message) {
          <p class="form-error" role="alert"><app-icon name="warn" /> {{ message }}</p>
        }

        <div class="actions">
          @if (needsConfirm()) {
            <p class="hint" id="confirm-hint">
              Der Passkey ist angelegt. Bestätige ihn noch einmal, damit Dailyfi daraus deinen
              Schlüssel ableiten kann.
            </p>
            <button
              #confirmButton
              class="btn btn-primary"
              type="button"
              aria-describedby="confirm-hint"
              [attr.aria-disabled]="pending() || null"
              (click)="onConfirmPasskey()"
            >
              <app-icon name="lock" />
              {{ pending() ? 'Warte auf den Passkey …' : 'Passkey bestätigen' }}
            </button>
          } @else {
            <button
              class="btn btn-primary"
              type="button"
              [attr.aria-disabled]="pending() || null"
              (click)="onSetUp()"
            >
              <app-icon name="lock" />
              {{ pending() ? 'Wird eingerichtet …' : 'Passkey anlegen' }}
            </button>
          }
        </div>
      }

      <p class="footer">
        Nicht jetzt?
        <button class="btn-link" type="button" (click)="onSignOut()">Abmelden</button>
      </p>
    </app-auth-card>
  `,
})
export class VaultSetupPage {
  private readonly vault = inject(VaultStore);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly download = inject(FileDownload);
  private readonly recoveryHeading = viewChild<ElementRef<HTMLElement>>('recoveryHeading');
  private readonly confirmBox = viewChild<ElementRef<HTMLInputElement>>('confirmBox');
  private readonly confirmButton = viewChild<ElementRef<HTMLButtonElement>>('confirmButton');

  protected readonly lead =
    'Deine Daten werden in diesem Browser verschlüsselt, bevor sie gespeichert werden. ' +
    'Lesen kannst nur du sie — wir nicht.';

  protected readonly pending = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly recoveryKey = signal<string | null>(null);
  protected readonly needsConfirm = signal(false);
  protected readonly confirmed = signal(false);
  protected readonly confirmError = signal<string | null>(null);
  protected readonly liveMessage = signal('');

  constructor() {
    // Der Knopf verschwindet mit dem ersten Schritt; ohne diesen Sprung fiele
    // der Fokus auf den Dokumentkörper.
    effect(() => {
      this.recoveryHeading()?.nativeElement.focus();
    });
    effect(() => {
      this.confirmButton()?.nativeElement.focus();
    });

    if (!this.vault.passkeysAvailable()) {
      this.errorMessage.set(setUpMessage('unsupported'));
    }

    // Wer die Seite vor dem Abschluss verlässt, hat nichts eingerichtet. Die
    // Sperre für andere Tabs geht damit wieder frei.
    inject(DestroyRef).onDestroy(() => this.vault.abandonSetUp());
  }

  protected async onSetUp(): Promise<void> {
    await this.busy(() => this.vault.beginSetUp());
  }

  protected async onConfirmPasskey(): Promise<void> {
    await this.busy(() => this.vault.confirmPasskey());
  }

  protected async onCopy(key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(key);
      this.liveMessage.set('Wiederherstellungsschlüssel kopiert.');
    } catch {
      this.liveMessage.set('Kopieren hat nicht geklappt. Bitte markiere den Schlüssel von Hand.');
    }
  }

  protected onSave(key: string): void {
    this.download.save(
      'dailyfi-wiederherstellungsschluessel.txt',
      `Dailyfi – Wiederherstellungsschlüssel\n\n${key}\n\n` +
        `Konto: ${this.session.user()?.email ?? ''}\n` +
        'Ohne Passkey ist dieser Schlüssel der einzige Weg zu deinen Daten.\n',
      'text/plain;charset=utf-8',
    );
  }

  protected onConfirmChange(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.confirmed.set(checked);
    if (checked) {
      this.confirmError.set(null);
    }
  }

  protected async onContinue(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.confirmed()) {
      this.confirmError.set(NOT_CONFIRMED);
      this.confirmBox()?.nativeElement.focus();
      return;
    }
    await this.busy(() => this.vault.finishSetUp());
  }

  private async busy(work: () => Promise<SetUpStep>): Promise<void> {
    if (this.pending()) {
      return;
    }
    this.pending.set(true);
    this.errorMessage.set(null);
    try {
      await this.apply(await work());
    } finally {
      this.pending.set(false);
    }
  }

  private async apply(step: SetUpStep): Promise<void> {
    switch (step.step) {
      case 'confirm-passkey':
        this.needsConfirm.set(true);
        return;
      case 'show-recovery':
        this.needsConfirm.set(false);
        this.recoveryKey.set(step.recoveryKey);
        return;
      case 'done':
        await this.router.navigateByUrl('/week', { replaceUrl: true });
        return;
      case 'failed':
        if (step.reason === 'already-set-up') {
          // Inzwischen eingerichtet, etwa in einem anderen Tab: dort entsperren.
          await this.router.navigateByUrl('/entsperren', { replaceUrl: true });
          return;
        }
        this.errorMessage.set(setUpMessage(step.reason));
    }
  }

  protected async onSignOut(): Promise<void> {
    await this.session.signOut();
    await this.router.navigate(['/login']);
  }
}
