#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find an available TCP port starting at $1
find_free_port() {
  local port=$1
  while lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; do
    port=$((port + 1))
  done
  printf '%s' "$port"
}

WS_PORT=$(find_free_port 8080)
VITE_PORT=$(find_free_port 5173)

echo "→ WS server  ws://localhost:${WS_PORT}"
echo "→ Vite       http://localhost:${VITE_PORT}"
echo ""

cleanup() {
  kill "$SERVER_PID" "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$SCRIPT_DIR/server"
PORT="$WS_PORT" npm run dev &
SERVER_PID=$!

cd "$SCRIPT_DIR"
VITE_WS_URL="ws://localhost:${WS_PORT}" npx vite --port "$VITE_PORT" --strictPort &
VITE_PID=$!

wait
