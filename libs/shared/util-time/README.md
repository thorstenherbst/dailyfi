# shared/util-time

Zeitrechnung des Wochenrasters, ohne Bibliothek und ohne Angular. Trennt Wandzeit (`DayKey` plus
Minuten) von Zeitpunkten (`Date`), dazwischen immer Europe/Berlin (`TIME_ZONE`). Dauern kommen aus
echten Zeitpunkten, damit die Zeitumstellung stimmt.

- Umrechnung: `wallToInstant`, `instantToWall`, `dayLengthMinutes`, `startOfWeek`, `isoWeekNumber`
- Raster: `HOUR_HEIGHT_PX`, `AXIS_WIDTH_PX` (Test gegen `$layout` der Styles-Lib),
  `SNAP_MINUTES`, `placementFromDrag`, `movePlacement`, `resizePlacement`, `assignLanes`
- Format: `formatHours`, `formatDuration`, `formatClock`, `formatWeekRange`, `describePlacement`

Tags: `domain:shared`, `type:util`. Nutzbar von jeder Schicht und Domäne. Heute genutzt von `week`
und `reports`.
