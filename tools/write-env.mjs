// Schreibt die Production-`environment.ts` aus Umgebungsvariablen. Laeuft auf
// Vercel vor dem Build; lokal bleibt die Datei leer und unveraendert.
//
// Beide Werte sind oeffentlich (Publishable Key, nur mit RLS sicher). Sie
// kommen trotzdem aus der Umgebung, damit ein Projektwechsel keinen Commit
// braucht.
import { writeFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();

if (!url || !key) {
  console.error('SUPABASE_URL und SUPABASE_PUBLISHABLE_KEY muessen gesetzt sein.');
  process.exit(1);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.error(`SUPABASE_URL sieht nicht nach einem Supabase-Projekt aus: ${url}`);
  process.exit(1);
}

const target = new URL('../apps/dailyfi/src/environments/environment.ts', import.meta.url);
writeFileSync(
  target,
  `import type { Environment } from './environment.types';

// Erzeugt von tools/write-env.mjs — nicht einchecken.
export const environment: Environment = {
  production: true,
  supabaseUrl: ${JSON.stringify(url)},
  supabasePublishableKey: ${JSON.stringify(key)},
};
`,
);
console.log(`environment.ts geschrieben fuer ${url}`);
