# Ortsnetz Map 2.0.0-beta.3 (Vorabversion)

Behebt die Befunde aus zwei Code-Reviews. Installation in HACS über **⋮ → Beta-Versionen anzeigen**, danach Home Assistant neu starten und den Browser vollständig neu laden.

Card:
- Sicherheit: Werte der externen API (Farben, Zähler, Schwellwerte) gelangen nur noch geprüft in die Anzeige.
- MapLibre GL wird mit der Integration ausgeliefert, ein externes CDN (unpkg.com) ist nicht mehr nötig.
- Beim Wechsel zwischen hellem und dunklem Theme bleiben die Punkte sichtbar.
- Der Karteneditor verliert keine Eingaben mehr.
- Kein doppelter Kartenaufbau und kein verwaister Abruf-Timer mehr, wenn die Card während des Ladens entfernt wird.
- Einzelpunkte ab Zoom 12, verständlichere Fehlermeldungen.

Backend:
- Ein langsamer Standort hält Verläufe anderer Standorte nicht mehr auf.
- Verläufe gibt es nur noch für Standorte aus der aktuellen Punktliste.
- Wird die Integration entfernt, lädt das Frontend die Card nicht mehr.

Details im CHANGELOG.
