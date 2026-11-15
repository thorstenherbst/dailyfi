import type { Environment } from './environment.types';

// Lokales Supabase (supabase start). Der Publishable Key ist oeffentlich und
// nur in Verbindung mit Row Level Security sicher - deshalb ist RLS Pflicht.
export const environment: Environment = {
  production: false,
  supabaseUrl: 'http://127.0.0.1:54321',
  supabasePublishableKey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
};
