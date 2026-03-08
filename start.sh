#!/bin/bash
# funfo AI Store — 開発サーバー起動スクリプト

cd "$(dirname "$0")"

echo "🚀 funfo AI Store を起動中..."

# バックエンドと孤立プロセスを全停止
pkill -f "node server/index.js" 2>/dev/null
pkill -f "server/apps" 2>/dev/null
sleep 1

# バックエンド起動 (port 3100)
echo "📦 バックエンド起動中 (port 3100)..."
node server/index.js > /tmp/funfo-server.log 2>&1 &
BACKEND_PID=$!

# 起動待ち
sleep 1
if curl -s http://localhost:3100/api/apps > /dev/null 2>&1; then
  echo "✅ バックエンド起動完了 (PID: $BACKEND_PID)"
else
  echo "⚠️  バックエンド起動確認中... (ログ: /tmp/funfo-server.log)"
fi

# フロントエンド起動 (port 3000)
echo "🎨 フロントエンド起動中 (port 3000)..."
npm run dev
