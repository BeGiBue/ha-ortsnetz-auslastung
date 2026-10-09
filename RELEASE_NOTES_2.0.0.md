# Ortsnetz Map 2.0.0

Backend und Dashboard-Card sind jetzt **eine** Integration. Diese Version fasst alle Vorabversionen 2.0.0-beta.1 bis beta.3 zusammen.

Neu gegenüber den bisherigen Einzel-Repositories:
- Die Card wird von der Integration mitgeliefert und automatisch geladen; eine Dashboard-Ressource ist nicht mehr nötig.
- Darstellung wie auf ortsnetz-auslastung.de: Cluster mit Tortendiagrammen, Farbe nach schlechtestem Phasenwert, Größe nach PV-Ertrag, Legende mit Messungen der letzten 24 Stunden.
- Popup mit PV-Forecast und 24-Stunden-Verläufen für Spannung und Frequenz.
- MapLibre GL wird mit der Integration ausgeliefert, ein externes CDN ist nicht nötig.
- Werte der externen API gelangen nur geprüft in die Anzeige.
- Stabiler Theme-Wechsel, Karteneditor ohne Eingabeverluste, verständliche Fehlermeldungen.
- Bedarfsgesteuerter Abruf mit Cache wie bisher; Verläufe werden je Standort abgerufen und zwischengespeichert.

Umstieg: alte Backend- und Card-Repositories in HACS entfernen, ggf. die Dashboard-Ressource löschen, dieses Repository installieren, Home Assistant neu starten und den Browser vollständig neu laden. Domain, Einrichtung und bestehende Dashboards bleiben erhalten. Wer bereits eine Beta installiert hat, aktualisiert einfach in HACS.

Voraussetzung: Home Assistant 2026.6 oder neuer. Details in README und CHANGELOG.
