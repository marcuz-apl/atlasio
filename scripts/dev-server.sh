#!/bin/sh
set -eu
export DATABASE_URL="${DATABASE_URL:-postgresql://atlasio:local-demo-only@localhost:5432/atlasio}"
export S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9090}"
export S3_BUCKET="${S3_BUCKET:-atlasio-originals}"
export S3_ACCESS_KEY="${S3_ACCESS_KEY:-local-demo}"
export S3_SECRET_KEY="${S3_SECRET_KEY:-local-demo}"
export ATLASIO_ADMIN_KEY="${ATLASIO_ADMIN_KEY:-admin-demo}"
export ATLASIO_DATAMGR_KEY="${ATLASIO_DATAMGR_KEY:-datamgr-demo}"
export ATLASIO_BACKUP_DIR="${ATLASIO_BACKUP_DIR:-$PWD/backups}"
export ATLASIO_DB_CONTAINER="${ATLASIO_DB_CONTAINER:-atlasio-db-1}"
export ATLASIO_PG_DUMP="${ATLASIO_PG_DUMP:-$PWD/scripts/pg-dump-docker.sh}"
export ATLASIO_PG_RESTORE="${ATLASIO_PG_RESTORE:-$PWD/scripts/pg-restore-docker.sh}"
exec cargo run -p atlasio-server
