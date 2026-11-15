/**
 * Die Anmeldeseiten. Hier gibt es keine Sitzung, die ablaufen koennte — kein
 * Modal dafuer (`App`), und wer mit Ungespeichertem dorthin geht, wird nicht
 * aufgehalten (`LEAVE_WITHOUT_ASKING` in app.config.ts): man kommt nur nach dem
 * Ende der Sitzung hin, speichern ginge dann ohnehin nicht mehr.
 */
const AUTH_PATHS = ['/login', '/register', '/auth/callback'];

/** Pfad ohne Query und Fragment. */
export function pathOf(url: string): string {
  return url.split(/[?#]/)[0];
}

export function isAuthPath(url: string): boolean {
  const path = pathOf(url);
  return AUTH_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
