# week/domain

Typen und reine Logik des Wochenrasters, ohne DOM und ohne Datenbank.

- `time-entry`: `Project`, `TimeEntry`, `TimeEntryDraft`
- `placement`: Eintrag ↔ Position im Raster (`placementOf`, `instantsOf`, `spansMidnight`)
- `entry-form`: Felder des Panels als Text, Prüfung `checkEntryForm`, `parseClock`
- `week-keyboard`: `blockKeyAction`, Tastendruck → Absicht
- `week-gesture`: `GestureController`, Zustandsautomat für Aufziehen, Verschieben, Dauer
  ändern (nutzt Angular-Signals)

Tags: `domain:week`, `type:domain`. Genutzt von `week/data-access`, `week/ui`, `week/feature`.
