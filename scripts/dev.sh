#!/bin/sh
# Local dev stack: Hono API on :3001 (in-memory Redis, mock user) +
# Vite client on :5173 (proxies /api to :3001).
# Usage: npm run dev   (Ctrl-C stops both)
set -e
cd "$(dirname "$0")/.."

npm run build:dev-server >/dev/null
node dist/dev-server.cjs &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT INT TERM

echo "API :3001 | Client http://localhost:5173"
npx vite
