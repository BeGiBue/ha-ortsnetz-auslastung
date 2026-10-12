# Übergabe: Ortsnetz Map, Phase 0 und Phase 1

Stand: 12.10.2026 · Repo: `BeGiBue/ha-ortsnetz-auslastung` · Ausgangsversion 2.0.0 · Zielversion 2.0.1

## 1. Kurzfassung

- **Ursache gefunden und behoben:** Beim Herauszoomen verschwanden Punkte dauerhaft, weil die Cluster-Marker durch eine CSS-Regel der Card nicht an ihrer Kartenposition lagen. Reproduziert in Chromium und WebKit, betrifft alle Browser, nicht nur das iPad.
- **Phase 1** ersetzt die eigene Cluster-Berechnung durch das eingebaute MapLibre-Clustering. Alle automatischen Tests sind grün, lokal und in der CI.
- **Offen:** Merge, Tag `v2.0.1` und die manuelle Abnahme auf iPad und Companion-App. Phase 2 und 3 beginnen erst nach Freigabe.

## 2. Stand der Pull Requests

| PR | Branch | Basis | Inhalt | CI |
|---|---|---|---|---|
| [#8](https://github.com/BeGiBue/ha-ortsnetz-auslastung/pull/8) | `phase-0/test-diagnose` | `main` | Phase 0: Test- und Diagnosegrundlage | alle 6 Checks grün, mergebar |
| [#9](https://github.com/BeGiBue/ha-ortsnetz-auslastung/pull/9) | `phase-1/maplibre-cluster` | `phase-0/test-diagnose` | Phase 1 / Release 2.0.1 | alle 6 Checks grün |

CI-Checks: Card (vitest), Card im Browser (Playwright, Chromium und WebKit), Pytest (HA 2026.6), Pytest (HA aktuell), Hassfest, HACS.

**Reihenfolge:** #8 mergen, dann bei #9 die Basis auf `main` umstellen und #9 mergen. Danach den Tag `v2.0.1` setzen. Der Release-Workflow prüft die Versionen und nimmt `RELEASE_NOTES_2.0.1.md` als Text.

Commits (älteste zuerst):

```
eedffc3 Card: Diagnosezeile mit debug: true, realistischere FakeMap          (Phase 0)
68fec27 Tests: Cluster-Invariante im Browser (Playwright, Chromium und WebKit) (Phase 0)
ccb73c8 Changelog: Ursachen des Verschwindens beim Herauszoomen dokumentiert   (Phase 0)
fa658cd Tests: MapLibre-Clustering, robustes Rendern, Koordinatenprüfung (rot)  (Phase 1)
611884b Card: MapLibre-Clustering statt eigener Cluster-Marker                 (Phase 1)
f778fe5 Browser-Tests für das MapLibre-Clustering                              (Phase 1)
7606d17 Version 2.0.1: Changelog, README, Release Notes                         (Phase 1)
```

## 3. Phase 0: Ergebnisse

### 3.1 Umgebung

- npm erreichbar, `npm ci && npm test` lief auf dem unveränderten Stand grün (15/15).
- `npx playwright install --with-deps webkit chromium` funktionierte. Lokal verwendet: Chromium 141, WebKit 26, beide mit WebGL2.
- `tiles.openfreemap.org` war aus der Sandbox gesperrt. Die Stile habe ich stattdessen im Quell-Repository geprüft (`hyperknot/openfreemap-styles`, `styles/liberty/style.json` und `styles/dark/style.json`). Beide enthalten `Noto Sans Regular`, `Noto Sans Bold` gibt es nur in Liberty. Glyphen-URL: `https://__TILEJSON_DOMAIN__/fonts/{fontstack}/{range}.pbf`, ausgeliefert als `tiles.openfreemap.org`.

### 3.2 Ursachen des Verschwindens (reproduziert in Chromium und WebKit)

1. **Hauptursache (CSS):** `.ortsnetz-cluster { position:relative }` überschreibt `.maplibregl-marker { position:absolute }`. Beide Regeln haben dieselbe Spezifität, und die Card-Regel steht später. Die Marker lagen deshalb im normalen Fluss untereinander. Nur der erste saß richtig, jeder weitere war um die Höhe der vorherigen nach unten verschoben und wurde meist abgeschnitten (`overflow:hidden`). Unter Zoom 12 betraf das jede Ansicht dauerhaft. Beispiel aus der Gesamtansicht: Von 700 Punkten waren nur 67 in einem korrekt platzierten Cluster plus 11 Einzelpunkte sichtbar.
2. **Randpunkte in kleinen Karten:** Marker entstanden nur im Sichtbereich plus 15 % Rand. Bei schmalen Karten ist dieser Rand kleiner als ein Cluster, Randpunkte fehlten bis zur nächsten Bewegung. Bestätigt, als nur Fehler 1 behoben war.
3. **K2:** Trafen die Daten ein, während Kacheln luden (`isStyleLoaded()` false), verwarf `_renderPoints` sie still. Die Karte blieb leer bis zum nächsten Abruf, also bis zu 5 Minuten. Bestätigt, als nur Fehler 1 behoben war.
4. **K1 (nur beobachtet, ohne eigenen Test):** Scheitern Kacheln, feuert `load` nie. Die Card lädt dann keine Daten, weil der Abruf an `load` hängt.

Verworfener Verdacht: In WebKit hing zunächst jede GeoJSON-Quelle (`_isUpdatingWorker` blieb true). Ursache war der Test-Harness: WebKit leitet auch `blob:`-URLs, also den MapLibre-Worker, durch `page.route`, und mein Catch-all-`abort()` brach sie ab. Mit dem echten Fehler hat das nichts zu tun. Der Harness lässt `blob:`/`data:` inzwischen durch.

### 3.3 Geliefert

- Option `debug: true` (Standard aus): Diagnosezeile oben links.
- FakeMap in `tests_js/card.test.js`:
  - `isStyleLoaded()` ist false nach `setData`/`setStyle`, bis `idle` feuert.
  - `once` entfernt den Handler nach dem ersten Aufruf, `fire` übergibt Argumente.
  - Ergänzt: `getStyle`, `easeTo`, `queryRenderedFeatures` (mit Layer-Filter), `getClusterExpansionZoom`, `setPaintProperty`, `getLayer`.
- Playwright als devDependency (`@playwright/test` 1.56.1), `playwright.config.js`, `tests_browser/`, CI-Job „Card im Browser“.

## 4. Phase 1: Ergebnisse (Version 2.0.1)

### 4.1 Card (`custom_components/ortsnetz_map/www/ortsnetz-map-card.js`)

- **Quelle** `ortsnetz-points`: `cluster: true`, `clusterRadius: 45`, `clusterMaxZoom: 11`. `clusterProperties`:
  - je Status ein Zähler (`crit_low`, `warn_low`, `normal`, `warn_high`, `crit_high`)
  - `worst: ["max", ["get","rank"]]`, mit `rank`: crit_low 4, crit_high 3, warn_low 2, warn_high 1, normal 0
- **Layer** von unten nach oben:
  1. `ortsnetz-clusters`: Kreis, Farbe per `match` auf `worst` aus `this._colors`, 28–72 px Durchmesser, weißer Rand.
  2. `ortsnetz-cluster-count`: Symbol mit `point_count_abbreviated` und `Noto Sans Regular`. Nur, wenn der Stil `glyphs` hat.
  3. `ortsnetz-points`: Einzelpunkte, unverändert (Radius nach Forecast, Transparenz bei veralteten Werten).
- **Abweichung vom Arbeitspaket:** Der Zähler-Layer hängt an einer **zweiten, gleich konfigurierten Quelle** `ortsnetz-cluster-labels` mit denselben Daten. Grund: Kann MapLibre eine Schrift nicht laden, verwirft es die ganze Kachel der Quelle, also auch Kreise und Einzelpunkte. Mit der eigenen Quelle fehlt dann nur die Zahl. Supercluster rechnet deterministisch, die Cluster beider Quellen sind identisch. Kosten: ein zusätzliches `setData`.
- **Entfernt:** `_computeClusters`, `_updateClusters`, `_clusterMarkers`, `_clusterElement`, `_clearClusterMarkers`, der `moveend`-Handler, die CSS für `.ortsnetz-cluster` und die zugehörigen Tests.
- **Robustes Rendern (K2):**
  - Kein Abbruch über `isStyleLoaded()`.
  - `_renderPoints` merkt Features und Hash immer.
  - `_ensureSource()` legt Quellen und Layer an, sobald `getStyle()` existiert. Der Aufruf ist in try/catch, sonst übernimmt `style.load`.
  - `_syncSource()` ruft `setData` nur bei geändertem Hash auf (cyrb53 über alle Feature-Eigenschaften) und aktualisiert die Clusterfarbe per `setPaintProperty`, wenn sich die API-Farben ändern.
- **Theme-Wechsel:** `keepOwnLayers` übernimmt alle eigenen Quellen und Layer in ihrer Reihenfolge. Hat der neue Stil keine Glyphen, entfallen Zähler-Layer und -Quelle. Kein `once("idle")` mehr.
- **Interaktion:**
  - Ein `click`-Handler auf der Karte. `_featureAt` fragt eine 10-px-Box ab, es gewinnt der Treffer mit dem nächstgelegenen Rand.
  - Cluster: `getClusterExpansionZoom` → `easeTo`. Einzelpunkt: Popup wie bisher.
  - Cursor `pointer` über `mousemove`.
- **K5:** `toCoordinate()` (per `toNumber`, endlich, |lat| ≤ 90, |lng| ≤ 180, nicht beide 0). Gilt für Punkte und für den Kartenmittelpunkt der Konfiguration (`_initialCenter()`, Rückfall auf den HA-Standort, zuletzt Deutschland-Mitte).
- **Diagnosezeile:** `Zoom 8,4 · 312 Punkte gesetzt · 40 Cluster (290 Punkte) · 12 Einzel sichtbar`. Zählt eindeutige `cluster_id`/`public_id` aus `queryRenderedFeatures` und wird bei `idle` aktualisiert. Die Klammer mit der Punktsumme der Cluster ist eine Ergänzung zum vorgegebenen Format.
- Weiter an `load` gekoppelt: der erste Datenabruf (`_loadMeasurements`) und `_mapLoaded`. Das ist Teil von K1.

### 4.2 Doku und Versionen

- `manifest.json`, `VERSION` und die erste Card-Zeile stehen auf **2.0.1**. Der Git-Tag fehlt noch.
- `CHANGELOG.md`: Abschnitt 2.0.1 mit Phase-1-Änderungen und den Ursachen aus Phase 0.
- `README.md`: Version, Cluster-Beschreibung, Treffbereich, Optionen `debug` und Koordinaten-Rückfall, neuer Abschnitt „Entwicklung“.
- `RELEASE_NOTES_2.0.1.md` neu.

## 5. Tests

| Suite | Befehl | Stand |
|---|---|---|
| Card (jsdom) | `npm test` | 32/32 grün |
| Browser | `npm run test:browser` | 24/24 grün in Chromium und WebKit; mit `--repeat-each=3` 72/72 |
| Backend | `python -m pytest -q` | nur in der CI ausgeführt (grün); lokal fehlte Home Assistant. Das Backend ist bis auf die Version unverändert |

### 5.1 Browser-Harness (`tests_browser/harness.js`)

- Feste Origin `http://ortsnetz.test`, alles über `page.route`: Card und MapLibre aus dem Repo, die OpenFreeMap-Stil-URLs liefern einen Minimalstil, alle anderen Anfragen werden abgebrochen. `blob:`/`data:` laufen durch (WebKit-Worker).
- Heller Stil mit `glyphs` (leere, gültige PBF-Antwort), dunkler Stil ohne `glyphs`. So kommen beide Zähler-Pfade vor.
- Die Card liegt wie in Home Assistant in einem **Shadow-Root**. Ohne das wäre der CSS-Fehler nicht aufgefallen.
- 700 deterministische Punkte (mulberry32, Seed 42): sechs dichte Städte, Streuung über Deutschland, zehn Punkte mit identischen Koordinaten, gemischte Status.
- Optionen von `openCard`:
  - `tileDelay`: Rasterkacheln mit Verzögerung, simuliert langsames Netz
  - `holdData`: Daten erst nach `window.__releaseData()`
  - `glyphsFail`: Schrift liefert 404
- `waitIdle` wartet auf eine geladene, ruhige Karte (zwei ruhige Frames), nicht auf das `idle`-Ereignis. Kacheln, die mit Fehler enden, lösen keinen neuen Frame und damit kein `idle` aus.

### 5.2 Invariante

Nach jedem Zoomen oder Schwenken wird jeder aktivierte Punkt im Blickfeld **genau einmal** dargestellt, als Einzelpunkt oder als Blatt (`getClusterLeaves`) eines gerenderten Clusters. Einzige erlaubte Ausnahme ist der Randeffekt jedes Schwerpunkt-Clusterings: ein Punkt knapp im Blickfeld, dessen Cluster-Kreis vollständig außerhalb der Karte liegt. Das prüft ein echter Kreis-Rechteck-Schnitt. Für HTML-Marker (alter Pfad) zählt ein Marker nur, wenn er sichtbar an seiner Kartenposition sitzt.

Die Summenformel aus dem Arbeitspaket („Summe point_count + Einzelpunkte = Punkte im Blickfeld“) gilt an den Rändern nicht exakt, weil Randcluster auch Punkte außerhalb enthalten. Deshalb diese präzisere Fassung.

Gegenprobe: Gegen die Card aus Phase 0 schlägt die Invariante weiter fehl, sie verdeckt den echten Fehler also nicht.

### 5.3 Testfälle im Browser (je Chromium und WebKit)

- Große (900×650) und kleine (380×300) Karte: `zoomTo` 12 → 5 → 12 dreimal (sprunghaft und animiert), Mausrad raus/rein, `fitBounds` mit Schwenken
- Legendenfilter und Theme-Wechsel hell → dunkel mit anschließendem Zoomen
- Diagnosezeile entspricht den gerenderten Zahlen
- Daten kommen während laufender Kachelladungen
- Schrift nicht ladbar: alle Punkte bleiben sichtbar
- Zähler je Status und `worst` passen zu den Punkten jedes Clusters
- Klick auf einen Cluster zoomt hinein; ein Tipp 9 px neben einen Einzelpunkt öffnet das Popup

### 5.4 Lokal ausführen

```bash
npm ci
npm test
npx playwright install --with-deps webkit chromium
npm run test:browser
```

Hinweis für Cloud-Sandboxen: Das vorinstallierte Chromium in `/opt/pw-browsers` enthält kein WebKit. Ich habe die Browser nach `$HOME/pw-test-browsers` installiert und mit `PLAYWRIGHT_BROWSERS_PATH=$HOME/pw-test-browsers` gestartet.

## 6. Nicht geprüft

- Echtes iPad (Safari) und Companion-App (iOS/Android).
- Echte OpenFreeMap-Stile, -Kacheln und -Schriften (aus der Sandbox gesperrt). Die Schriftnamen stammen aus den Stildateien des Quell-Repositorys.
- pytest lokal (in der CI grün).

## 7. Offen beim Eigentümer

1. #8 mergen, Basis von #9 auf `main` umstellen, #9 mergen, Tag `v2.0.1` setzen.
2. **Abnahme Phase 1** auf dem iPad (Safari) und in der Companion-App, je 10 Durchgänge: Zoom 14 → 5 → 14, Schwenken, hell/dunkel, Legendenfilter. Erwartung: Alle Punkte bleiben sichtbar, und die Cluster zeigen Zahlen (sonst lädt die Schrift nicht). Bei Auffälligkeiten mit `debug: true` einen Screenshot schicken.
3. Entscheidungen für später:
   - Kooperative Gesten (K7)
   - Standardhöhe außerhalb von Sections (K3)
   - Tortendiagramm-Variante nach dem Spike (Phase 2)
4. Freigabe für Phase 2 und Phase 3.

## 8. Hinweise für die nächsten Phasen

### Phase 2 (Tortendiagramme, Ziel 2.1.0)

- Die Zähler je Status sind schon `clusterProperties`. Die Torten lassen sich direkt aus `feature.properties.crit_low` usw. bauen.
- **HTML-Marker dürfen nie eine eigene `position` bekommen.** Das war die Ursache in 2.0.0. Die Invariante prüft die sichtbare Markerposition. Für Torten-Marker den Zweig für HTML-Marker in `representation()` (`harness.js`) wieder aktivieren, nach `cluster_id` statt `_clusterMarkers`.
- Rückfallebene: Die Layer `ortsnetz-clusters` und `ortsnetz-cluster-count` bleiben. Ob Cluster-Layer mit Deckkraft 0 abfragbar bleiben, ist noch zu klären (Spike A).
- Die Zähler-Quelle `ortsnetz-cluster-labels` kann entfallen, wenn die Torten den Zähler als HTML zeigen.

### Phase 3 (Reihenfolge laut Arbeitspaket: K3, K7, K1, dann K6, K9+I2, I1, K8, K10, Rest)

- **K1:** `load` feuert nie, wenn Kacheln scheitern. `_loadMeasurements` sollte direkt nach dem Kartenaufbau starten, `_mapLoaded` in `_handleVisibility` und im Timer entsprechend anpassen. Testbar mit `tileDelay` und mit Kachel-404 im Harness.
- K7: Der Treffbereich (10 px) ist schon umgesetzt. Offen sind `dragRotate`, `pitchWithRotate`, `touchZoomRotate.disableRotation()` und die Option `cooperative_gestures`.
- I4: Hassfest war in der CI für #8 und #9 grün, eine Ergänzung von `dependencies` ist derzeit nicht nötig.

### Nicht anfassen (Abschnitt 9 des Arbeitspakets)

Backend-Cache samt Tests, Absicherung von `get_history`, `escapeHtml`/`safeColor` und die XSS-Tests, `_generation`/`_loadRequest`, Theme-Wechsel über `transformStyle` (nur verallgemeinert), gebündeltes MapLibre 5.7.1, Versions-Query der Card-URL, `async_remove_entry`, Release-Workflow und gepinnte Action-SHAs. In Phase 0 und 1 blieb all das unverändert. `keepOwnLayer` wurde wie vorgesehen zu `keepOwnLayers` verallgemeinert.
