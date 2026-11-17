import { ChangeDetectionStrategy, Component, PendingTasks, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { SessionStore } from '@lib/auth/data-access';
import {
  forgetDpaConsent,
  forgetInviteCode,
  readDpaConsent,
  readInviteCode,
} from '@lib/auth/domain';
import { AuthCard } from '@lib/auth/ui';
import { Icon } from '@lib/shared/ui';

/**
 * Was in der Rücksprung-Adresse steht. Supabase hängt den Code bei PKCE an die
 * Query; Fehler kommen je nach Weg an der Query **oder** am Fragment, deshalb
 * werden beide gelesen.
 */
interface CallbackParams {
  readonly code: string | null;
  readonly error: string | null;
  readonly errorCode: string | null;
}

/**
 * Rücksprung aus der Mail. Tauscht den Code gegen eine Session, löst einen
 * gemerkten Einladungscode ein, speichert eine gemerkte Zustimmung zum
 * AV-Vertrag und schickt weiter — `/week`, wenn alles steht,
 * sonst `/register`.
 *
 * Die Route muss in `app.routes.ts` **vor** der Wildcard stehen, sonst leitet
 * diese den Rücksprung auf `/week` um und der Code ist verbraucht.
 *
 * Jede Weiterleitung ersetzt den Eintrag in der Historie (`replaceUrl`): die
 * Adresse enthält einen verbrauchten Anmeldecode, und die Zurück-Taste soll
 * niemanden auf eine Seite werfen, die ihn ein zweites Mal einzulösen versucht.
 */
@Component({
  selector: 'app-callback-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthCard, Icon, RouterLink],
  styleUrl: './auth-form.scss',
  template: `
    <app-auth-card heading="Anmeldung">
      @if (failure(); as message) {
        <p class="form-error" role="alert"><app-icon name="warn" /> {{ message }}</p>
        <p class="footer"><a routerLink="/login">Neuen Anmeldelink anfordern</a></p>
      } @else {
        <p class="sent" role="status">Einen Moment, die Anmeldung wird abgeschlossen …</p>
      }
    </app-auth-card>
  `,
})
export class CallbackPage {
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly failure = signal<string | null>(null);

  constructor() {
    // Ueber `PendingTasks`, nicht als loses Promise: damit gilt die Anwendung
    // erst als stabil, wenn der Tausch durch ist. Das zaehlt fuer den Test
    // genauso wie fuer alles, was spaeter auf Stabilitaet wartet.
    void inject(PendingTasks).run(() => this.run());
  }

  private async run(): Promise<void> {
    // Selbst lesen statt auf den App-Initializer zu bauen: der Ausgang haengt
    // daran, ob hier schon eine Session steht (siehe `spent-or-foreign`).
    // Der Aufruf ist memoisiert und kostet beim zweiten Mal nichts.
    await this.session.restore();

    const params = this.readParams();

    if (params.error) {
      this.failure.set(
        params.errorCode === 'otp_expired'
          ? 'Dieser Link ist abgelaufen oder wurde schon benutzt. Links gelten eine Stunde und nur einmal.'
          : 'Die Anmeldung wurde abgebrochen.',
      );
      return;
    }

    if (!params.code) {
      this.failure.set('Dieser Link ist unvollständig. Bitte fordere einen neuen an.');
      return;
    }

    const outcome = await this.session.completeSignIn(params.code);

    if (outcome === 'spent-or-foreign') {
      // Fehlender Verifier heisst zweierlei. Steht schon eine Session, ist
      // dieser Link hier eingeloest worden und jemand ist über die
      // Zurück-Taste zurückgekommen — dann ist alles in Ordnung, nur die
      // Adresse ist alt. Ohne Session war es wirklich ein fremder Browser.
      if (this.session.user()) {
        await this.routeOn();
        return;
      }
      this.failure.set(
        'Dieser Link gehört zu einem anderen Browser. Fordere den Link bitte in dem Browser an, ' +
          'in dem du ihn öffnest.',
      );
      return;
    }

    if (outcome === 'failed') {
      this.failure.set('Die Anmeldung hat nicht geklappt. Bitte fordere einen neuen Link an.');
      return;
    }

    await this.redeemPendingCode();
  }

  /**
   * Der auf `/register` eingegebene Code. Er kann erst hier eingelöst werden —
   * vorher gab es keine Session, an der `auth.uid()` hängt.
   */
  private async redeemPendingCode(): Promise<void> {
    const pending = readInviteCode(this.session.user()?.email ?? '');

    if (pending && !this.session.hasBetaAccess()) {
      const redeemed = await this.session.redeemInviteCode(pending);

      if (redeemed === 'invalid') {
        forgetInviteCode();
        await this.goTo('/register', 'invalid-code');
        return;
      }

      // Gesperrt heißt: zu viele Fehlversuche auf diesem Konto. Der Code bleibt
      // liegen, nach Ablauf der Sperre reicht ein Klick.
      if (redeemed === 'locked') {
        await this.goTo('/register', 'locked');
        return;
      }

      // Eine Störung beim Server sagt **nichts** über den Code. Er bleibt
      // liegen, `/register` trägt ihn wieder ein, ein Klick reicht.
      if (redeemed === 'failed') {
        await this.goTo('/register', 'server-error');
        return;
      }

      forgetInviteCode();
    }

    await this.routeOn();
  }

  private async routeOn(): Promise<void> {
    const hasAccess = await this.session.ensureAccess();
    if (hasAccess) {
      await this.acceptPendingDpa();
    }
    await this.goTo(hasAccess ? '/week' : '/register');
  }

  /**
   * Die auf `/register` erteilte Zustimmung. Gespeichert wird die Version, der
   * dort zugestimmt wurde; ist sie nicht mehr die aktuelle oder scheitert das
   * Speichern, fragt `requireDpa` auf der Zustimmungsseite nach.
   */
  private async acceptPendingDpa(): Promise<void> {
    const version = readDpaConsent(this.session.user()?.email ?? '');
    if (version) {
      await this.session.acceptDpa(version);
      forgetDpaConsent();
    }
  }

  private async goTo(path: string, reason?: string): Promise<void> {
    await this.router.navigate([path], {
      replaceUrl: true,
      ...(reason ? { queryParams: { reason } } : {}),
    });
  }

  private readParams(): CallbackParams {
    const query = this.route.snapshot.queryParamMap;
    // Beim impliziten Weg stehen die Werte hinter der Raute statt in der Query.
    const fragment = new URLSearchParams((globalThis.location?.hash ?? '').replace(/^#/, ''));

    const pick = (name: string): string | null => query.get(name) ?? fragment.get(name);

    return {
      code: pick('code'),
      error: pick('error') ?? pick('error_code'),
      errorCode: pick('error_code'),
    };
  }
}
