#!/bin/sh
# Restauration LAKOL (à lancer application arrêtée) :
#   restore.sh /backups/daily/lakol-db-AAAAMMJJ-HHMM.dump [/backups/daily/lakol-files-AAAAMMJJ-HHMM.tar.gz]
# Remplace le contenu de la base DATABASE_URL, puis restaure les fichiers dans STORAGE_DIR.
set -eu
db="${1:?chemin du fichier .dump}"
files="${2:-}"
STORAGE="${STORAGE_DIR:-/data/storage}"

pg_restore --clean --if-exists --no-owner --single-transaction --dbname="$DATABASE_URL" "$db"
echo "Base restaurée depuis $db"
if [ -n "$files" ]; then
  mkdir -p "$STORAGE"
  tar -xzf "$files" -C "$STORAGE"
  echo "Fichiers restaurés dans $STORAGE"
fi
