/**
 * Form der Umgebungskonfiguration. Liegt bewusst in einer eigenen Datei: beide
 * `environment`-Dateien tauschen sich beim Build gegenseitig aus, eine duerfte
 * die andere also nicht importieren.
 */
export interface Environment {
  readonly production: boolean;
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
}
