# Ortsnetz Map 2.0.2

Behebt zwei Fehler der Karte.

**Popup außerhalb der Karte:** Das Popup eines Messpunkts lag teilweise außerhalb der Karte, vor allem nachdem der 24-Stunden-Verlauf geladen war. Jetzt passt es sich der Kartengröße an, längerer Inhalt scrollt (das Schließen-Kreuz bleibt sichtbar), und die Karte verschiebt sich bei Bedarf so, dass das Popup ganz zu sehen ist. Hat man die Karte selbst bewegt, verschiebt sie sich nicht mehr. Das Popup liegt über Legende und Statuszeile.

**Leere Karte ohne Kartenhintergrund:** War `tiles.openfreemap.org` nicht erreichbar (z. B. Pi-hole, offline, App ohne Internet), blieb die Karte leer. Jetzt erscheinen die Messpunkte auf einem neutralen Hintergrund, und die Statuszeile nennt das Problem. Der nächste Wechsel zwischen hellem und dunklem Theme versucht wieder die richtige Karte.

Nach dem Update in HACS Home Assistant neu starten und Browser bzw. App vollständig neu laden.
