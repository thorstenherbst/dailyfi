# shared/styles

Die SCSS-Architektur von Dailyfi. Reines SCSS, kein TypeScript, kein Nx-Target.
Tags: `domain:shared`, `type:styles`. Keine Lib kann sie per TS importieren.

Die App bindet `src/index.scss` als einzigen globalen Stylesheet ein
(`apps/dailyfi/project.json` → `styles`). `src/` steht in
`stylePreprocessorOptions.includePaths`, deshalb holen sich Komponenten Tokens,
Funktionen und Mixins so:

```scss
@use 'abstracts' as *;
```

Nur Sass-Module (`@use`/`@forward`), kein `@import`.

## Ordnerstruktur

```
src/
  abstracts/   _tokens     SASS-Maps: $space, $font-size, $font-weight, $line-height,
                           $font-family, $radius, $breakpoints, $z, $duration, $size, $layout
               _functions  space(4), font-size(md), font-weight(semibold), radius(lg),
                           bp(lg), z(toast), dur(base), size(control-h), layout(hour-h) …
               _mixins     from(lg), below(lg), focus-ring, visually-hidden, type, mono,
                           dark-theme, custom-properties, motion
               _index      @forward der drei, erzeugt kein CSS
  base/        _fonts      Inter und JetBrains Mono, selbst gehostet (@fontsource, latin)
               _theme      alle Farben und Schatten als Custom Properties (hell und dunkel),
                           dazu die zur Laufzeit gelesenen Tokens
               _reset      Basis-Reset (lässt <dialog> zentriert)
               _typography body, Überschriften, .mono, sichtbarer Fokus
  components/  _button _field _modal _table _pagehead _notice _toast _panel
               _time-block _load-error _tag _project-color _tooltip
               _prose (Lesesatz der Rechtstexte, .placeholder)
  utilities/   _a11y (.sr-only, .skip-link)  _layout (.container, .stack, .grow)
  index.scss   einziger globaler Einstieg
```

Was nur eine Komponente braucht (Raster, Rund-Menü, Statusleiste), steht in der
`.scss` dieser Komponente und nutzt nur `abstracts`.

## Wohin gehört ein Wert?

- **SASS-Token** (`abstracts/_tokens.scss`): alles, was zur Buildzeit feststeht
  und nicht zwischen Themes wechselt. Dazu gehören Spacing, Schriftgrößen,
  Radien, Breakpoints, z-index, Dauern und Maße. Media Queries brauchen
  ohnehin Buildzeit-Werte.
- **CSS Custom Property** (`base/_theme.scss`): alles, was zur Laufzeit
  umschaltet, also alle Farben, Schatten und Projektfarben.
- **Farben nie als SASS-Variable.** Sonst bricht der Dunkelmodus.
- **Beides**: Ein SASS-Token, das zur Laufzeit gelesen wird, gibt
  `base/_theme.scss` mit dem Mixin `custom-properties` aus der Map aus. Die Map
  bleibt die einzige Quelle. Heute sind das `--hour-h` und `--axis-w` (Raster)
  sowie `--dur-open-delay` und `--dur-close-delay` (JS-Timer im Rund-Menü).
  Ausnahme ist `--panel-w`: Es steht mit seiner Breakpoint-Umschaltung in
  `components/_panel.scss`. `HOUR_HEIGHT_PX` und `AXIS_WIDTH_PX` in
  `shared/util-time` prüft ein Test gegen `$layout`.

```scss
@use 'abstracts' as *;

.toolbar {
  gap: space(2);                 // Buildzeit: 8px
  height: var(--hour-h);         // Laufzeit-Token
  background: var(--surface);    // Farbe: immer Custom Property
  @include below(lg) { display: none; }
}
```

## Dunkelmodus

Hell steht auf `:root`. Dunkel steht genau einmal im Quelltext, im Mixin
`dark-theme` in `base/_theme.scss`. Das Mixin erzeugt beide Wege:

```css
@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { … } }
:root[data-theme='dark'] { … }
```

Nur im `:root`-Kontext verwenden. Komponenten brauchen keinen eigenen
Dunkelmodus, solange sie Farben nur über `var(--…)` lesen.

## Neuen Token anlegen

1. Wert in die passende Map in `abstracts/_tokens.scss` eintragen.
2. In der Komponente über die Funktion lesen, zum Beispiel `space(…)`,
   `radius(…)`, `z(…)`. Ein unbekannter Schlüssel bricht den Build mit
   Fehlermeldung ab.
3. Nur wenn TypeScript oder `calc()` zur Laufzeit den Wert braucht: in
   `base/_theme.scss` per `custom-properties($map, (schlüssel))` ausgeben.
4. Neue Farbe: als Custom Property in `base/_theme.scss`, einmal in `:root`
   (hell) und einmal in `@include dark-theme { … }` (dunkel).

## Neue Komponente anlegen

- **Geteilt** (von mehreren Seiten genutzt): `components/_name.scss` anlegen,
  mit `@use '../abstracts' as *;` beginnen und in `index.scss` per
  `@use 'components/name';` eintragen. Erzeugt globales CSS.
- **Nur für eine Angular-Komponente**: in deren eigener `.scss` mit
  `@use 'abstracts' as *;`. Das Budget `anyComponentStyle` warnt ab 4 kB.
- Abstände, Größen und Radien über die Funktionen, Farben und Schatten über
  `var(--…)`, Fokus über `@include focus-ring`, Bewegung in `@include motion`.

## Projektfarben

`.pc1` … `.pc6` setzen `--p-fill` und `--p-on` (Kobalt, Smaragd, Senf, Kupfer,
Graphit, Petrol). Blöcke, Farbpunkte (`.dot`) und Farbwahl lesen nur diese
beiden. `.pc-none` gilt für Einträge ohne bekanntes Projekt. Welcher
gespeicherte Farbschlüssel zu welcher Klasse gehört, steht in
`libs/shared/domain` (`project-color-slot.ts`), die Namen für die Farbwahl in
`projects/domain`.

## Schriften

Selbst gehostet über `@fontsource/inter` und `@fontsource/jetbrains-mono`
(`base/_fonts.scss`): nur die verwendeten Gewichte, Subset `latin` (enthält die
deutschen Umlaute), `font-display: swap`. Keine Anfrage an Google.
