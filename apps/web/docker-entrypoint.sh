#!/bin/sh
echo "[entrypoint] running database migrations"
# Non-blocking: if migrations fail, log loudly but still start the server so /login works
# and the failure is visible in logs (a single web replica; safe to migrate on boot).
node migrate.mjs || echo "[entrypoint] WARNING: migrations did not complete — starting server anyway"
echo "[entrypoint] starting server"
exec node apps/web/server.js
