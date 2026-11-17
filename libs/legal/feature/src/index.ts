/**
 * Nur Lade-Funktionen, keine Komponenten: jede Seite behaelt so ihren eigenen
 * Chunk und landet nicht im Initial-Bundle der App.
 */
export const loadImprintPage = () => import('./lib/imprint-page').then((m) => m.ImprintPage);
export const loadPrivacyPage = () => import('./lib/privacy-page').then((m) => m.PrivacyPage);
export const loadDpaPage = () => import('./lib/dpa-page').then((m) => m.DpaPage);
