# Dailyfi

Zeiterfassung für Freelancer: Zeitblöcke im Wochenraster, Projekte pro Kunde, Monatsauswertung
mit CSV-Export. Anmeldung mit Apple, Zugang nur mit Einladungscode.

Angular 22 (zoneless, Standalone, Signals) · Nx 24 · SCSS · Vitest · Supabase (Postgres, Auth, RLS)

## Voraussetzungen

- Node 24 (`.nvmrc`, also `nvm use`)
- Docker für das lokale Supabase
- Supabase CLI (`supabase start`, `supabase db reset`)

## Lokaler Start

```bash
supabase start   # Postgres, Auth und Studio lokal, spielt Migrationen und Seed ein
npm ci
npm start        # http://localhost:4200
```

Lokal liest die App `apps/dailyfi/src/environments/environment.development.ts` (lokales Supabase
auf Port 54321). Supabase Studio läuft auf http://127.0.0.1:54323. `npm run db:reset` setzt die
Datenbank neu auf (Migrationen und `supabase/seed.sql`).

Anmelden lässt sich lokal nicht: Apple leitet nur auf eine HTTPS-Adresse einer registrierten
Domain zurück. Der Anmeldeweg ist über Vitest abgedeckt und wird auf einem Vercel-Deployment
gegen Supabase Cloud ausprobiert.

## Testen

```bash
npm test          # Vitest, alle Projekte (nx run-many -t test)
npm run test:tz   # dieselben Tests in der Zeitzone Australia/Sydney
npm run lint      # ESLint inklusive Modulgrenzen
```

Weitere Skripte: `npm run build` (Produktions-Build), `npm run test:watch -- <projekt>`,
`npm run db:types` (Typen aus dem lokalen Schema nach `shared/data-access-supabase`),
`npm run graph` (Abhängigkeitsgraph).

Die Libs haben kein eigenes Application-Target. Ihre Tests laufen mit `@angular/build:unit-test`
gegen `dailyfi:build:development` (eingestellt in `nx.json`).

## Workspace-Aufbau

`apps/dailyfi` ist nur die Shell: Bootstrap, `app.config`, Routen, Layout und Environments. Die
Fachlichkeit liegt in Libs unter `libs/<domäne>/<schicht>`, importiert über `@lib/<domäne>/<schicht>`.

| Domäne | Schichten |
|---|---|
| `week` | `feature`, `ui`, `domain`, `data-access` |
| `projects` | `feature`, `ui`, `domain`, `data-access` |
| `reports` | `feature`, `domain`, `data-access` |
| `auth` | `feature`, `ui`, `data-access` |
| `legal` | `feature`, `domain` |
| `shared` | `ui`, `domain`, `data-access-supabase`, `util-time`, `util-browser`, `util-edit`, `styles` |

Jede Lib trägt einen Tag `type:*` und einen Tag `domain:*`. `@nx/enforce-module-boundaries` in
`eslint.config.mjs` prüft beide:

| Quelle | darf abhängen von |
|---|---|
| `type:app` | allem |
| `type:feature` | `type:ui`, `type:domain`, `type:data-access`, `type:util` |
| `type:ui` | `type:ui`, `type:domain`, `type:util` |
| `type:data-access` | `type:data-access`, `type:domain`, `type:util` |
| `type:domain` | `type:domain`, `type:util` |
| `type:util` | `type:util` |
| `type:styles` | nur über SCSS eingebunden, von keiner Lib importierbar |
| `domain:X` | `domain:X`, `domain:shared` |
| `domain:auth` | zusätzlich `domain:legal` (Fassung des AV-Vertrags für die Zustimmung) |

Libs importieren nie aus `apps/`. Was sie von der App brauchen, kommt über Injection-Tokens
(`SUPABASE_CONFIG`, `USER_FEEDBACK`, `SESSION_RECOVERY`, `LEAVE_WITHOUT_ASKING`), die
`app.config.ts` bereitstellt. Jede Lib hat eine eigene README.

## SCSS-Architektur

Alle Styles liegen in `libs/shared/styles`. Die App bindet `src/index.scss` als einzigen globalen
Stylesheet ein. Komponenten holen Tokens, Funktionen und Mixins über `@use 'abstracts' as *;`
(Pfad über `stylePreprocessorOptions.includePaths` in `apps/dailyfi/project.json`). Maße stehen
als SASS-Tokens, Farben und Schatten nur als CSS Custom Properties. Details und die Regel, wohin
ein Wert gehört: [`libs/shared/styles/README.md`](./libs/shared/styles/README.md).

Schriften: Inter und JetBrains Mono über `@fontsource`, beide unter der SIL Open Font License 1.1.
Die Lizenztexte liegen in `apps/dailyfi/public/fonts-LICENSE.txt` und werden mit ausgeliefert.

## Deployment

### Vercel

Konfiguration in [`vercel.json`](./vercel.json): `npm ci`, dann `node tools/write-env.mjs` und
`nx build dailyfi`. Ausgeliefert wird `dist/dailyfi/browser`, Pfade ohne Dateiendung gehen per
Rewrite auf `index.html`.

- Vercel liest die Umgebungsvariablen `SUPABASE_URL` und `SUPABASE_PUBLISHABLE_KEY`.
  `tools/write-env.mjs` schreibt daraus beim Build `apps/dailyfi/src/environments/environment.ts`.
  Fehlt eine der beiden oder ist die URL keine `https://<projekt>.supabase.co`, bricht der Build ab.
- Im Repo steht `environment.ts` mit leeren Werten. Das Skript überschreibt diese Datei. Lokal
  ausgeführt, darf das Ergebnis nicht eingecheckt werden.
- Deployment Protection ist auf allen Deployments aktiv.

### Supabase Cloud

- Das Projekt läuft in `eu-central-1`.
- Das Schema kommt aus `supabase/migrations`. Der Seed (`supabase/seed.sql`) ist nur für lokal.
- Die Auth-Einstellungen der Cloud werden von Hand gepflegt, `supabase/config.toml` gilt nur lokal:
  - Site-URL und Redirect-URL (`/auth/callback`) auf die Vercel-Domain
  - Provider „Apple“: Services ID als Client ID, dazu der Secret Key — ein JWT, das mit dem
    `.p8`-Schlüssel aus dem Apple Developer Account signiert ist. **Apple lässt es nach höchstens
    sechs Monaten ablaufen**, danach schlägt jede Anmeldung fehl. Rechtzeitig neu erzeugen.
  - Provider „Email“ aus
  - Auth-Hook `before_user_created` (Postgres-Funktion `public.before_user_created`)
- Im Apple Developer Account: App ID mit „Sign in with Apple“, Services ID mit der Domain
  `<projekt>.supabase.co` und der Return URL `https://<projekt>.supabase.co/auth/v1/callback`,
  Key mit „Sign in with Apple“.

### Einladungscodes anlegen

Ein Konto entsteht mit der ersten Anmeldung bei Apple. Ohne eingelösten Code sieht es keine Daten;
den Code gibt es danach auf `/register` ein. Den Code erzeugt die Datenbank selbst
(`default new_invite_code()`):

```sql
insert into invite_codes (note) values ('…') returning code;
```

`note` hält fest, für wen der Code ist. Die Codes in `supabase/seed.sql` gelten nur lokal.
