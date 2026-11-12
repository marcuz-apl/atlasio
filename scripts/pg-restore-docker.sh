#!/bin/sh
# Development adapter: restore a pg_dump archive inside the Postgres container.
# Production deployments should set ATLASIO_PG_RESTORE to the real pg_restore.
set -eu

container="${ATLASIO_DB_CONTAINER:-atlasio-db-1}"
user="${ATLASIO_DB_USER:-atlasio}"
default_db="${ATLASIO_DB_NAME:-atlasio}"
db="$default_db"
dump=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dbname) db="${2:-$default_db}"; db="${db##*/}"; shift 2 ;;
    --dbname=*) db="${1#--dbname=}"; db="${db##*/}"; shift ;;
    --clean|--if-exists|--no-owner|--no-privileges) shift ;;
    --*) shift ;;
    *) dump="$1"; shift ;;
  esac
done

if [ -z "$dump" ]; then
  echo "pg-restore-docker: archive path is required" >&2
  exit 2
fi

remote="/tmp/atlasio-restore-$$.dump"
docker cp "$dump" "$container:$remote" >/dev/null
trap 'docker exec "$container" rm -f "$remote" >/dev/null 2>&1 || true' EXIT
docker exec "$container" pg_restore -U "$user" -d "$db" --clean --if-exists --no-owner --no-privileges "$remote"
