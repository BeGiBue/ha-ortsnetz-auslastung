# Changelog

## 2.0.2-beta.2 (Vorabversion)

**Verhaltensänderung – kooperative Gesten (Standard: an):** Ein Finger scrollt jetzt die Dashboard-Seite, auch wenn er auf der Karte liegt. Die Karte verschiebt und zoomt man mit zwei Fingern; am Computer zoomt das Mausrad nur mit gedrückter Strg-Taste (Mac: ⌘). Ein kurzer Hinweis erklärt das, wenn man es mit einem Finger versucht. Antippen von Punkten und Clustern funktioniert wie bisher, der Inhalt eines Popups lässt sich mit einem Finger scrollen. Wer das alte Verhalten möchte, setzt `cooperative_gestures: false` oder nimmt im Karteneditor das Häkchen bei „Zwei Finger zum Verschieben“ heraus.

Card:
- Drehen und Kippen der Karte sind gesperrt (Zwei-Finger-Drehung, Rechtsklick-Ziehen, Tastatur). Ohne Kompass ließ sich eine gedrehte Karte nicht zurücksetzen.
- Schlägt der Abruf der Messwerte fehl, versucht die Card es nach 15, 30 und 60 Sekunden erneut (nur bei sichtbarem Tab), danach wieder im normalen Intervall. Nach einer Wiederverbindung zu Home Assistant wird sofort abgerufen.
- „Lade Messwerte …“ erscheint nur noch beim ersten Laden. Scheitert später eine Aktualisierung, bleibt der letzte Stand sichtbar („Aktualisierung fehlgeschlagen, zeige Stand 09:40“).
- Änderungen der Konfiguration (z. B. im Dashboard-Editor) bauen die Karte nicht mehr neu auf: Zoom und Mittelpunkt verschieben nur die Kamera, Legende/Status/Diagnose werden ein- oder ausgeblendet, eine andere Phase zeichnet neu, das Intervall startet den Timer neu, die kooperativen Gesten werden an der laufenden Karte umgeschaltet. Unveränderte Konfigurationen werden ignoriert.
- Quellenangabe kompakt (nur das (i), klappt auf) und auch im Ersatzstil ohne Kartenhintergrund sichtbar.

Karteneditor:
- Leere oder ungültige Eingaben werden nicht mehr zu 0: Zoom und Intervall fallen auf den Standard zurück, Koordinaten behalten ihren bisherigen Wert.
- Zahlen werden auf die erlaubten Bereiche geklemmt (Zoom 1–19, Intervall 60–3600 s, Breitengrad ±90, Längengrad ±180).
- Standardwerte werden nicht mehr in die YAML geschrieben; nur Abweichungen stehen in der Konfiguration, unbekannte Schlüssel bleiben erhalten.

## 2.0.2-beta.1 (Vorabversion)

Card:
- Fix: Das Popup eines Messpunkts lag teilweise außerhalb der Karte, vor allem nachdem der 24-Stunden-Verlauf nachgeladen war, und war ohne Verschieben der Karte nicht ganz zu sehen. Jetzt:
  - Breite höchstens Kartenbreite − 24 px (maximal 320 px), die Diagramme passen sich an.
  - Höhe höchstens Kartenhöhe; längerer Inhalt scrollt im Popup, das Schließen-Kreuz bleibt sichtbar.
  - Nach dem Öffnen und nach dem Nachladen des Verlaufs verschiebt die Card die Karte, bis das Popup mit 12 px Rand sichtbar ist, nur wenn nötig und nie so weit, dass der angetippte Punkt aus dem Bild läuft. Hat man die Karte nach dem Öffnen selbst bewegt, wird nicht mehr verschoben.
  - Feste Ankerseite (in der oberen Kartenhälfte unter dem Punkt, sonst darüber), damit das Popup beim Wachsen nicht springt.
  - Das Popup liegt über Legende, Statuszeile und Zoom-Schaltflächen statt darunter.
- Fix: War der Kartenhintergrund nicht erreichbar (`tiles.openfreemap.org` gesperrt, z. B. per Pi-hole, offline oder App ohne Internet), blieb die Karte leer mit „Lade Messwerte …“. Ursache: Der Datenabruf wartete auf das MapLibre-Ereignis `load`, das nur bei erfolgreich geladenem Stil und Kacheln kommt. Jetzt:
  - Die Messwerte werden direkt nach dem Kartenaufbau abgerufen und gezeichnet, sobald ein Stil da ist.
  - Lädt der Stil nicht (Fehler oder nach 10 Sekunden), zeigt die Karte Punkte und Cluster auf einem neutralen Hintergrund (hell bzw. dunkel, ohne Zahl im Cluster). Der nächste Wechsel zwischen hellem und dunklem Theme versucht wieder den echten Stil.
  - Die Statuszeile erklärt das Problem in einer zweiten Zeile („Kartenhintergrund nicht erreichbar (tiles.openfreemap.org)“), entprellt und ohne Konsolenmeldung je Kachel. Lädt wieder eine Kachel, verschwindet der Hinweis.
- Fix: Beim Wechsel zwischen hellem und dunklem Theme konnte MapLibre den neuen Stil per Diff übernehmen, ohne dass die Card fehlende Layer ergänzte (z. B. die Zahl im Cluster, wenn nur der neue Stil Schriften hat). Der Stil wird jetzt immer vollständig neu geladen.

## 2.0.1

Behebt das Verschwinden von Punkten beim Herauszoomen (Companion-App, Safari auf dem iPad, aber auch Desktop-Browser).

Card:
- Cluster berechnet jetzt MapLibre selbst (`cluster: true`, Radius 45 px, zusammengefasst bis Zoom 11, ab Zoom 12 Einzelpunkte). Cluster sind vorerst einfarbige Kreise mit Anzahl, gefärbt nach dem schlechtesten enthaltenen Status (bei gleicher Schwere Unterspannung). Die Tortendiagramme kommen in 2.1.0 zurück; die Zähler je Status liegen dafür schon in den Clustern.
- Die eigene Cluster-Berechnung mit HTML-Markern entfällt und mit ihr die drei unten beschriebenen Fehler.
- Die Anzahl im Cluster nutzt die Schrift „Noto Sans Regular“ der OpenFreeMap-Stile und hängt an einer eigenen Quelle: Ist die Schrift nicht ladbar, fehlt nur die Zahl, Cluster und Einzelpunkte bleiben sichtbar. Stile ohne Glyphen erhalten Cluster ohne Zahl.
- Rendern hängt nicht mehr an `isStyleLoaded()`: Daten werden immer gemerkt und gezeichnet, sobald die Karte einen Stil hat; Quelle und Layer werden bei `style.load` (Start und Theme-Wechsel) bei Bedarf neu angelegt. `setData` nur noch, wenn sich die Daten geändert haben.
- Theme-Wechsel übernimmt alle eigenen Quellen und Layer in ihrer Reihenfolge.
- Klick auf einen Cluster zoomt so weit hinein, dass er sich aufteilt. Punkte und Cluster reagieren mit einem Treffbereich von 10 px um den Tippunkt (Touch).
- Ungültige Koordinaten (leer, Text, außerhalb des Wertebereichs, 0/0) werden übersprungen, auch beim Kartenmittelpunkt der Konfiguration (Rückfall auf den Home-Assistant-Standort).
- Diagnosezeile (`debug: true`) zeigt zusätzlich die Summe der Punkte in sichtbaren Clustern.

Test- und Diagnosegrundlage:

- Neue Option `debug: true` (Standard aus): Diagnosezeile oben links mit Zoom, gesetzten Punkten, Clustern und sichtbaren Einzelpunkten, z. B. für Screenshots vom iPad.
- Browser-Tests mit Playwright in Chromium und WebKit (`npm run test:browser`, eigener CI-Job): Karte mit lokal gebündeltem MapLibre, Minimalstil ohne Netz und 700 erzeugten Punkten; die Card liegt wie in Home Assistant in einem Shadow-Root. Invariante: Nach jedem Zoomen und Schwenken wird jeder aktivierte Punkt im Blickfeld genau einmal dargestellt, als Einzelpunkt oder in einem sichtbar platzierten Cluster.
- Ursache des Verschwindens beim Herauszoomen reproduziert (Chromium und WebKit):
  1. Die Cluster-Marker erhielten über `.ortsnetz-cluster { position:relative }` keine absolute Positionierung mehr (die Regel der Card überschreibt `.maplibregl-marker { position:absolute }`). Die Marker lagen im normalen Fluss untereinander: nur der erste saß richtig, jeder weitere war um die Höhe der vorherigen nach unten verschoben und wurde meist vom Kartenrand abgeschnitten. Das betrifft jede Ansicht unter Zoom 12 dauerhaft.
  2. Marker wurden nur im Sichtbereich plus 15 % Rand angelegt; in kleinen Karten ist der Rand schmaler als ein Cluster, Randpunkte fehlten bis zur nächsten Bewegung.
  3. Trafen die Daten ein, während Kartenkacheln luden (`isStyleLoaded()` false), verwarf `_renderPoints` sie still; die Karte blieb bis zum nächsten Abruf leer.
  Mit dem MapLibre-Clustering bestehen die Browser-Tests in Chromium und WebKit. Einzige erlaubte Ausnahme der Invariante ist der Randeffekt jedes Schwerpunkt-Clusterings: ein Punkt knapp im Blickfeld, dessen Cluster-Kreis vollständig außerhalb liegt.

## 2.0.0

Erste stabile Version der zusammengeführten Integration; entspricht 2.0.0-beta.3 mit folgenden Ergänzungen:

- Doku: Cache-Dauer gilt auch für Zähler und Verläufe (README, Texte der Einstellungen); `refresh: true` ist für eigene Clients gedacht; `get_history` beantwortet nur Standorte aus der Punktliste.
- CI: Tests laufen zusätzlich gegen die Mindestversion Home Assistant 2026.6; Testabhängigkeiten sind fest versioniert und werden per Dependabot aktualisiert; Actions auf Commit-SHAs festgelegt, nur Leserechte für Validate und Tests; der Release-Workflow prüft, dass Tag, `manifest.json`, `VERSION` und Card-Kopfzeile übereinstimmen.

## 2.0.0-beta.3 (Vorabversion)

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
