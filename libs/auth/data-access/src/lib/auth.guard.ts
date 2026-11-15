import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SessionStore } from './session';

/**
 * Schuetzt die Anwendung selbst. Zwei Huerden, in dieser Reihenfolge:
 * angemeldet, und Einladungscode eingeloest.
 *
 * Der Guard ist Bequemlichkeit, keine Sicherheitsgrenze — diese liegt in den
 * RLS-Policies, die beide Bedingungen serverseitig noch einmal stellen. Wer
 * den Guard umgeht, sieht eine leere Seite, keine fremden Daten.
 */
export const requireAccount: CanActivateFn = async () => {
  const session = inject(SessionStore);
  const router = inject(Router);

  if (await session.ensureAccess()) {
    return true;
  }
  return router.createUrlTree([session.user() ? '/register' : '/login']);
};

/**
 * `/login`: Wer schon drin ist, hat hier nichts verloren. Fehlt nur noch der
 * Einladungscode, geht es nach `/register` statt in die leere Anwendung.
 */
export const guestOnly: CanActivateFn = async () => {
  const session = inject(SessionStore);
  const router = inject(Router);

  const hasAccess = await session.ensureAccess();
  if (!session.user()) {
    return true;
  }
  return router.createUrlTree([hasAccess ? '/week' : '/register']);
};

/**
 * `/register`: offen fuer Gaeste **und** fuer angemeldete Konten ohne Code —
 * genau die brauchen das Formular. Nur wer vollstaendig freigeschaltet ist,
 * wird weitergeschickt.
 */
export const inviteCodeOnly: CanActivateFn = async () => {
  const session = inject(SessionStore);
  const router = inject(Router);

  return (await session.ensureAccess()) ? router.createUrlTree(['/week']) : true;
};
