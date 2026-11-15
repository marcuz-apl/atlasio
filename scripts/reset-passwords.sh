#!/usr/bin/env bash
# Reset the Atlasio staff passwords (Administrator + Data Manager) to the
# seeded initial passwords, clear MFA, and clear any login lockout.
#
# The server has no per-account password reset command yet, so this uses the
# supported one-shot path: boot the server once with ATLASIO_RESET_PASSWORDS=1.
# bootstrap_accounts() then rewrites both staff accounts to their initial
# passwords, clears MFA and lockouts, deletes old sessions, and records an
# audited auth.password.reset entry for each account. The flag is NOT set for
# the restart that follows, so it never re-fires on later restarts.
#
# Usage (from WSL, any working directory):
#   bash /mnt/e/projects/atlasio/scripts/reset-passwords.sh
#
# After the reset, sign in with:
#   admin   / admin-initial    (or $ATLASIO_ADMIN_INITIAL_PASSWORD)
#   datamgr / datamgr-initial  (or $ATLASIO_DATAMGR_INITIAL_PASSWORD)
# Both accounts must choose a new password at first sign-in.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

HOST="${ATLASIO_URL:-http://localhost:3040}"
ADMIN_USER="${ATLASIO_ADMIN_USERNAME:-admin}"
ADMIN_INITIAL="${ATLASIO_ADMIN_INITIAL_PASSWORD:-admin-initial}"
DATAMGR_USER="${ATLASIO_DATAMGR_USERNAME:-datamgr}"
DATAMGR_INITIAL="${ATLASIO_DATAMGR_INITIAL_PASSWORD:-datamgr-initial}"

export DATABASE_URL="${DATABASE_URL:-postgresql://atlasio:local-demo-only@localhost:5432/atlasio}"
export S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9090}"
export S3_ACCESS_KEY="${S3_ACCESS_KEY:-atlasio}"
export S3_SECRET_KEY="${S3_SECRET_KEY:-atlasio-secret}"
export S3_BUCKET="${S3_BUCKET:-atlasio-originals}"
export S3_REGION="${S3_REGION:-us-east-1}"
export ATLASIO_ADMIN_USERNAME="$ADMIN_USER"
export ATLASIO_ADMIN_INITIAL_PASSWORD="$ADMIN_INITIAL"
export ATLASIO_DATAMGR_USERNAME="$DATAMGR_USER"
export ATLASIO_DATAMGR_INITIAL_PASSWORD="$DATAMGR_INITIAL"
export ATLASIO_MFA_KEY="${ATLASIO_MFA_KEY:-YXJsYXNpby1sb2NhbC1tZmEta2V5LTMyLWJ5dGVzISE=}"
export ATLASIO_BACKUP_DIR="${ATLASIO_BACKUP_DIR:-$REPO_DIR/backups}"
export ATLASIO_PG_DUMP="${ATLASIO_PG_DUMP:-$HOME/bin/pg_dump}"
export ATLASIO_PG_RESTORE="${ATLASIO_PG_RESTORE:-$HOME/bin/pg_restore}"

SERVER="$REPO_DIR/target/debug/atlasio-server"
if [ ! -x "$SERVER" ]; then
  echo "error: $SERVER not found - build it first with: cargo build" >&2
  exit 1
fi

log() { printf '%s\n' "$*"; }

wait_for_server() {
  local deadline=$((SECONDS + 30))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -sf "$HOST/api/demo-profiles" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

try_login() {
  local user="$1" password="$2"
  curl -s -o /dev/null -w "%{http_code}" -X POST "$HOST/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$user\",\"password\":\"$password\"}"
}

# 1. Stop any running server so the reset boot can take the port.
log "Stopping any running atlasio-server..."
pkill -f "target/debug/atlasio-server" 2>/dev/null || true
sleep 1

# 2. One-shot reset boot. bootstrap_accounts runs during startup, before the
#    server listens, so "the reset server answers HTTP" means the reset is done.
log "Running the one-shot password reset (ATLASIO_RESET_PASSWORDS=1)..."
ATLASIO_RESET_PASSWORDS=1 "$SERVER" >/tmp/atlasio-reset.log 2>&1 &
RESET_PID=$!
if ! wait_for_server; then
  echo "error: the reset boot never became ready; last log lines:" >&2
  tail -20 /tmp/atlasio-reset.log >&2 || true
  kill "$RESET_PID" 2>/dev/null || true
  exit 1
fi

# 3. Prove the reset worked before restarting clean.
admin_status="$(try_login "$ADMIN_USER" "$ADMIN_INITIAL")"
datamgr_status="$(try_login "$DATAMGR_USER" "$DATAMGR_INITIAL")"

kill "$RESET_PID" 2>/dev/null || true
wait "$RESET_PID" 2>/dev/null || true
sleep 1

if [ "$admin_status" != "200" ] || [ "$datamgr_status" != "200" ]; then
  echo "error: reset did not take effect (admin=$admin_status, datamgr=$datamgr_status); last log lines:" >&2
  tail -20 /tmp/atlasio-reset.log >&2 || true
  exit 1
fi
log "Reset verified: both accounts accept their initial passwords again."

# 4. Start the server normally - no reset flag, so it never re-fires.
log "Starting the server normally..."
nohup "$SERVER" >/tmp/atlasio-server.log 2>&1 &
disown
if ! wait_for_server; then
  echo "error: the server did not come back up; last log lines:" >&2
  tail -20 /tmp/atlasio-server.log >&2 || true
  exit 1
fi

log ""
log "Password reset complete. Sign in with:"
log "  $ADMIN_USER / $ADMIN_INITIAL"
log "  $DATAMGR_USER / $DATAMGR_INITIAL"
log "Both accounts must set a new password at first sign-in."
log "The reset is recorded in the admin audit trail (auth.password.reset)."
