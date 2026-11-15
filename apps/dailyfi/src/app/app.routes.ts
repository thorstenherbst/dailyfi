import { Routes } from '@angular/router';

import { guestOnly, inviteCodeOnly, requireAccount } from '@lib/auth/data-access';
import { loadCallbackPage, loadLoginPage, loadRegisterPage } from '@lib/auth/feature';
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
    title: 'Registrieren — Dailyfi',
    canActivate: [inviteCodeOnly],
    loadComponent: loadRegisterPage,
  },
  // MUSS vor der Wildcard stehen: sonst faengt diese den Ruecksprung aus der
  // Mail ab, leitet auf /week um und der Code in der Adresse ist verbraucht.
  {
    path: 'auth/callback',
    title: 'Anmeldung — Dailyfi',
    loadComponent: loadCallbackPage,
  },
  {
    path: 'week',
    title: 'Woche — Dailyfi',
    canActivate: [requireAccount],
    // Ungespeichertes im Panel: Hinweis statt stillem Verwerfen.
    canDeactivate: [unsavedChangesGuard],
    loadComponent: loadWeekPage,
  },
  {
    path: 'projects',
    title: 'Projekte — Dailyfi',
    canActivate: [requireAccount],
    // Ungespeichertes in einer Zeile: Hinweis in der Zeile statt stillem Verwerfen.
    canDeactivate: [unsavedChangesGuard],
    loadComponent: loadProjectsPage,
  },
  {
    path: 'reports',
    title: 'Reports — Dailyfi',
    canActivate: [requireAccount],
    loadComponent: loadReportsPage,
  },
  { path: '**', redirectTo: 'week' },
];
