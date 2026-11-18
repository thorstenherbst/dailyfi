import { ChangeDetectionStrategy, Component, PendingTasks, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { SessionStore } from '@lib/auth/data-access';
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
  readonly description: string | null;
}

/**
 * Rücksprung nach der Anmeldung mit Apple. Tauscht den Code gegen eine Session
 * und schickt weiter — `/week`, wenn das Konto freigeschaltet ist, sonst zur
 * Code-Eingabe auf `/register`. Die Zustimmung zum AV-Vertrag fragt danach
 * `requireDpa` ab.
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
        <p class="footer"><a routerLink="/login">Zurück zur Anmeldung</a></p>
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
      this.session.reportSignInError(params);
      this.failure.set(
        params.error === 'access_denied'
          ? 'Die Anmeldung mit Apple wurde abgebrochen.'
          : 'Die Anmeldung mit Apple hat nicht geklappt. Bitte versuche es noch einmal.',
      );
      return;
    }

    if (!params.code) {
      this.failure.set('Die Anmeldung ist unvollständig. Bitte melde dich noch einmal an.');
      return;
    }

    const outcome = await this.session.completeSignIn(params.code);

    if (outcome === 'spent-or-foreign') {
      // Fehlender Verifier heisst zweierlei. Steht schon eine Session, ist
      // dieser Code hier eingeloest worden und jemand ist über die
      // Zurück-Taste zurückgekommen — dann ist alles in Ordnung, nur die
      // Adresse ist alt. Ohne Session fehlt der im Browser abgelegte
      // Verifier: Speicher geleert, privates Fenster gewechselt, oder der
      // Ruecksprung ist in einem anderen (eingebetteten) Browser gelandet.
      if (this.session.user()) {
        await this.routeOn();
        return;
      }
      this.failure.set(
        'Die Anmeldung konnte hier nicht abgeschlossen werden. Bitte melde dich noch einmal an.',
      );
      return;
    }

    if (outcome === 'failed') {
      this.failure.set('Die Anmeldung hat nicht geklappt. Bitte melde dich noch einmal an.');
      return;
    }

    await this.routeOn();
  }

  private async routeOn(): Promise<void> {
    const hasAccess = await this.session.ensureAccess();
    await this.goTo(hasAccess ? '/week' : '/register');
  }

  private async goTo(path: string): Promise<void> {
    await this.router.navigate([path], { replaceUrl: true });
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
      description: pick('error_description'),
    };
  }
}
