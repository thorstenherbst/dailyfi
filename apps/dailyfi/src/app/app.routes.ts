import { Routes } from '@angular/router';

import {
  dpaPending,
  guestOnly,
  inviteCodeOnly,
  requireAccount,
  requireDpa,
} from '@lib/auth/data-access';
import {
  loadCallbackPage,
  loadConsentPage,
  loadLoginPage,
  loadRegisterPage,
} from '@lib/auth/feature';
import { loadDpaPage, loadImprintPage, loadPrivacyPage } from '@lib/legal/feature';
import { loadProjectsPage } from '@lib/projects/feature';
import { loadReportsPage } from '@lib/reports/feature';
import { unsavedChangesGuard } from '@lib/shared/util-edit';
import { loadWeekPage } from '@lib/week/feature';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'week' },
  {
    path: 'login',
    title: 'Anmelden — Dailyfi',
    canActivate: [guestOnly],
    loadComponent: loadLoginPage,
  },
  {
    path: 'register',
    title: 'Einladungscode — Dailyfi',
    canActivate: [inviteCodeOnly],
    loadComponent: loadRegisterPage,
  },
  // MUSS vor der Wildcard stehen: sonst faengt diese den Ruecksprung von Apple
  // ab, leitet auf /week um und der Code in der Adresse ist verbraucht.
  {
    path: 'auth/callback',
    title: 'Anmeldung — Dailyfi',
    loadComponent: loadCallbackPage,
  },
  // Zustimmung zum AV-Vertrag. Nur `requireAccount`: hierher schickt
  // `requireDpa`, also darf die Seite nicht selbst daran haengen.
  {
    path: 'zustimmung',
    title: 'Zustimmung — Dailyfi',
    canActivate: [requireAccount, dpaPending],
    loadComponent: loadConsentPage,
  },
  {
    path: 'week',
    title: 'Woche — Dailyfi',
    canActivate: [requireAccount, requireDpa],
    // Ungespeichertes im Panel: Hinweis statt stillem Verwerfen.
    canDeactivate: [unsavedChangesGuard],
    loadComponent: loadWeekPage,
  },
  {
    path: 'projects',
    title: 'Projekte — Dailyfi',
    canActivate: [requireAccount, requireDpa],
    // Ungespeichertes in einer Zeile: Hinweis in der Zeile statt stillem Verwerfen.
    canDeactivate: [unsavedChangesGuard],
    loadComponent: loadProjectsPage,
  },
  {
    path: 'reports',
    title: 'Reports — Dailyfi',
    canActivate: [requireAccount, requireDpa],
    loadComponent: loadReportsPage,
  },
  // Rechtstexte ohne Guard: abgemeldet wie angemeldet erreichbar.
  {
    path: 'impressum',
    title: 'Impressum — Dailyfi',
    loadComponent: loadImprintPage,
  },
  {
    path: 'datenschutz',
    title: 'Datenschutz — Dailyfi',
    loadComponent: loadPrivacyPage,
  },
  {
    path: 'avv',
    title: 'AV-Vertrag — Dailyfi',
    loadComponent: loadDpaPage,
  },
  { path: '**', redirectTo: 'week' },
];
