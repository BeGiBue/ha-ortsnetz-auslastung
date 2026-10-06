# Ortsnetz Map 2.0.0-beta.2 (Vorabversion)

Backend und Dashboard-Card sind jetzt **eine** Integration. Installation in HACS über **⋮ → Beta-Versionen anzeigen**.

Neu:

- Die Card wird von der Integration mitgeliefert und automatisch geladen.
- Darstellung wie auf ortsnetz-auslastung.de: Cluster mit Tortendiagrammen, Farbe nach schlechtestem Phasenwert, Größe nach PV-Ertrag, Legende mit Messungen der letzten 24 Stunden.
- Popup mit 24-Stunden-Verläufen für Spannung und Frequenz.

Umstieg: alte Backend- und Card-Repositories in HACS entfernen, ggf. die Dashboard-Ressource löschen, dieses Repository installieren, Home Assistant neu starten und den Browser vollständig neu laden. Domain, Einrichtung und bestehende Dashboards bleiben erhalten. Details in der README.

Änderung gegenüber beta.1: Beim Herauszoomen verschwinden keine Punkte mehr in dichten Gebieten.
