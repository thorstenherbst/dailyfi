import { InjectionToken, inject } from '@angular/core';
import { SupabaseClient, createClient } from '@supabase/supabase-js';

import type { Database } from './database.types';
import { SUPABASE_CONFIG } from './supabase-config';

export type DailyfiClient = SupabaseClient<Database>;

/**
 * Ein einziger Supabase-Client pro Anwendung. Mehrere Instanzen teilen sich die
 * Session im LocalStorage nicht sauber und lösen einander beim Token-Refresh ab.
 */
export const SUPABASE = new InjectionToken<DailyfiClient>('SUPABASE', {
  providedIn: 'root',
  factory: () => {
    const config = inject(SUPABASE_CONFIG);
    return createClient<Database>(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Aus: der Ruecksprung wird in `auth/feature` (`callback-page.ts`) bewusst selbst
        // eingeloest. Sonst taeten es beide, und der zweite Versuch scheiterte
        // an einem bereits verbrauchten Code — ohne dass jemand sagen koennte,
        // warum die Anmeldung mal geht und mal nicht.
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    });
  },
});

export function injectSupabase(): DailyfiClient {
  return inject(SUPABASE);
}
