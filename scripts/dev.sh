#!/usr/bin/env bash
set -euo pipefail

# Run the FastAPI backend and the Vite frontend together for local development.
# Stop both with Ctrl+C.
#
# Optional overrides:
#   BACKEND_PORT=8000 FRONTEND_PORT=5173 ./scripts/dev.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

if ! command -v uv >/dev/null 2>&1; then
  echo "Error: uv is not installed. See https://docs.astral.sh/uv/." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Warning: .env not found. Copy .env.example to .env and add your API keys." >&2
fi

if [[ ! -d frontend/node_modules ]]; then
  echo "Installing frontend dependencies..."
  (cd frontend && npm install)
fi

# Keep the backend CORS origins in sync with the frontend port this script uses.
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}}"

# Put each server in its own process group (via setsid when available) so the
# whole tree, including uvicorn's reloader and Vite's children, can be stopped.
USE_SETSID=0
if command -v setsid >/dev/null 2>&1; then
  USE_SETSID=1
fi

pids=()
stopping=0

start_backend() {
  if [[ "$USE_SETSID" -eq 1 ]]; then
    setsid uv run uvicorn backend.app.main:app --reload --port "$BACKEND_PORT" &
  else
    uv run uvicorn backend.app.main:app --reload --port "$BACKEND_PORT" &
  fi
  pids+=("$!")
}

start_frontend() {
  if [[ "$USE_SETSID" -eq 1 ]]; then
    setsid bash -c "cd '$ROOT_DIR/frontend' && exec npm run dev -- --port '$FRONTEND_PORT' --strictPort" &
  else
    (cd frontend && exec npm run dev -- --port "$FRONTEND_PORT" --strictPort) &
  fi
  pids+=("$!")
}

cleanup() {
  if [[ "$stopping" -eq 1 ]]; then
    return
  fi
  stopping=1
  trap - INT TERM EXIT
  echo
  echo "Stopping servers..."
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      if [[ "$USE_SETSID" -eq 1 ]]; then
        kill -TERM -- "-$pid" 2>/dev/null || true
      else
        pkill -TERM -P "$pid" 2>/dev/null || true
        kill -TERM "$pid" 2>/dev/null || true
      fi
    fi
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "Starting backend on http://localhost:${BACKEND_PORT} ..."
start_backend

echo "Starting frontend on http://localhost:${FRONTEND_PORT} ..."
start_frontend

echo
echo "Both servers are starting. Press Ctrl+C to stop."

wait -n || true
echo
echo "A server exited. Shutting down the other..."
cleanup
