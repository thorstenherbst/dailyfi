/**
 * Nur Lade-Funktionen, keine Komponenten: ein statischer Export der Seiten
 * zoege sie in das Initial-Bundle der App, und jede Seite behaelt so ihren
 * eigenen Chunk.
 */
export const loadLoginPage = () => import('./lib/login-page').then((m) => m.LoginPage);
export const loadRegisterPage = () => import('./lib/register-page').then((m) => m.RegisterPage);
export const loadCallbackPage = () => import('./lib/callback-page').then((m) => m.CallbackPage);
