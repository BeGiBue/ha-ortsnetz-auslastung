# Ortsnetz Map

**Version 2.0.0-beta.3 (Vorabversion)**

Home-Assistant-Integration mit Dashboard-Karte für die öffentlichen Messpunkte von [ortsnetz-auslastung.de](https://www.ortsnetz-auslastung.de/). Die Integration lädt die Daten serverseitig, speichert sie bedarfsgesteuert zwischen und liefert gleich die passende Karte mit. Backend und Card sind hier in **einem** HACS-Repository zusammengeführt.

Der Browser ruft die externe API nicht direkt auf, CORS ist kein Problem. Die Messdaten laufen ausschließlich über Home Assistant.

## Funktionen

**Karte**

- Standorte in der Nähe werden zu Clustern zusammengefasst; bei gemischten Status als Tortendiagramm. Ein Klick zoomt hinein.
- Markerfarbe nach dem schlechtesten Wert aller gemessenen Phasen (Unterspannung hat bei gleicher Schwere Vorrang). Nicht gemessene Phasen werden ignoriert. Schwellwerte und Farben kommen aus der API.
- Markergröße nach dem erwarteten PV-Ertrag in kWh/kWp/Tag (0–10), sofern ein Forecast vorliegt.
- Einklappbare Legende mit den Messungen der letzten 24 Stunden je Status; Häkchen blenden einzelne Status aus.
- Popup mit L1/L2/L3, Netzfrequenz, PV-Forecast und Zeitstempel sowie zwei 24-Stunden-Verläufen (Spannung und Frequenz). Gelbe und rote Hintergrundbereiche markieren Warnungen und kritische Werte.
- Veraltete Messungen (älter als 20 Minuten) werden transparent dargestellt.
- Dark Mode nach dem aktiven Home-Assistant-Theme, OpenFreeMap-Vektorkarte ohne API-Key, grafischer Karteneditor, Sections-Layout mit Full Width.

**Integration**

- Bedarfsgesteuerter Abruf: kein Abruf beim Start und kein Hintergrund-Polling. Daten werden nur geladen, wenn eine Karte sie anfordert.
- Cache von standardmäßig 5 Minuten; mehrere Karten und Browser teilen sich einen Abruf. Nach einem Fehler gilt standardmäßig 60 Sekunden Pause, bis dahin werden die zuletzt geladenen Daten ausgeliefert.
- Die Karte wird von der Integration selbst bereitgestellt und automatisch im Frontend geladen. Eine Dashboard-Ressource ist nicht nötig.
- Cache-Dauer und Pause nach Fehlern sind unter **Konfigurieren** einstellbar.

## Installation über HACS

[![Open your Home Assistant instance and open this repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=BeGiBue&repository=ha-ortsnetz-auslastung&category=integration)

1. In HACS **Benutzerdefinierte Repositories** öffnen.
2. `https://github.com/BeGiBue/ha-ortsnetz-auslastung` hinzufügen, Typ **Integration**.
3. **Ortsnetz Map** installieren (für Vorabversionen **⋮ → Beta-Versionen anzeigen**).
4. Home Assistant neu starten.
5. **Einstellungen → Geräte & Dienste → Integration hinzufügen → Ortsnetz Map**.
6. Browser bzw. App vollständig neu laden. Die Karte erscheint als **Ortsnetz Map** im Karten-Picker.

## Umstieg von den bisherigen Repositories

Bisher gab es zwei Repositories: *Home-Assistant-Ortsnetz-Map* (Backend) und *ortsnetz-map-card* (Card). Die Domain `ortsnetz_map` bleibt gleich, die Einrichtung und der WebSocket-Befehl `ortsnetz_map/get_points` ebenfalls.

1. In HACS das alte **Ortsnetz Map Backend** und die alte **Ortsnetz Map Card** entfernen.
2. Falls die Card von Hand als Dashboard-Ressource eingetragen war, den Eintrag unter **Einstellungen → Dashboards → Ressourcen** löschen.
3. Dieses Repository wie oben installieren und Home Assistant neu starten.
4. Browser bzw. App vollständig neu laden.

Die vorhandene Integration (Eintrag unter Geräte & Dienste) bleibt bestehen. Bestehende Dashboards mit `type: custom:ortsnetz-map-card` funktionieren weiter. Würde die alte Card parallel geladen, gewinnt die zuerst geladene Version; deshalb sollte sie entfernt werden.

## Card hinzufügen

Minimal-Konfiguration:

```yaml
type: custom:ortsnetz-map-card
```

| Option | Standard | Bedeutung |
|---|---|---|
| `zoom` | 10 | Start-Zoom (1–19) |
| `phase` | `auto` | `auto` = schlechtester Wert aller Phasen, oder `L1`, `L2`, `L3` |
| `refresh_interval` | 300 | Aktualisierung in Sekunden (60–3600), nur bei sichtbarem Tab |
| `show_status` | `true` | Statusanzeige unten links |
| `show_legend` | `true` | Legende unten rechts |
| `latitude`, `longitude` | HA-Standort | Eigener Kartenmittelpunkt |

Breite und Höhe werden ausschließlich über den Tab **Layout** von Home Assistant eingestellt.

## Einstellungen der Integration

Unter **Einstellungen → Geräte & Dienste → Ortsnetz Map → Konfigurieren**:

| Einstellung | Bereich | Standard | Wirkung |
|---|---|---|---|
| Cache-Dauer | 60–3600 s | 300 s | So lange werden Daten ohne neuen Abruf ausgeliefert |
| Pause nach Fehler | 30–600 s | 60 s | So lange wird nach einem fehlgeschlagenen Abruf kein neuer Versuch gestartet |

Nach dem Speichern lädt die Integration automatisch neu.

## Datenfluss

```text
ortsnetz-auslastung.de
  /v1/map/points · /v1/map/threshold-stats · /v1/map/sources/<id>/history
        ↓
Home Assistant: Ortsnetz Map (Cache, bedarfsgesteuert)
        ↓
authentifizierte HA WebSocket API
        ↓
Ortsnetz Map Card
```

## WebSocket API

| Befehl | Wirkung |
|---|---|
| `ortsnetz_map/get_points` | Messpunkte; zusätzlich `threshold_stats` (Messungen der letzten 24 Stunden je Status), falls verfügbar. Optional `refresh: true` ruft nur neu ab, wenn der Cache mindestens 60 Sekunden alt ist. |
| `ortsnetz_map/get_history` | 24-Stunden-Verlauf eines Standorts (`public_id`). Wird nur beim Öffnen eines Popups abgerufen und je Standort 5 Minuten zwischengespeichert. |

## Externe Bibliothek / Karte

- [MapLibre GL JS](https://maplibre.org/) 5.7.1 (BSD-3-Clause, Lizenz in `custom_components/ortsnetz_map/www/maplibre/LICENSE.txt`), wird mit der Integration ausgeliefert und von Home Assistant bereitgestellt
- [OpenFreeMap](https://openfreemap.org/)-Vektorkarten (Stile „Liberty“ und „Dark“) auf Basis von OpenStreetMap-Daten, geladen von `tiles.openfreemap.org`

Der Browser muss `tiles.openfreemap.org` erreichen können; ein externes CDN für MapLibre ist nicht mehr nötig. Die Messdaten selbst laufen ausschließlich über Home Assistant.

## Voraussetzungen

- Home Assistant 2026.6.0 oder neuer
- Internetzugriff des Home-Assistant-Servers auf `www.ortsnetz-auslastung.de`

## Hinweise

Dieses Projekt ist ein unabhängiges Community-Projekt und nicht Teil von `ortsnetz-auslastung.de`, OpenFreeMap / OpenStreetMap oder Home Assistant.

## Lizenz

GNU Affero General Public License v3.0 only (**AGPL-3.0-only**). Nutzung, Änderungen und Weitergabe sind unter den Bedingungen der AGPL erlaubt; abgeleitete Werke müssen unter derselben Lizenz stehen. Bei modifizierten Versionen, die über ein Netzwerk genutzt werden, muss der entsprechende Quellcode den Nutzern zugänglich gemacht werden. Details stehen in `LICENSE`.
