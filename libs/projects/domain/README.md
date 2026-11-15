# projects/domain

Typen und reine Logik der Projektverwaltung.

- `project`: `Client`, `ProjectRecord`, `ClientDraft`, `ProjectDraft`
- `rate`: Stundensatz parsen und formatieren (`parseRate`, `formatRate`, `MAX_RATE`),
  Komma wie Punkt
- `project-colors`: `PROJECT_COLORS` mit Namen für die Farbwahl, `colorName`
- `project-form`: Felder der Inline-Zeilen, `checkClientForm`, `checkProjectForm`

Tags: `domain:projects`, `type:domain`. Genutzt von `projects/data-access`, `projects/ui`,
`projects/feature`.
