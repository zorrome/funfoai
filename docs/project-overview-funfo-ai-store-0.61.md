## funfo AI Store 0.61 项目概况

> 版本：**funfo AI Store 0.61**  
> 核心变化：支持在 AWS EC2 上对外部署访问，并打通 per-app Docker 子服务链路（保持本地开发体验不变）

---

## 1. 本次版本目标（0.60 → 0.61）

在 0.60 的基础上，0.61 主要完成：

1. **云上部署通路打通**：支持在 AWS EC2（Ubuntu）上通过 Nginx + Docker 对外提供服务。
2. **Docker 子 App 在云上可用**：每个生成 App 仍以独立容器运行，预览与 `/app/<slug>/api/*` 全链路打通。
3. **OpenClaw 接入生产化**：提供清晰的配置方式、连通性自检接口和日志，便于在云上排错。
4. **生成链路稳健性增强**：产品策划 / 设计阶段在 OpenClaw 异常或返回格式不规范时，能自动降级到默认方案，不中断生成流程。

> 说明：0.61 的重点是“让 0.60 的架构在云上可落地”，不改变用户使用体验，只减少“环境/部署”类失败。

---

## 2. 云上部署能力（EC2 + Nginx + Docker）

### 2.1 新增 EC2 专用编排：`docker-compose.ec2.yml`

- 作用：覆盖本地开发用的 `docker-compose.yml` 部分配置，使其适配 EC2 生产环境。
- 关键点：
  - **挂载宿主机项目根**：
    - `HOST_PROJECT_ROOT=/home/ubuntu/data/funfoai`（示例）
    - `volumes: - ${HOST_PROJECT_ROOT}:${HOST_PROJECT_ROOT}`  
    - 确保容器内写入 `HOST_PROJECT_ROOT/server/apps/<appId>` 的代码和数据，真实落在宿主机对应目录。
  - **Docker socket**：
    - `- /var/run/docker.sock:/var/run/docker.sock`  
    - 主服务容器通过宿主机 Docker CLI 动态创建 `funfo-app-<id>` 子容器。
  - **环境变量**：
    - `HOST_PROJECT_ROOT`：宿主机项目根。
    - `OPENCLAW_URL` / `OPENCLAW_TOKEN`：OpenClaw 接入配置。
    - `VITE_HMR_HOST` / `VITE_DISABLE_HMR`：HMR 行为控制（外网只开放 80/443 时尤为重要）。
    - `PUBLIC_BASE_URL`：预览/分享链接的公网 base（如 `http://ec2-xxx` 或 `https://域名`）。
  - **网络**：
    - 显式定义 `funfo_ai_store_default` 网络，主服务与子 App 均加入该网络，保持与 0.60 的约定一致。

### 2.2 一键更新脚本：`scripts/update-and-restart.sh`

- 功能：
  - 拉取指定分支（默认 `main`）最新代码。
  - 执行 `docker compose -f docker-compose.yml -f docker-compose.ec2.yml up -d --build`。
  - 若检测到 Nginx，尝试 `nginx -s reload`（失败不阻塞主流程）。
- 用法（示例）：
  ```bash
  cd /home/ubuntu/data/funfoai
  ./scripts/update-and-restart.sh
  ```

### 2.3 Nginx 反代配置：`docs/nginx-funfo-ai-store.conf`

- 提供可直接复制到 `/etc/nginx/sites-available/funfo-ai-store` 的参考配置，核心包括：
  - `location /` → `http://127.0.0.1:5175`（前端 + HMR WebSocket，关闭缓冲）。
  - `location /api/` → `http://127.0.0.1:3100/api/`（SSE/流式，关闭缓冲、拉长 timeout）。
  - `location /app/` → `http://127.0.0.1:3100/app/`（子 App 预览 + `/api/*`）。
  - `location /v1/` → `http://127.0.0.1:3100/v1/`（OpenClaw 等兼容路径）。
- 文档 `DEPLOYMENT_ARCH.md` 中给出了：
  - 如何拷贝启用该配置；
  - 如何把 `map $http_upgrade` 放到 `http {}` 中；
  - 如何校验并重载：`nginx -t && nginx -s reload`。

---

## 3. 子 App Docker 运行链路修复

0.60 中的设计是“每个 App 一个 Docker 容器”（`funfo-app-<id>`），0.61 主要修复了在 EC2 上的路径与挂载问题。

### 3.1 主服务与子 App 的关系

- 主服务容器：`funfo-ai-store`
  - 负责：
    - PM / UI / 代码生成 / QA / 部署流水线。
    - 通过 Docker CLI 创建/销毁子 App 容器。
    - 通过 `/app/<slug>/api/*` 代理到对应子 App 的 `3001`。
- 子 App 容器：`funfo-app-<appId>`
  - 镜像：`node:20-alpine`
  - 端口：容器内固定 `3001`
  - 数据目录：（容器内）`/app` ←（宿主机）`server/apps/<appId>`
    - `server.js`：生成的 Express 路由。
    - `schema.sql`：生成的 SQLite 表结构。
    - `data.sqlite`：该 App 的业务数据。

### 3.2 EC2 环境下的关键修复

- 问题（0.60 在 EC2 上的典型现象）：
  - `funfo-app-<id>` 容器启动报：
    - `Could not read package.json: ENOENT: no such file or directory, open '/app/package.json'`
    - `Error: Cannot find module '/app/server.js'`
  - 宿主机 `server/apps/<id>` 目录下只有 `package-lock.json`。
- 原因：
  - 主容器内部的 `HOST_PROJECT_ROOT` 与宿主机未正确挂载到同一路径，生成逻辑写入了容器内部路径，但宿主机实际目录为空。
- 修复：
  - 在 `docker-compose.ec2.yml` 中增加：
    ```yaml
    - ${HOST_PROJECT_ROOT:-/opt/funfoai}:${HOST_PROJECT_ROOT:-/opt/funfoai}
    ```
  - 确保：
    - 主容器中写入 `HOST_PROJECT_ROOT/server/apps/<id>` 的代码落在宿主机。
    - 子 App 容器挂载的 `appDir` 就是这条路径，能看到完整的 `package.json` / `server.js`。

### 3.3 验证步骤（运维视角）

1. 通过 UI 生成一个 App，并完成 QA / 部署。  
2. 在 EC2 上查看容器：
   ```bash
   docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Networks}}' | grep funfo-app-
   ```
3. 查看子 App 目录：
   ```bash
   ls -R /home/ubuntu/data/funfoai/server/apps/<appId>
   ```
   - 应看到：`package.json`、`package-lock.json`、`server.js`、`schema.sql`、`data.sqlite`。
4. 若有 502/500，可进一步通过：
   ```bash
   docker logs funfo-app-<appId>
   curl -s "http://<域名>/api/apps/<appId>/qa-check" | jq
   ```
   定位为“生成代码 bug”还是“容器/网络问题”。

---

## 4. OpenClaw 接入与可观测性

### 4.1 环境变量与推荐配置

- `OPENCLAW_URL`：容器内访问宿主机 OpenClaw 的地址，推荐：
  - `http://host.docker.internal:18789/v1/chat/completions`
  - 或 `http://<EC2 内网 IP>:18789/v1/chat/completions`
- `OPENCLAW_TOKEN`：与 OpenClaw gateway 的 token 一致。

文档中补充了当 `ss -tlnp | grep 18789` 显示只监听 `127.0.0.1` 时，如何通过 OpenClaw 配置：

```json
"gateway": {
  "port": 18789,
  "mode": "local",
  "bind": "lan",
  "auth": {
    "mode": "token",
    "token": "<与 funfo OPENCLAW_TOKEN 一致>"
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

### 4.2 调试接口：`GET /api/debug/openclaw-ping`

- 用于快速验证容器是否能连通 OpenClaw：
  ```bash
  curl -s "http://<域名>/api/debug/openclaw-ping"
  ```
- 返回示例：
  - `ok: true` 且 `status: 200`：OpenClaw 正常。
  - `ok: false` + `message: fetch failed`：网络/绑定/防火墙有问题。
- 搭配部署文档中的排错小节，可以快速找到是：
  - `127.0.0.1` 监听；
  - `host.docker.internal` 不通；
  - 防火墙阻拦 Docker 网段；
  - 还是 token / URL 配置错误。

---

## 5. 生成链路的容错与降级

### 5.1 策划阶段：`POST /api/apps/plan`

- 增加宽松 JSON 解析 `parseJsonRelaxed`：
  - 自动截取 `{ ... }`。
  - 清理尾逗号等常见 LLM JSON 格式问题。
- 若解析失败或 OpenClaw 超时：
  - 返回默认的日文策划步骤（`DEFAULT_PLAN_STEPS`）与问卷（`DEFAULT_PLAN_QUESTIONNAIRE`）。
  - 前端显示“策划完成（降级）：使用默认策划流程”，并继续后续 UI / 代码生成。

### 5.2 UI 设计阶段：`POST /api/apps/design-brief`

- 同样使用 `parseJsonRelaxed` 解析模型输出。
- 若解析失败或调用异常：
  - 返回默认的 `concept`、`styleGuide`、`uiChecklist`。
  - 前端显示“UI 设计完成（降级）”，继续代码生成。

> 效果：OpenClaw 异常不再导致 500，中间环节改为“质量降级”，保证生成链路对用户而言是“可用但可能不够精细”，而不是直接中断。

---

## 6. 前端访问与 HMR 行为调整

### 6.1 API Base 策略更新

- `src/services/api.ts` 中：
  - 当 `window.location.port` 为 `3000`、`5173`、`80`、`443` 或空（默认 80）时：
    - `BASE = '/api'` → 统一走同源 `/api`，再由 Nginx 转发到 3100。
  - 其他端口（如直连 5175）：
    - 仍直接访问 `hostname:3100/api`，便于本机开发。

### 6.2 HMR 配置细化：`vite.config.ts`

- `server.allowedHosts = true`：
  - 允许通过 EC2 公网主机名 / 自定义域访问 dev server。
- `server.hmr`：
  - 当设置 `VITE_HMR_HOST` 且未禁用 HMR：
    - 仅设置 `clientPort: 80`，让浏览器通过 80 WebSocket 连到 Nginx；  
    - Vite 服务端仍监听容器内部自己的端口（Dockerfile 中为 5175）。
  - 当设置 `VITE_DISABLE_HMR=1`：
    - `hmr: false`，完全关闭 HMR，避免生产环境控制台出现 WebSocket 报错。

---

## 7. 与 0.60 的关系与后续方向

- **对架构的延续**：
  - 保持 0.60 的核心设计：`/app/<slug>/` 预览、per-app Docker 子服务、QA Gate 等。
  - 0.61 主要是让这些设计在云上可稳定跑起来，而不是重构。

- **对用户/开发者行为的影响**：
  - 开发者本地流程几乎不变。
  - 额外多了一套 “EC2 三步部署” 手册与一键脚本。

- **后续版本（0.61.x）的自然方向**：
  1. 针对常用业务场景（排班/审批/通知等）加强生成模板与 QA 规则，降低 per-App 500 的概率。
  2. 提供更丰富的 Admin 视图（运行中子 App、错误统计、OpenClaw 调用统计等）。
  3. 在不增加部署复杂度的前提下，逐步引入限流/熔断和多 AZ 部署能力。

