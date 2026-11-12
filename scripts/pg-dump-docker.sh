#!/bin/sh
# Development adapter: run pg_dump inside the Postgres container because the
# host does not install PostgreSQL client tools. Production deployments should
# set ATLASIO_PG_DUMP to the real pg_dump binary instead.
set -eu

container="${ATLASIO_DB_CONTAINER:-atlasio-db-1}"
user="${ATLASIO_DB_USER:-atlasio}"
db="${ATLASIO_DB_NAME:-atlasio}"
file=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --file) file="${2:-}"; shift 2 ;;
    --file=*) file="${1#--file=}"; shift ;;
    *) shift ;;
  esac
done

if [ -z "$file" ]; then
  echo "pg-dump-docker: --file is required" >&2
  exit 2
fi

docker exec "$container" pg_dump -U "$user" -d "$db" -Fc > "$file"
