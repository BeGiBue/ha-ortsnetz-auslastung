# Ortsnetz Map 2.0.1

Behebt das Verschwinden von Punkten beim Herauszoomen.

Ursache: Die Cluster wurden von der Card selbst als HTML-Marker gezeichnet. Durch eine CSS-Regel der Card lagen diese Marker nicht an ihrer Kartenposition, sondern untereinander; die meisten wurden vom Kartenrand abgeschnitten. Dazu kamen fehlende Randpunkte in kleinen Karten und verworfene Daten, wenn sie eintrafen, während Kartenkacheln luden.

Neu:
- Cluster berechnet MapLibre selbst; bis Zoom 11 zusammengefasst, ab Zoom 12 Einzelpunkte.
- Cluster sind vorerst einfarbige Kreise mit Anzahl, gefärbt nach dem schlechtesten enthaltenen Status. Die Tortendiagramme kommen in 2.1.0 zurück.
- Klick auf einen Cluster zoomt hinein, bis er sich aufteilt; auf Touch-Geräten genügt ein Tipp bis 10 px neben einen Punkt.
- Ungültige Koordinaten werden übersprungen.
- Option `debug: true` zeigt eine Diagnosezeile (Zoom, Punkte, Cluster, Einzelpunkte), z. B. für Screenshots bei Fehlerberichten.

Nach dem Update in HACS Home Assistant neu starten und Browser bzw. App vollständig neu laden.
