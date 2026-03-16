#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[funfo] rebuilding docker service to latest workspace state..."
docker compose up -d --build funfo-ai-store

echo "[funfo] waiting for services..."
sleep 4

echo "[funfo] checking build tag endpoints..."
python3 - <<'PY'
import urllib.request
for url in ['http://127.0.0.1:3100/api/__build_tag','http://127.0.0.1:5175/api/__build_tag']:
    try:
        print('URL', url)
        print(urllib.request.urlopen(url, timeout=5).read().decode())
    except Exception as e:
        print('ERR', url, e)
PY

echo "[funfo] checking mounted code inside container..."
docker exec funfo-ai-store sh -lc "grep -n \"恭喜成功，应用已经发布完成\" /app/src/pages/VibeCoding.tsx || true; grep -n \"在 workspace 中试用\" /app/src/pages/VibeCoding/MyAppsPanel.tsx || true; grep -n \"if (d.preview_port) return\" /app/src/pages/VibeCoding.tsx || true"
