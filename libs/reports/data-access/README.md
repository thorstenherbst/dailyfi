# reports/data-access

Datenzugriff und Zustand der Auswertung.

- `ReportRepository`: Zeiteinträge eines Monats mit Projekt und Kunde. Archiviertes wird
  ausdrücklich nicht gefiltert.
- `ReportsStore`: hält die Einträge des gewählten Monats und leitet den Bericht über
  `reports/domain` ab.

Tags: `domain:reports`, `type:data-access`. Genutzt von `reports/feature`.
