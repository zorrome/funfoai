#!/usr/bin/env bash
# funfo AI Store — EC2 一键更新并重启
# 用法: 在项目根目录执行 ./scripts/update-and-restart.sh
# 或: PROJECT_ROOT=/opt/funfoai ./scripts/update-and-restart.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 项目根目录：脚本所在目录的上一级
DEFAULT_PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$DEFAULT_PROJECT_ROOT}"
GIT_BRANCH="${GIT_BRANCH:-main}"

cd "$PROJECT_ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "错误: $PROJECT_ROOT 不是 Git 仓库。请先 git clone 到该目录。"
  exit 1
fi

echo "项目目录: $PROJECT_ROOT"
echo "分支: $GIT_BRANCH"
echo "正在拉取最新代码..."
git fetch origin "$GIT_BRANCH"
git checkout "$GIT_BRANCH"
git pull origin "$GIT_BRANCH"

# EC2 上主服务通过 Docker Compose 运行，使用 ec2 覆盖配置
export HOST_PROJECT_ROOT="${HOST_PROJECT_ROOT:-$PROJECT_ROOT}"
echo "HOST_PROJECT_ROOT=$HOST_PROJECT_ROOT"
echo "正在构建并启动容器..."
docker compose -f docker-compose.yml -f docker-compose.ec2.yml up -d --build

# 若本机安装了 Nginx 且由 Nginx 反代本服务，可自动重载配置（失败不报错）
if command -v nginx >/dev/null 2>&1; then
  nginx -s reload 2>/dev/null || true
fi

echo "完成。主服务已重启。"
