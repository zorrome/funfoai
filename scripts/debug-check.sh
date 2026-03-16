#!/usr/bin/env bash
set -euo pipefail

echo "[1/5] Build check"
npm run build >/tmp/funfo-build.log 2>&1 || { echo "Build failed:"; tail -n 120 /tmp/funfo-build.log; exit 1; }

echo "[2/5] Docker status"
docker compose ps

echo "[3/5] Docker logs"
docker compose logs --tail=120 funfo-ai-store || true

echo "[4/5] API smoke"
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/api/apps)
echo "GET /api/apps => ${code}"
[ "$code" = "200" ] || { echo "API health failed"; exit 1; }

echo "[5/5] Done ✅"
