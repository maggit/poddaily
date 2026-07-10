#!/bin/sh
# Entrypoint for the unified poddaily image. First arg picks the role:
#   web (default) | api | worker — anything else is exec'd verbatim (e.g. `sh`).
# Every role applies migrations first; a Postgres advisory lock inside migrate.mjs
# serializes concurrent boots, so it's safe when web/api/worker start together.
set -eu

role="${1:-web}"

case "$role" in
  web|api|worker)
    if [ "${SKIP_MIGRATIONS:-0}" = "1" ]; then
      echo "[entrypoint] SKIP_MIGRATIONS=1 — skipping database migrations"
    else
      echo "[entrypoint] applying database migrations (role: $role)"
      # Fail fast: a container without its schema is useless, and the restart policy
      # retries until the database is reachable.
      node dist/migrate.mjs
    fi
    ;;
esac

case "$role" in
  web)
    export PORT="${PORT:-3000}"
    echo "[entrypoint] starting web on :$PORT"
    exec node apps/web/server.js
    ;;
  api)
    export PORT="${PORT:-3001}"
    echo "[entrypoint] starting api on :$PORT"
    exec node dist/api.mjs
    ;;
  worker)
    echo "[entrypoint] starting worker"
    exec node dist/worker.mjs
    ;;
  *)
    exec "$@"
    ;;
esac
