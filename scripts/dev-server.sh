#!/bin/sh
set -eu
export DATABASE_URL="${DATABASE_URL:-postgresql://atlasio:local-demo-only@localhost:5432/atlasio}"
export S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9090}"
export S3_BUCKET="${S3_BUCKET:-atlasio-originals}"
export S3_ACCESS_KEY="${S3_ACCESS_KEY:-local-demo}"
export S3_SECRET_KEY="${S3_SECRET_KEY:-local-demo}"
export ATLASIO_IMPORTER_KEY="${ATLASIO_IMPORTER_KEY:-importer-demo}"
export ATLASIO_REVIEWER_KEY="${ATLASIO_REVIEWER_KEY:-reviewer-demo}"
export ATLASIO_READER_KEY="${ATLASIO_READER_KEY:-reader-demo}"
exec cargo run -p atlasio-server
