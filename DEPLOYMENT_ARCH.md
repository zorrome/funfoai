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
   # （可选）若不需要热更新（只是对外提供可用页面），可禁用 HMR，避免控制台 WebSocket 报错
   VITE_DISABLE_HMR=1
   # 预览/分享链接的公网 base（与浏览器访问一致，如 http://ec2-xxx 或 https://域名）
   PUBLIC_BASE_URL=http://ec2-18-183-255-142.ap-northeast-1.compute.amazonaws.com
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
   - **`location /`**：反代到 `http://127.0.0.1:5175`（Vite 前端），并设置 `Upgrade` / `Connection`，以便 HMR WebSocket 通过 80 连到 5175；**必须**设置 `proxy_buffering off` 与 `proxy_cache off`，否则 Vite 动态 chunk 会出现 `ERR_CONTENT_LENGTH_MISMATCH`、页面空白。
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

### 如何确认 OpenClaw 是否被正常调用

1. **看后端日志**（每次调用 OpenClaw 都会打日志）  
   在 EC2 上查看主容器日志，例如：
   ```bash
   docker logs -f funfo-ai-store
   ```
   - 发起请求时：`[OpenClaw] 请求中 http://host.docker.internal:18789/... (timeout=140000ms)`
   - 成功时：`[OpenClaw] 成功 响应长度=1234`
   - 失败时：`[OpenClaw] 尝试 1/2 失败: ...`，最终失败会有一条 `[OpenClaw] 最终失败: ...`

2. **调调试接口**（不暴露 token，仅做连通性检查）  
   在浏览器或本机用 curl 请求（需能访问到后端 3100 或通过 Nginx 反代的 /api）：
   ```bash
   curl -s "http://ec2-18-183-255-142.ap-northeast-1.compute.amazonaws.com/api/debug/openclaw-ping"
   ```
   返回示例：
   - 正常：`{"ok":true,"urlMasked":"http://...","status":200,"message":"OpenClaw 正常 (响应长度 4)","responseLength":4}`
   - 不可达：`{"ok":false,"urlMasked":"...","status":0,"message":"fetch failed ..."}`  
   可根据 `ok`、`status`、`message` 判断 OpenClaw 是否可达。

3. **若返回 `ok: false` 且 urlMasked 为 `127.0.0.1`**  
   说明容器内请求的是本机（容器内回环），而 OpenClaw 在**宿主机**上，所以会 `fetch failed`。  
   **处理**：在 EC2 项目根目录的 `.env` 中设置（不要用 127.0.0.1）：
   ```bash
   OPENCLAW_URL=http://host.docker.internal:18789/v1/chat/completions
   OPENCLAW_TOKEN=<你的 token>
   ```
   保存后执行 `./scripts/update-and-restart.sh` 或 `docker compose -f docker-compose.yml -f docker-compose.ec2.yml up -d` 重启。  
   再确认宿主机上 OpenClaw 已监听 18789（如 `curl -s http://127.0.0.1:18789/...` 在宿主机上可通）。

4. **宿主机上 curl 127.0.0.1:18789 返回 405，但 openclaw-ping 仍 `fetch failed`（urlMasked 已是 host.docker.internal）**  
   说明 OpenClaw 在宿主机正常，但**容器访问宿主机 18789 不通**。常见原因与处理：

   - **OpenClaw 只监听了 127.0.0.1**  
     容器连的是宿主机网卡 IP（如 Docker 桥或内网 IP），不是宿主机本机回环。需让 OpenClaw 监听 **0.0.0.0:18789**（或至少监听宿主机对 Docker 暴露的地址）。改完重启 OpenClaw 后再测 openclaw-ping。

   - **改用宿主机 IP 直连（不依赖 host.docker.internal）**  
     在 EC2 上查宿主机内网 IP（如 `hostname -I | awk '{print $1}'` 得到 172.31.x.x），在 `.env` 里设：
     ```bash
     OPENCLAW_URL=http://172.31.43.79:18789/v1/chat/completions
     ```
     把 `172.31.43.79` 换成你本机查到的 IP。重启容器后再测 openclaw-ping。

   - **宿主机防火墙**  
     若开了 ufw，需放行 Docker 网段访问 18789，例如：
     ```bash
     sudo ufw allow from 172.17.0.0/16 to any port 18789
     sudo ufw reload
     ```

5. **`ss -tlnp | grep 18789` 显示只监听 127.0.0.1:18789（或 [::1]:18789）**  
   说明 OpenClaw 只接受本机回环，**容器从宿主机 IP（如 172.31.x.x）访问会连不上**。  
   **处理**：把 OpenClaw 改为监听 **0.0.0.0:18789**。若使用 OpenClaw 的配置文件，将 `gateway` 中 **`bind` 改为 `"lan"`**，并增加 **`controlUi.allowedOrigins`**（以便控制台/UI 可从指定来源访问）。示例：

   ```json
   "gateway": {
     "port": 18789,
     "mode": "local",
     "bind": "lan",
     "auth": {
       "mode": "token",
       "token": "<你的 token，与 funfo .env 中 OPENCLAW_TOKEN 一致>"
     },
     "controlUi": {
       "allowedOrigins": [
         "http://localhost:18789",
         "http://127.0.0.1:18789",
         "http://172.31.43.79:18789"
       ]
     }
   }
   ```

   - 将 `172.31.43.79` 换成你 EC2 的内网 IP（`hostname -I | awk '{print $1}'`）。
   - 若需通过公网域名访问 OpenClaw 控制台，在 `allowedOrigins` 中追加对应来源（如 `"http://ec2-xxx.compute.amazonaws.com"`）。
   - 保存后重启 OpenClaw，用 `sudo ss -tlnp | grep 18789` 确认出现 `0.0.0.0:18789`，再测 openclaw-ping。

---

## EC2 部署（步骤 3：Docker 子 App 运行）

### 3.1 子 App 容器网络与目录

- 主服务容器：`funfo-ai-store`（由 `docker-compose.yml` + `docker-compose.ec2.yml` 启动）  
  - 通过 `/var/run/docker.sock` 直接调用宿主机 Docker CLI。  
  - 使用 `HOST_PROJECT_ROOT` 在宿主机上写入 `server/apps/<appId>/`。  
  - 加入 Docker 网络 `funfo_ai_store_default`（见 `docker-compose.ec2.yml` 中的 `funfo_net`）。
- 子 App 容器：`funfo-app-<appId>`  
  - 由 `server/app-backend-manager.js` 动态创建，镜像为 `node:20-alpine`。  
  - 固定应用端口：容器内 `3001`。  
  - 数据目录：挂载宿主机的 `server/apps/<appId>` 到子容器 `/app`，其中：`server.js` / `schema.sql` / `data.sqlite`。  
  - 所有子 App 容器也加入同一个 Docker 网络 `funfo_ai_store_default`，便于主服务通过容器内 IP 调用其 `3001` 端口。

### 3.2 验证子 App 是否成功创建

1. 在 UI 中生成一个 App（完成 QA 并成功部署一次）。  
2. 在 EC2 上查看容器：
   ```bash
   docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Networks}}' | grep funfo-app-
   ```
   - 预期至少看到一个 `funfo-app-<id>`，`Networks` 一列包含 `funfo_ai_store_default`。
3. 查看对应目录是否存在（以默认 `HOST_PROJECT_ROOT=/opt/funfoai` 为例）：
   ```bash
   ls -R /opt/funfoai/server/apps
   ```
   - 应能看到按 `appId` 划分的子目录，内含 `server.js` / `schema.sql` / `data.sqlite`。

### 3.3 运行健康检查

- 使用已有的 QA 接口验证子 App 是否可用：
  ```bash
  curl -s "http://<域名或EC2>/api/apps/<id>/qa-check" | jq
  ```
  - `ok: true` 且 `checks` 中 `runtime_wake` / `preview_page` 为 `ok` 表示后端容器和预览都正常。
- 若 `runtime_wake` 失败，可在 EC2 上查看对应 `funfo-app-<id>` 容器日志：
  ```bash
  docker logs funfo-app-<id>
  ```

### 3.4 常见问题排查

- **宿主机 Docker 不可用或权限不足**  
  - 确认 `docker ps` 在 EC2 上可正常运行。  
  - 若主服务容器日志中出现 `docker run failed`，检查：  
    - `/var/run/docker.sock` 是否正确挂载；  
    - 宿主机上的 `docker` 命令是否可在 root 下正常执行。

- **子 App 容器创建成功但预览 502/超时**  
  - 多数是网络不通或路由错误；确认：  
    - `docker ps` 中 `funfo-app-<id>` 的网络包含 `funfo_ai_store_default`；  
    - 主服务容器 `funfo-ai-store` 也在该网络：  
      ```bash
      docker network inspect funfo_ai_store_default | jq '.[0].Containers | keys'
      ```  
    - 如有必要，重启主服务和子 App 容器，再次执行 `/api/apps/<id>/qa-check`。
