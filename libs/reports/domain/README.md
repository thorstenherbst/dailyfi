# reports/domain

Reine Rechnung der Auswertung, ohne Angular und ohne Supabase.

- `report-model`: `buildMonthReport`, `formatAmount`; Rundungsregeln im Kopfkommentar
- `month`: `MonthKey` und Monatsgrenzen in Berliner Zeit (`monthRange`, `shiftMonth`, …)
- `csv`: `buildCsv` (eine Zeile je Eintrag), `csvFilename`

Tags: `domain:reports`, `type:domain`. Genutzt von `reports/data-access`, `reports/feature`.
