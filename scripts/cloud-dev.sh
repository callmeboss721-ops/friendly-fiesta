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

# Bring up (or reuse) the local Supabase stack; never fatal for the dev server.
bash scripts/cloud-supabase-up.sh || true

# Load local dev env with override (guarantees the app targets local Supabase).
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

exec npm run dev
