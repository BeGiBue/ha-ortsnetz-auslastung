"""Constants for Ortsnetz Map."""

DOMAIN = "ortsnetz_map"

# Dashboard-Card: wird von der Integration selbst ausgeliefert und im Frontend geladen.
CARD_URL_PATH = "/ortsnetz_map/ortsnetz-map-card.js"
DATA_CARD_REGISTERED = f"{DOMAIN}_card_registered"
DATA_STATIC_PATHS_REGISTERED = f"{DOMAIN}_static_paths_registered"
# MapLibre GL wird mit der Integration ausgeliefert (kein externes CDN).
MAPLIBRE_URL_PATH = "/ortsnetz_map/maplibre"
API_URL = "https://www.ortsnetz-auslastung.de/v1/map/points"
# Zähler der letzten 24 Stunden je Spannungsstatus (für die Legende der Card).
STATS_URL = "https://www.ortsnetz-auslastung.de/v1/map/threshold-stats?phase=overall"
# Verlauf der letzten 24 Stunden eines Standorts (public_id aus der Punktliste).
HISTORY_URL_TEMPLATE = "https://www.ortsnetz-auslastung.de/v1/map/sources/{public_id}/history"
# Erlaubtes Format einer public_id; verhindert, dass beliebige Pfade angefragt werden.
HISTORY_ID_PATTERN = r"^[A-Za-z0-9_-]{8,64}\Z"
# So viele Verläufe werden höchstens zwischengespeichert.
HISTORY_CACHE_MAX_ENTRIES = 50

# Daten werden nur noch bei Bedarf (Card-Anfrage) geladen. Ein Cache-Eintrag
# gilt so lange als frisch; in dieser Zeit wird die externe API nicht erneut
# angefragt, egal wie viele Cards/Clients gleichzeitig offen sind.
CACHE_MAX_AGE_SECONDS = 300

# Untergrenze für ein explizit angefordertes Refresh ("refresh": true).
FORCED_REFRESH_MIN_AGE_SECONDS = 60

# Nach einem fehlgeschlagenen Abruf wird frühestens nach dieser Zeit erneut
# versucht, damit ein Ausfall der API nicht bei jeder Anfrage durchschlägt.
RETRY_AFTER_ERROR_SECONDS = 60

REQUEST_TIMEOUT_SECONDS = 30

# Options (Einstellungen → Geräte & Dienste → Ortsnetz Map → Konfigurieren)
CONF_CACHE_MAX_AGE = "cache_max_age"
CONF_RETRY_AFTER_ERROR = "retry_after_error"
CACHE_MAX_AGE_RANGE = (60, 3600)
RETRY_AFTER_ERROR_RANGE = (30, 600)
