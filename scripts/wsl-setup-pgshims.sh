#!/bin/sh
# Setup script: creates pg_dump/pg_restore shims in ~/bin for WSL
# Run: wsl -d ubuntu24 bash /mnt/e/projects/atlasio/scripts/wsl-setup-pgshims.sh
mkdir -p ~/bin

# pg_dump shim: runs pg_dump inside the atlasio-db-1 container
# The server calls: pg_dump --dbname URL --format custom --file /path
# We extract the database name from the URL and run pg_dump via docker exec
cat > ~/bin/pg_dump << 'PG_DUMP_SHIM'
#!/bin/sh
DBNAME_URL=""
FILE=""
prev=""
for arg in "$@"; do
  case "$prev" in
    --dbname) DBNAME_URL="$arg" ;;
    --file) FILE="$arg" ;;
  esac
  prev="$arg"
done
DB=$(echo "$DBNAME_URL" | cut -d/ -f4)
mkdir -p "$(dirname "$FILE")" 2>/dev/null
docker exec atlasio-db-1 pg_dump -U atlasio -d "$DB" -Fc -f /tmp/restore.dump
docker cp atlasio-db-1:/tmp/restore.dump "$FILE"
docker exec atlasio-db-1 rm -f /tmp/restore.dump
exit $?
PG_DUMP_SHIM
chmod +x ~/bin/pg_dump

# pg_restore shim: restores a custom-format dump into the atlasio-db-1 container
# The server calls: pg_restore --dbname URL --clean --if-exists --no-owner --no-privileges /path
# We extract the database name from the URL, copy the dump into the container,
# and run pg_restore there against the correct database
cat > ~/bin/pg_restore << 'PG_RESTORE_SHIM'
#!/bin/sh
DUMPFILE=""
DBNAME="atlasio"
prev=""
for arg in "$@"; do
  case "$prev" in
    --dbname) DBNAME=$(echo "$arg" | cut -d/ -f4) ;;
  esac
  case "$arg" in
    --*) : ;;
    "") : ;;
    *) DUMPFILE="$arg" ;;
  esac
  prev="$arg"
done
[ -z "$DUMPFILE" ] && { echo "pg_restore shim: no dump file" >&2; exit 1; }
docker cp "$DUMPFILE" atlasio-db-1:/tmp/restore.dump
exec docker exec atlasio-db-1 pg_restore -U atlasio -d "$DBNAME" --clean --if-exists --no-owner --no-privileges /tmp/restore.dump
PG_RESTORE_SHIM
chmod +x ~/bin/pg_restore

echo "pg_dump and pg_restore shims written to ~/bin"
echo "Verify:"
head -3 ~/bin/pg_dump
head -3 ~/bin/pg_restore
