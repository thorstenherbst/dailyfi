import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { DPA_VERSION } from '@lib/legal/domain';

import { SessionStore } from './session';
import { VaultStore } from './vault';

/** Die Zustimmungsseite, auf die `requireDpa` schickt. */
export const DPA_CONSENT_PATH = '/zustimmung';

/** Einrichten des Datenschluessels, beim ersten Mal. */
export const VAULT_SETUP_PATH = '/schluessel';

/** Entsperren des Datenschluessels, nach jedem Laden. */
export const VAULT_UNLOCK_PATH = '/entsperren';

/** Die Seiten vor der Anwendung; die Shell zeigt dort weder Menue noch Statusleiste. */
export const GATE_PATHS: readonly string[] = [
  DPA_CONSENT_PATH,
  VAULT_SETUP_PATH,
  VAULT_UNLOCK_PATH,
];

/**
 * Ziel nach Zustimmung oder Entsperren, aus `?returnUrl=`. Nur Pfade innerhalb
 * der Anwendung: `//andere.example` waere eine fremde Adresse. Fuehrt das
 * erste Pfadsegment auf eine dieser Seiten selbst (auch `/zustimmung/`,
 * `/Entsperren;x`), waere es ein Kreis. Alles andere fuehrt in die Woche.
 */
export function safeReturnUrl(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return '/week';
  }
  const first = `/${decodeSegment(raw.slice(1).split(/[/?#;]/)[0]).toLowerCase()}`;
  return GATE_PATHS.includes(first) ? '/week' : raw;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

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
 * Hinter `requireAccount`: Ohne Zustimmung zur aktuellen Fassung des
 * AV-Vertrags geht es auf die Zustimmungsseite, mit der angefragten Adresse als
 * `returnUrl`. Eine neue `DPA_VERSION` fragt also alle erneut.
 *
 * Steht der Guard einmal allein, faengt er fehlenden Zugang selbst ab, statt
 * auf eine Zustimmungsseite zu schicken, die ohne Konto nichts speichern kann.
 */
export const requireDpa: CanActivateFn = async (_route, state) => {
  const session = inject(SessionStore);
  const router = inject(Router);

  if (!(await session.ensureAccess())) {
    return router.createUrlTree([session.user() ? '/register' : '/login']);
  }
  if (await session.hasAcceptedDpa(DPA_VERSION)) {
    return true;
  }
  return router.createUrlTree([DPA_CONSENT_PATH], { queryParams: { returnUrl: state.url } });
};

/**
 * Die Zustimmungsseite selbst: Wer der aktuellen Fassung schon zugestimmt hat,
 * geht gleich weiter zum Ziel.
 */
export const dpaPending: CanActivateFn = async (route) => {
  const session = inject(SessionStore);
  const router = inject(Router);

  if (await session.hasAcceptedDpa(DPA_VERSION)) {
    return router.parseUrl(safeReturnUrl(route.queryParamMap.get('returnUrl')));
  }
  return true;
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
 * `/register`: die Code-Eingabe fuer angemeldete Konten ohne Freischaltung.
 * Gaeste muessen sich erst mit Apple anmelden — eingeloest wird ein Code an
 * `auth.uid()`. Wer schon freigeschaltet ist, geht weiter in die Anwendung.
 */
export const inviteCodeOnly: CanActivateFn = async () => {
  const session = inject(SessionStore);
  const router = inject(Router);

  if (await session.ensureAccess()) {
    return router.createUrlTree(['/week']);
  }
  return session.user() ? true : router.createUrlTree(['/login']);
};

/**
 * Hinter `requireDpa`: ohne entsperrten Datenschluessel keine Anwendung. Beim
 * ersten Mal geht es zum Einrichten, danach zum Entsperren — mit der
 * angefragten Adresse als `returnUrl`.
 */
export const requireUnlocked: CanActivateFn = async (_route, state) => {
  const vault = inject(VaultStore);
  const router = inject(Router);

  const status = await vault.status();
  if (status === 'unlocked') {
    return true;
  }
  if (status === 'missing') {
    return router.createUrlTree([VAULT_SETUP_PATH]);
  }
  return router.createUrlTree([VAULT_UNLOCK_PATH], { queryParams: { returnUrl: state.url } });
};

/** `/schluessel`: nur, solange noch keiner eingerichtet ist. */
export const vaultMissing: CanActivateFn = async () => {
  const vault = inject(VaultStore);
  const router = inject(Router);

  const status = await vault.status();
  if (status === 'missing') {
    return true;
  }
  return router.createUrlTree([status === 'unlocked' ? '/week' : VAULT_UNLOCK_PATH]);
};

/** `/entsperren`: wer schon entsperrt ist, geht weiter zum Ziel. */
export const vaultLocked: CanActivateFn = async (route) => {
  const vault = inject(VaultStore);
  const router = inject(Router);

  const status = await vault.status();
  if (status === 'unlocked') {
    return router.parseUrl(safeReturnUrl(route.queryParamMap.get('returnUrl')));
  }
  return status === 'missing' ? router.createUrlTree([VAULT_SETUP_PATH]) : true;
};
