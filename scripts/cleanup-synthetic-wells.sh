#!/usr/bin/env bash
# Remove synthetic test wells (current names starting with "SYNTHETIC") that
# the smoke/verification suites published into the workspace database, along
# with their versions, import batches, file records, attached datasets, their
# stored original objects, and the audit-batch links. Real demo data (NSTA,
# RMOTC, Sodir, Volve) is never touched: only wells whose current version
# name starts with "SYNTHETIC" are removed.
#
# Published rows are protected by immutability triggers, so this script drops
# those four triggers for one transaction and recreates them exactly after it.
# Audit history is preserved: audit_events rows keep their entries, only the
# batch link is cleared. Run it after test sessions that publish fixtures.
#
# Usage (from WSL):
#   bash /mnt/e/projects/atlasio/scripts/cleanup-synthetic-wells.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${ATLASIO_DB_CONTAINER:-atlasio-db-1}"
OBJECTS_CONTAINER="${ATLASIO_OBJECTS_CONTAINER:-atlasio-objects-1}"
BUCKET="${S3_BUCKET:-atlasio-originals}"
KEYS_FILE="$REPO_DIR/backups/synthetic-object-keys.latest.txt"
PSQL=(docker exec -i "$CONTAINER" psql -U atlasio -d atlasio -v ON_ERROR_STOP=1)

before="$("${PSQL[@]}" -tAc "SELECT count(*) FROM wells w JOIN well_versions v ON v.id = w.current_version_id WHERE v.name LIKE 'SYNTHETIC%'")"
echo "Synthetic wells found: $before"
if [ "$before" = "0" ]; then
  echo "Nothing to clean up."
  exit 0
fi

# Capture the stored-object keys owned by the synthetic wells so the original
# files can be removed from object storage after the database rows are gone.
mkdir -p "$REPO_DIR/backups"
"${PSQL[@]}" -tAc "
  SELECT object_key FROM file_assets WHERE batch_id IN (
    SELECT id FROM import_batches WHERE well_id IN (
      SELECT w.id FROM wells w JOIN well_versions v ON v.id = w.current_version_id WHERE v.name LIKE 'SYNTHETIC%'))
  UNION
  SELECT object_key FROM datasets WHERE well_id IN (
    SELECT w.id FROM wells w JOIN well_versions v ON v.id = w.current_version_id WHERE v.name LIKE 'SYNTHETIC%');
" > "$KEYS_FILE"
echo "Object keys to remove: $(grep -c . "$KEYS_FILE" || true) (recorded in ${KEYS_FILE#$REPO_DIR/})"

"${PSQL[@]}" <<'SQL'
BEGIN;

DROP TRIGGER well_versions_immutable ON well_versions;
DROP TRIGGER published_batches_immutable ON import_batches;
DROP TRIGGER published_datasets_immutable ON datasets;
DROP TRIGGER published_files_immutable ON file_assets;

CREATE TEMP TABLE tmp_synthetic_wells AS
  SELECT w.id FROM wells w
  JOIN well_versions v ON v.id = w.current_version_id
  WHERE v.name LIKE 'SYNTHETIC%';

UPDATE wells SET current_version_id = NULL
  WHERE id IN (SELECT id FROM tmp_synthetic_wells);

UPDATE audit_events SET batch_id = NULL
  WHERE batch_id IN (SELECT id FROM import_batches WHERE well_id IN (SELECT id FROM tmp_synthetic_wells));

DELETE FROM datasets
  WHERE well_id IN (SELECT id FROM tmp_synthetic_wells);

DELETE FROM file_assets
  WHERE batch_id IN (SELECT id FROM import_batches WHERE well_id IN (SELECT id FROM tmp_synthetic_wells));

DELETE FROM well_versions
  WHERE well_id IN (SELECT id FROM tmp_synthetic_wells);

DELETE FROM import_batches
  WHERE well_id IN (SELECT id FROM tmp_synthetic_wells);

DELETE FROM wells
  WHERE id IN (SELECT id FROM tmp_synthetic_wells);

CREATE TRIGGER well_versions_immutable
    BEFORE DELETE OR UPDATE ON well_versions
    FOR EACH ROW EXECUTE FUNCTION forbid_version_change();
CREATE TRIGGER published_batches_immutable
    BEFORE DELETE OR UPDATE ON import_batches
    FOR EACH ROW EXECUTE FUNCTION forbid_published_batch_change();
CREATE TRIGGER published_datasets_immutable
    BEFORE DELETE OR UPDATE ON datasets
    FOR EACH ROW EXECUTE FUNCTION forbid_published_dataset_change();
CREATE TRIGGER published_files_immutable
    BEFORE DELETE OR UPDATE ON file_assets
    FOR EACH ROW EXECUTE FUNCTION forbid_published_file_change();

COMMIT;
SQL

after="$("${PSQL[@]}" -tAc "SELECT count(*) FROM wells w JOIN well_versions v ON v.id = w.current_version_id WHERE v.name LIKE 'SYNTHETIC%'")"
total="$("${PSQL[@]}" -tAc "SELECT count(*) FROM wells")"
echo "Synthetic wells remaining: $after (total wells now: $total)"

# Remove the orphaned original files from object storage (S3Mock keeps one
# metadata file per object; find it by the exact key and delete its folder).
found=0; missing=0; removed=0
while IFS= read -r key; do
  [ -n "$key" ] || continue
  meta=$(docker exec "$OBJECTS_CONTAINER" grep -rlF "\"key\":\"$key\"" "/s3mockroot/$BUCKET" | head -n 1 || true)
  if [ -z "$meta" ]; then
    missing=$((missing + 1))
    continue
  fi
  found=$((found + 1))
  docker exec "$OBJECTS_CONTAINER" rm -rf "$(dirname "$meta")" && removed=$((removed + 1))
done < "$KEYS_FILE"
echo "Objects: found=$found removed=$removed not-in-store=$missing"

# Prove the immutability triggers are back in place: this delete must fail.
if "${PSQL[@]}" -c "BEGIN; DELETE FROM well_versions WHERE true; ROLLBACK;" >/dev/null 2>&1; then
  echo "WARNING: well_versions immutability trigger is NOT active!" >&2
  exit 1
fi
echo "Immutability triggers verified: published versions are protected again."
