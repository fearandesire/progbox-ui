#!/usr/bin/env bash
# Starts the API and serves the built web app; both stop if either exits.
set -euo pipefail
mkdir -p "$LAB_DATA_DIR" "$PROGBOX_OUTPUTS_DIR"
pnpm lab leagues fetch || echo "League download failed; uploads and progbox-2017 still work."
PORT=8000 HOST=127.0.0.1 pnpm --filter @progbox/api exec tsx src/server.ts &
pnpm --filter web exec vite preview --host 0.0.0.0 --port "$PORT" --strictPort &
wait -n
exit 1
