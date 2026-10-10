# Sauvegardes : pg_dump quotidien, archive des fichiers, rotation, copie S3 facultative.
FROM postgres:16-alpine
RUN apk add --no-cache aws-cli tzdata
COPY backup.sh restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh
CMD ["/usr/local/bin/backup.sh", "--loop"]
