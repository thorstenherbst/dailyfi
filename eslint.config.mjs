import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          // Regeln wie in der README. Jede Lib traegt einen
          // `type:*`- und einen `domain:*`-Tag; beide Regeln muessen greifen.
          depConstraints: [
            { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['*'] },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: ['type:ui', 'type:domain', 'type:data-access', 'type:util'],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui', 'type:domain', 'type:util'],
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: ['type:data-access', 'type:domain', 'type:util'],
            },
            { sourceTag: 'type:domain', onlyDependOnLibsWithTags: ['type:domain', 'type:util'] },
            { sourceTag: 'type:util', onlyDependOnLibsWithTags: ['type:util'] },
            // `shared/styles` ist reines SCSS und wird ueber includePaths
            // eingebunden, nie per TS-Import. Kein `type:*` ausser `app`
            // listet `type:styles`, also kann keine Lib es importieren.
            { sourceTag: 'type:styles', onlyDependOnLibsWithTags: ['type:styles'] },
            {
              sourceTag: 'domain:week',
              onlyDependOnLibsWithTags: ['domain:week', 'domain:shared'],
            },
            {
              sourceTag: 'domain:projects',
              onlyDependOnLibsWithTags: ['domain:projects', 'domain:shared'],
            },
            {
              sourceTag: 'domain:reports',
              onlyDependOnLibsWithTags: ['domain:reports', 'domain:shared'],
            },
            {
              sourceTag: 'domain:auth',
              onlyDependOnLibsWithTags: ['domain:auth', 'domain:shared'],
            },
            { sourceTag: 'domain:shared', onlyDependOnLibsWithTags: ['domain:shared'] },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
  {
    // Bewusst: das BOM im RegExp des CSV-Tests und die Erklaerung zum U+200B
    // im Kommentar von `week-store.ts`. Globs sind relativ zum Projekt, das
    // diese Config einbindet. Sonst gilt die Regel unveraendert.
    files: ['**/src/lib/csv.spec.ts', '**/src/lib/week-store.ts'],
    rules: {
      'no-irregular-whitespace': ['error', { skipComments: true, skipRegExps: true }],
    },
  },
  {
    // Test-Doubles: leere Mocks (`mockImplementation(() => {})`) und das
    // `this`-Alias im Fake-Query-Builder sind dort Absicht, kein Fehler.
    files: ['**/*.spec.ts', '**/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-this-alias': 'off',
    },
  },
  {
    // In Specs sichert `!` eine Vorbedingung ab, die der Test selbst herstellt.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
