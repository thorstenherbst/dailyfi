# shared/domain

Shared Kernel der Projektfarben: welcher gespeicherte Farbschlüssel (`projects.color`) zu welcher
Klasse `.pc1` … `.pc6` der Styles-Lib gehört. Liegt hier, weil `week` nicht von `projects`
abhängen darf.

- `projectColorSlot`, `projectColorClass`, `knownProjectColorSlot`, `isForeignProjectColor`
- `PROJECT_COLOR_KEYS`, `LEGACY_PROJECT_COLORS` (alte Schlüssel ohne Migration),
  `FALLBACK_PROJECT_COLOR_SLOT`, `NO_PROJECT_COLOR_CLASS`

Tags: `domain:shared`, `type:domain`. Nutzbar von allen Schichten außer `type:util`, aus jeder
Domäne. Heute genutzt von `projects/domain` und `week/ui`.
