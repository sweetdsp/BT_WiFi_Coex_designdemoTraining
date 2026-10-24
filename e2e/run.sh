#!/usr/bin/env bash
# Builds the app, serves it, runs the browser checks in headless Chromium, and stops the server.
# Needs Chromium; set CHROME to its path if it is not at the default.
set -euo pipefail
cd "$(dirname "$0")/.."
npx vite build >/dev/null
npx vite preview --port 4173 >/tmp/coex-preview.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
sleep 2
node e2e/check.mjs
