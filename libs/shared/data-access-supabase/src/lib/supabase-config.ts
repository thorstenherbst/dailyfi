import { InjectionToken } from '@angular/core';

/**
 * Was der Supabase-Zugriff von aussen braucht. Kommt von der App aus ihrer
 * `environment` — eine Lib darf nie aus `apps/` importieren, sonst haengt die
 * Domaene an genau einer Anwendung und die Grenze waere nur noch Konvention.
 */
export interface SupabaseConfig {
  readonly url: string;
  readonly publishableKey: string;
  /** In der ausgelieferten Anwendung bleibt die Konsole still. */
  readonly production: boolean;
}

export const SUPABASE_CONFIG = new InjectionToken<SupabaseConfig>('SUPABASE_CONFIG');
