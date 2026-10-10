#!/bin/sh
# Sauvegarde LAKOL : base (pg_dump, format custom) + fichiers envoyés (tar.gz).
#   backup.sh          une sauvegarde maintenant
#   backup.sh --loop   une sauvegarde par jour à BACKUP_HOUR (heure UTC, 2 par défaut)
# Rotation : 30 sauvegardes quotidiennes, 12 mensuelles (le 1er du mois).
# Copie hors serveur si BACKUP_S3_URI est défini (ex. s3://lakol-backups), avec
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (+ AWS_ENDPOINT_URL pour R2).
set -eu

DIR="${BACKUP_DIR:-/backups}"
STORAGE="${STORAGE_DIR:-/data/storage}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-30}"
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-12}"

log() { echo "{\"level\":\"info\",\"time\":\"$(date -u +%FT%TZ)\",\"msg\":\"$*\"}"; }

run_backup() {
  stamp="$(date -u +%Y%m%d-%H%M)"
  mkdir -p "$DIR/daily" "$DIR/monthly"
  db="$DIR/daily/lakol-db-$stamp.dump"
  files="$DIR/daily/lakol-files-$stamp.tar.gz"

  pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$db.tmp"
  mv "$db.tmp" "$db"
  if [ -d "$STORAGE" ]; then tar -czf "$files" -C "$STORAGE" .; fi
  log "sauvegarde créée : $(basename "$db") ($(du -h "$db" | cut -f1))"

  if [ "$(date -u +%d)" = "01" ]; then
    cp "$db" "$DIR/monthly/"
    [ -f "$files" ] && cp "$files" "$DIR/monthly/"
  fi

  # Rotation (les fichiers les plus récents sont conservés).
  ls -1t "$DIR"/daily/lakol-db-*.dump 2>/dev/null | tail -n +"$((KEEP_DAILY + 1))" | xargs -r rm -f
  ls -1t "$DIR"/daily/lakol-files-*.tar.gz 2>/dev/null | tail -n +"$((KEEP_DAILY + 1))" | xargs -r rm -f
  ls -1t "$DIR"/monthly/lakol-db-*.dump 2>/dev/null | tail -n +"$((KEEP_MONTHLY + 1))" | xargs -r rm -f
  ls -1t "$DIR"/monthly/lakol-files-*.tar.gz 2>/dev/null | tail -n +"$((KEEP_MONTHLY + 1))" | xargs -r rm -f

  if [ -n "${BACKUP_S3_URI:-}" ]; then
    aws s3 sync "$DIR" "$BACKUP_S3_URI" --only-show-errors ${AWS_ENDPOINT_URL:+--endpoint-url "$AWS_ENDPOINT_URL"}
    log "copie hors serveur : $BACKUP_S3_URI"
  fi
}

if [ "${1:-}" = "--loop" ]; then
  hour="${BACKUP_HOUR:-2}"
  log "sauvegardes quotidiennes à ${hour} h UTC"
  last=""
  while true; do
    today="$(date -u +%F)"
    if [ "$(date -u +%H | sed 's/^0//')" -ge "$hour" ] && [ "$last" != "$today" ]; then
      run_backup || log "ÉCHEC de la sauvegarde"
      last="$today"
    fi
    sleep 300
  done
else
  run_backup
fi
