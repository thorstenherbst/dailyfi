# shared/util-browser

- `FileDownload`: bietet eine Datei im Browser zum Speichern an. Eigene Klasse, damit sich der
  CSV-Export testen lässt, ohne einen Download auszulösen (`URL.createObjectURL` fehlt in jsdom).

Tags: `domain:shared`, `type:util`. Nutzbar von jeder Schicht und Domäne. Heute genutzt von
`reports/feature`.
