# Ortsnetz Map 2.0.2

Behebt zwei Fehler der Karte.

**Popup außerhalb der Karte:** Das Popup eines Messpunkts lag teilweise außerhalb der Karte, vor allem nachdem der 24-Stunden-Verlauf geladen war. Jetzt passt es sich der Kartengröße an, längerer Inhalt scrollt (das Schließen-Kreuz bleibt sichtbar), und die Karte verschiebt sich bei Bedarf so, dass das Popup ganz zu sehen ist. Hat man die Karte selbst bewegt, verschiebt sie sich nicht mehr. Das Popup liegt über Legende und Statuszeile.

**Leere Karte ohne Kartenhintergrund:** War `tiles.openfreemap.org` nicht erreichbar (z. B. Pi-hole, offline, App ohne Internet), blieb die Karte leer. Jetzt erscheinen die Messpunkte auf einem neutralen Hintergrund, und die Statuszeile nennt das Problem. Der nächste Wechsel zwischen hellem und dunklem Theme versucht wieder die richtige Karte.

**Verhaltensänderung – kooperative Gesten:** Ein Finger scrollt jetzt die Dashboard-Seite, auch über der Karte. Die Karte bewegt und zoomt man mit zwei Fingern, am Computer zoomt das Mausrad nur mit Strg (Mac: ⌘). Antippen von Punkten und Clustern funktioniert wie bisher. Abschalten: `cooperative_gestures: false` in der Card-Konfiguration oder das Häkchen „Zwei Finger zum Verschieben“ im Karteneditor entfernen.

**Weitere Änderungen:** Die Karte lässt sich nicht mehr drehen oder kippen. Schlägt ein Abruf fehl, versucht die Card es nach 15, 30 und 60 Sekunden erneut, zeigt bis dahin den letzten Stand und ruft nach einer Wiederverbindung zu Home Assistant sofort ab. Änderungen im Karteneditor bauen die Karte nicht mehr neu auf; der Editor schreibt nur noch abweichende, gültige Werte in die Konfiguration (keine Nullen bei leeren Feldern). Die Quellenangabe ist kompakt.

Nach dem Update in HACS Home Assistant neu starten und Browser bzw. App vollständig neu laden.
