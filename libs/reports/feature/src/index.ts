/**
 * Nur Lade-Funktionen, keine Komponenten: ein statischer Export der Seite
 * zoege sie in das Initial-Bundle der App, die Route waere nicht mehr lazy.
 */
export const loadReportsPage = () => import('./lib/reports-page').then((m) => m.ReportsPage);
