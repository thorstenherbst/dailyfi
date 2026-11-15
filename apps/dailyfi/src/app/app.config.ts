import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';

import { SessionStore } from '@lib/auth/data-access';
import { SESSION_RECOVERY, SUPABASE_CONFIG, USER_FEEDBACK } from '@lib/shared/data-access-supabase';
import { ToastService } from '@lib/shared/ui';
import { LEAVE_WITHOUT_ASKING } from '@lib/shared/util-edit';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { isAuthPath } from './auth-paths';
import { signedInFeedback } from './signed-in-feedback';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Bricht ein Guard eine Navigation aus dem Browserverlauf ab (Zurueck mit
    // ungespeichertem Panel), stellt `computed` den Verlauf per history.go
    // wieder her, statt den Eintrag zu ueberschreiben — Vor/Zurueck stimmen
    // danach noch (siehe WeekPage.canLeave).
    provideRouter(routes, withRouterConfig({ canceledNavigationResolution: 'computed' })),
    // Die Libs kennen die `environment` der App nicht; sie bekommen nur das,
    // was sie brauchen, ueber dieses Token.
    {
      provide: SUPABASE_CONFIG,
      useValue: {
        url: environment.supabaseUrl,
        publishableKey: environment.supabasePublishableKey,
        production: environment.production,
      },
    },
    // Die Stores melden Erfolg und Fehler ueber ein Token, weil sie die
    // Toasts in `shared/ui` nicht kennen duerfen. Hier kommen beide zusammen —
    // nur waehrend einer Sitzung (siehe signed-in-feedback.ts).
    {
      provide: USER_FEEDBACK,
      useFactory: () => signedInFeedback(inject(ToastService), inject(SessionStore).signedIn),
    },
    // Lehnt der Server ein Token ab, erneuert `SessionStore` die Sitzung, und
    // das Repository wiederholt den Zugriff einmal. `shared/data-access-supabase`
    // darf `auth` nicht kennen — darum auch hier nur ein Token.
    { provide: SESSION_RECOVERY, useExisting: SessionStore },
    // Mit Ungespeichertem auf eine Anmeldeseite: ohne Rueckfrage (Abmelden,
    // „Neu anmelden"). Eine Quelle mit dem Sitzungs-Modal (auth-paths.ts).
    { provide: LEAVE_WITHOUT_ASKING, useValue: isAuthPath },
    // Session einmal aus dem Speicher holen, bevor der erste Guard laeuft.
    // Ohne das schickte ein Neuladen auf /week jeden kurz auf /login.
    provideAppInitializer(() => inject(SessionStore).restore()),
  ],
};
