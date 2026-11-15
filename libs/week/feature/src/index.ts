/**
 * Nur Lade-Funktionen, keine Komponenten: ein statischer Export der Seite
 * zoege sie in das Initial-Bundle der App, die Route waere nicht mehr lazy.
 * Der Guard gegen ungespeichertes Verlassen ist allgemein
 * (`unsavedChangesGuard` aus `@lib/shared/util-edit`).
 */
export const loadWeekPage = () => import('./lib/week-page').then((m) => m.WeekPage);
