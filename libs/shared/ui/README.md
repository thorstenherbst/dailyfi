# shared/ui

App-Rahmen und domänenneutrale Bausteine.

- Rahmen: `NavMenu` (Rund-Menü), `StatusBar`, `ShellStatus`/`publishShellStatus` (Seiten melden
  KW, Summen und Sync-Status an die Statusleiste), `Wordmark`
- Rückmeldung: `ToastService`, `ToastRegion`
- Modals: `WarnDialog` (Lösch-Warnung), `SessionExpiredDialog`
- Sonstiges: `Icon`, `Tooltip` (`[appTooltip]`), `LoadError`

Tags: `domain:shared`, `type:ui`. Nutzbar von `type:feature`, `type:ui` und der App, aus jeder
Domäne.
