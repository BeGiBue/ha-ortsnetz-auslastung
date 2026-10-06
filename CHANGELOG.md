# Changelog

## 2.0.0-beta.1 (Vorabversion)

Zusammenführung von *Home-Assistant-Ortsnetz-Map* (Backend, zuletzt 1.1.0-beta.2) und *ortsnetz-map-card* (Card, zuletzt 1.0.3-beta.1) in einer Integration.

- Die Integration liefert die Dashboard-Card selbst aus und lädt sie automatisch im Frontend; eine Dashboard-Ressource ist nicht mehr nötig.
- Neue Darstellung nach ortsnetz-auslastung.de: Cluster mit Tortendiagrammen, Markerfarbe nach dem schlechtesten Wert aller Phasen, Markergröße nach PV-Ertrag, einklappbare Legende mit Filter.
- Legende mit den Messungen der letzten 24 Stunden je Status (`threshold_stats` in `ortsnetz_map/get_points`, Quelle `/v1/map/threshold-stats`; eigener, optionaler Cache).
- Popup mit PV-Forecast und zwei 24-Stunden-Verläufen (Spannung, Frequenz). Neuer WebSocket-Befehl `ortsnetz_map/get_history`, nur beim Öffnen eines Popups abgerufen, Cache je Standort.
- Schwellwerte und Farben kommen aus der API.
- Unverändert: Domain `ortsnetz_map`, Einrichtung, Optionen, bedarfsgesteuerter Abruf mit 5-Minuten-Cache, `ortsnetz_map/get_points` und dessen bisheriges Antwortformat.

Frühere Versionen der beiden Einzel-Repositories: siehe deren jeweilige Changelogs.
