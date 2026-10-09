# Changelog

## Unreleased

Behebt die Befunde aus zwei Code-Reviews.

Card:
- Sicherheit: Werte der externen API (Farben, Zähler, Schwellwerte) gelangen nur noch geprüft bzw. escaped in die Anzeige; ungültige Farben werden durch die Standardfarben ersetzt.
- MapLibre GL 5.7.1 wird mit der Integration ausgeliefert statt zur Laufzeit von unpkg.com geladen.
- Fix: Wurde die Card während des Ladens von MapLibre entfernt oder neu aufgebaut, blieben eine zweite Karte und ein dauerhaft laufender Abruf-Timer zurück.
- Fix: Beim Wechsel zwischen hellem und dunklem Theme verschwanden die Einzelpunkte bis zum nächsten Abruf.
- Fix: Der Karteneditor verlor Eingaben, weil er bei jedem Zustandswechsel in Home Assistant neu aufgebaut wurde.
- Einzelpunkte ab Zoom 12 (vorher erst ab 13); Cluster werden bei geänderten Farben neu gezeichnet.
- Ladefehler von MapLibre werden verständlich gemeldet und beim nächsten Versuch erneut geladen; überholte Antworten werden verworfen.
- Eigene Statusmeldungen für „keine Daten von der API“ und „Integration nicht eingerichtet“.
- `stale` als Text („false“) wird richtig ausgewertet; Markergröße und Popup lesen den PV-Forecast aus denselben Feldern.

Backend:
- Verläufe: Lock je Standort, sodass ein langsamer Standort andere Popups nicht mehr aufhält; Cache-Treffer ohne Wartezeit.
- `ortsnetz_map/get_history` beantwortet nur noch Standorte aus der aktuellen Punktliste (sonst Fehler `not_found`).
- Netzabrufe geben die Verbindung auch bei Timeout sauber frei.
- `entry.runtime_data` statt `hass.data`, `ConfigFlowResult`; `strings.json` ist jetzt die englische Quelle.
- Wird die Integration entfernt, lädt das Frontend die Card nicht mehr; Fehler beim Eintragen der Card führen nicht mehr zu doppelt registrierten Pfaden.

Tests:
- Neue Backend-Tests für Verläufe, unbekannte Standorte und die Card-Registrierung.
- Erste Tests für die Card (vitest/jsdom, `npm test`) und ein eigener CI-Job dafür.

## 2.0.0-beta.2 (Vorabversion)

- Fix: Beim Herauszoomen verschwanden Punkte in dichten Gebieten. Die Cluster werden jetzt von der Card selbst aus allen Messpunkten berechnet, statt aus den geladenen Kartenkacheln gelesen zu werden.

## 2.0.0-beta.1 (Vorabversion)

Zusammenführung von *Home-Assistant-Ortsnetz-Map* (Backend, zuletzt 1.1.0-beta.2) und *ortsnetz-map-card* (Card, zuletzt 1.0.3-beta.1) in einer Integration.

- Die Integration liefert die Dashboard-Card selbst aus und lädt sie automatisch im Frontend; eine Dashboard-Ressource ist nicht mehr nötig.
- Neue Darstellung nach ortsnetz-auslastung.de: Cluster mit Tortendiagrammen, Markerfarbe nach dem schlechtesten Wert aller Phasen, Markergröße nach PV-Ertrag, einklappbare Legende mit Filter.
- Legende mit den Messungen der letzten 24 Stunden je Status (`threshold_stats` in `ortsnetz_map/get_points`, Quelle `/v1/map/threshold-stats`; eigener, optionaler Cache).
- Popup mit PV-Forecast und zwei 24-Stunden-Verläufen (Spannung, Frequenz). Neuer WebSocket-Befehl `ortsnetz_map/get_history`, nur beim Öffnen eines Popups abgerufen, Cache je Standort.
- Schwellwerte und Farben kommen aus der API.
- Unverändert: Domain `ortsnetz_map`, Einrichtung, Optionen, bedarfsgesteuerter Abruf mit 5-Minuten-Cache, `ortsnetz_map/get_points` und dessen bisheriges Antwortformat.

Frühere Versionen der beiden Einzel-Repositories: siehe deren jeweilige Changelogs.
