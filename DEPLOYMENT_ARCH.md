# Funfo AI Store 部署逻辑（Docker + 按需运行）

## 目标
1. 生成后立即可体验（/app/<slug>/）
2. 用户可导出并自部署
3. 部署稳定（前后端不串）
4. 不活跃时自动省资源，数据长期保留

## 当前实现（v1）
- 平台主服务运行在 Docker 容器中（3100/5175）
- 每个 app 分配 8 位 `preview_slug`
- 访问入口：`/app/<slug>/`
- 若访问时 preview 未运行，后端会自动唤醒 runtime
- 新增 `last_access_at`，并启用 idle sweeper：
  - 默认 30 分钟无访问自动 `stopPreview + stopAppBackend`
  - 仅关闭计算进程，不删除数据

可调参数（环境变量）：
- `APP_IDLE_MINUTES`（默认 30）
- `APP_IDLE_CHECK_MS`（默认 300000）

## 数据持久化原则
- `server/funfo.db`（平台元数据）必须持久
- `server/apps/<appId>/data.sqlite`（各 app 数据）必须持久
- runtime 可随时停启，数据库文件不可删

## 下一步建议（v2）
- 增加导出部署包（每个 app 一键导出 Dockerfile + compose + README）
- 增加网关层（Nginx/Caddy）统一反代 /app/<slug>/
- 增加健康检查/重试与回滚

---

## EC2 部署（步骤 1：GitHub 一键更新并重启）

### 首次在 EC2 上部署

1. 在 EC2 上克隆仓库（示例路径 `/opt/funfoai`）：
   ```bash
   sudo mkdir -p /opt/funfoai && sudo chown "$USER" /opt/funfoai
   git clone https://github.com/<你的org>/funfoai.git /opt/funfoai
   cd /opt/funfoai
   ```
2. 可选：在项目根目录创建 `.env`，设置 EC2 专用变量（否则使用默认值）：
   ```bash
   HOST_PROJECT_ROOT=/opt/funfoai
   OPENCLAW_URL=http://host.docker.internal:18789/v1/chat/completions
   OPENCLAW_TOKEN=<你的 OpenClaw token>
   # 外网通过 Nginx 访问时，HMR WebSocket 需用公网 host（否则浏览器会连 localhost 失败）
   VITE_HMR_HOST=ec2-18-183-255-142.ap-northeast-1.compute.amazonaws.com
   ```
3. 首次启动（使用 EC2 覆盖配置）：
   ```bash
   export HOST_PROJECT_ROOT=/opt/funfoai
   docker compose -f docker-compose.yml -f docker-compose.ec2.yml up -d --build
   ```
4. 给更新脚本执行权限：
   ```bash
   chmod +x scripts/update-and-restart.sh
   ```

### 一键更新并重启

本地修改 push 到 GitHub 后，在 EC2 上进入项目目录执行：

```bash
cd /opt/funfoai
./scripts/update-and-restart.sh
```

或指定项目根与分支：

```bash
PROJECT_ROOT=/opt/funfoai GIT_BRANCH=main ./scripts/update-and-restart.sh
```

脚本会：拉取指定分支最新代码 → 使用 `docker-compose.ec2.yml` 构建并启动主服务 → 若本机有 Nginx 则执行 `nginx -s reload`。

### Nginx 配置（外网 80/443 反代）

项目内提供参考配置：`docs/nginx-funfo-ai-store.conf`。在 EC2 上使用步骤：

1. **覆盖或新建站点配置**（按需修改路径）：
   ```bash
   sudo cp /opt/funfoai/docs/nginx-funfo-ai-store.conf /etc/nginx/sites-available/funfo-ai-store
   sudo ln -sf /etc/nginx/sites-available/funfo-ai-store /etc/nginx/sites-enabled/funfo-ai-store
   ```
   若已有 `/etc/nginx/sites-enabled/funfo-ai-store`，可直接编辑为与参考配置一致（见下）。

2. **配置要点**（与参考配置一致即可）：
   - **`map $http_upgrade $connection_upgrade`**：用于 Vite HMR WebSocket。若本文件不是被 `include` 在 `http {}` 内，请把该 `map` 放到 `/etc/nginx/nginx.conf` 的 `http { }` 中。
   - **`location /`**：反代到 `http://127.0.0.1:5175`（Vite 前端），并设置 `Upgrade` / `Connection`，以便 HMR WebSocket 通过 80 连到 5175。
   - **`location /api/`**：反代到 `http://127.0.0.1:3100/api/`，关闭缓冲并拉长超时（SSE/流式）。
   - **`location /app/`**：反代到 `http://127.0.0.1:3100/app/`，用于生成的 App 预览及 `/app/<slug>/api/*`。
   - **`location /v1/`**：反代到 `http://127.0.0.1:3100/v1/`，兼容 OpenClaw 等走 `/v1` 的请求。

3. **校验并重载**：
   ```bash
   sudo nginx -t && sudo nginx -s reload
   ```

完整内容见仓库内 `docs/nginx-funfo-ai-store.conf`。

### 说明

- `docker-compose.ec2.yml` 覆盖了 Mac 本地路径与 Docker socket，使用宿主机 `/var/run/docker.sock` 与 `HOST_PROJECT_ROOT`，子 App 容器由主服务通过该 socket 创建。
- 步骤 2 将配置 Nginx 反代 80/443，并设置公网 base URL。
- **外网访问**：若通过 Nginx 提供 80/443，需在 Nginx 中把 `/api`、`/app`、`/v1` 反代到 `http://127.0.0.1:3100`，前端在 80/443 下会使用同源 `/api`，避免 CORS。同时容器需传入 `VITE_HMR_HOST=公网主机名`，Vite HMR WebSocket 才能在外网连上。
