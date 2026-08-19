#!/usr/bin/env bash
# ============================================================
# CE VAULT — Cloud Agent dev-server launcher
# 1) ensures the local Supabase stack is up (idempotent)
# 2) loads the local .env.local with override so the dev server uses the
#    LOCAL stack even when production Supabase secrets are injected into the
#    VM environment (Next.js does not let .env.local override existing env)
# 3) runs the Next.js dev server
# ============================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# If Cloud Agent `start` is still running, wait so we do not race
# `supabase start` (a concurrent stop/retry can tear the stack down).
START_STATUS="/tmp/cursor/start-user/start-user.status"
START_SCRIPT="/tmp/cursor/start-user/start-user.sh"
if [ -f "$START_SCRIPT" ] && [ ! -f "$START_STATUS" ]; then
  echo "[cloud-dev] waiting for environment start to finish..."
  for _ in $(seq 1 90); do
    [ -f "$START_STATUS" ] && break
    sleep 2
  done
fi

# If `start` already brought the stack up, skip a second bootstrap (avoids
# waiting on the flock while dockerd or a slow start still holds it).
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^supabase_db_workspace$'; then
  echo "[cloud-dev] supabase already running, skipping bootstrap"
else
  bash scripts/cloud-supabase-up.sh || true
fi

# Load local dev env with override (guarantees the app targets local Supabase).
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

exec npm run dev
