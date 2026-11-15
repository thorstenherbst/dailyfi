# shared/data-access-supabase

Supabase-Zugang für alle Repositories.

- `SUPABASE`, `injectSupabase`, `DailyfiClient`: ein einziger Client pro Anwendung
- `SUPABASE_CONFIG`: URL, Publishable Key und `production`, bereitgestellt von der App
- `RepositoryError`, `fail`, `guarded`/`injectGuarded`, `onRepositoryError`: Fehler mit Code statt
  Datenbank-Wortlaut; bei abgelehntem Token einmal `SESSION_RECOVERY` und Wiederholung
- `USER_FEEDBACK`: Rückmeldung der Stores, die App bindet es an die Toasts
- `Database`, `Json`: Typen aus `npm run db:types`
- `@lib/shared/data-access-supabase/testing`: `FakeSupabase`, `RecordingFeedback`, nur für Specs

Tags: `domain:shared`, `type:data-access`. Nutzbar von `type:data-access`, `type:feature` und der
App. Heute genutzt von der App und allen `*/data-access`-Libs.
