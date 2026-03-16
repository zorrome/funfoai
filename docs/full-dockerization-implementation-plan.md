# Full Dockerization Implementation Plan for Long-term Apps

时间：2026-03-15 04:55 JST

目标：

> 长期化（runtime_mode=server）的 app，前端和后端都运行在同一个独立 Docker 容器中；主站只做网关、编排、状态管理。

---

## A. 目标架构

```mermaid
flowchart TD
  User[Browser] --> Gateway[funfo-ai-store gateway\n3100/5175]
  Gateway -->|/app/<slug>/*| AppC[funfo-app-<id> container]
  AppC --> Frontend[frontend runtime / static index]
  AppC --> Backend[/api/* Express backend]
  AppC --> SQLite[(data_prod.sqlite)]
```

原则：
- 长期化 app 不再依赖主服务 `preview-manager` 进行用户可见运行
- 长期化 app 的前端入口 `/app/<slug>/` 与 `/app/<slug>/api/*` 都落到同一个 app 容器
- 主服务保留 preview-manager，仅用于 workspace / 开发态预览

---

## B. 当前问题清单

1. `server/app-backend-manager.js`
   - 只给 app 容器生成 `server.js`
   - 没有把 frontend runtime 一起放进容器运行

2. `server/preview-manager.js`
   - 长期化 app 现在仍依赖 preview-manager 提供前端页面
   - 导致 server runtime 是 Docker，frontend runtime 不是 Docker

3. `server/index.js`
   - `/app/<slug>/api/*` 代理到 app 容器
   - 但 `/app/<slug>/` 页面依然主要走 preview-manager

4. `server/publish/pipeline.js`
   - publish 成功后会启动 backend container + preview-manager
   - 没有“full app container runtime ready”这个完成标准

---

## C. 实施步骤

### Step 1. 为 app 容器生成完整 runtime 目录
修改文件：
- `server/app-backend-manager.js`
- 可能新增：`server/app-runtime-builder.js`

目标：
- 每次长期化发布时，在 `server/apps/<appId>/` 下生成：
  - `server.js`
  - `schema.sql`
  - `App.jsx` 或编译产物
  - `runtime/` 或 `public/` 内的前端入口文件
  - 运行所需静态资源引用

建议：
- 复用 `preview-manager` 的 `buildHtml(...)` 逻辑
- 把长期化 app 的 frontend HTML 直接生成为 app 容器可服务的文件

### Step 2. 让 app 容器同时托管前端与 API
修改文件：
- `server/app-backend-manager.js`

目标：
- 容器内 Express 同时处理：
  - `/health`
  - `/api/*`
  - `/`、`/index.html`、静态 frontend 入口
- 如果 frontend 仍保留 runtime JS 注入，也要在容器内部完成，不再依赖主服务 preview 端口

建议：
- `buildServerJs(...)` 扩展成 full runtime server
- 为 runtime HTML 注入 `API_BASE=''` 或相对 `/api`

### Step 3. 改写主网关 `/app/<slug>` 路由
修改文件：
- `server/index.js`

目标：
- 对 `runtime_mode=server` / 长期化 app：
  - `/app/<slug>/` 整体代理到 app 容器
  - `/app/<slug>/api/*` 也代理到同一容器
- 对 workspace / 开发态：
  - 继续使用 `preview-manager`

建议：
- 让 `handleAppSlug` 先判断 app 是否属于长期化 server runtime
- 如果是，整个 path 都走容器代理
- preview-manager 只在非长期化场景兜底

### Step 4. 调整 publish 完成标准
修改文件：
- `server/publish/pipeline.js`
- `server/publish/index.js`

目标：
- 发布成功标准从：
  - backend container OK + preview-manager reachable
- 改成：
  - full app container health OK
  - `/app/<slug>/` reachable
  - `/app/<slug>/api/...` reachable

建议新增：
- `frontend_runtime_check`
- `container_route_check`

### Step 5. restore/wake/sleep 机制统一
修改文件：
- `server/index.js`
- `server/app-backend-manager.js`
- `server/preview-manager.js`

目标：
- restoreBackendsFromDb 只恢复长期化 app 容器
- 不再为长期化 app 调用 `startPreview(...)`
- wake/sleep 只作用于 full app container

### Step 6. 状态模型清理
修改文件：
- `server/db.js`
- `src/services/api.ts`
- `src/pages/Admin.tsx`
- `src/pages/VibeCoding*.tsx`

目标：
- 弱化/移除 `api_port` 这类旧 host-port 模型依赖
- 强化以下状态：
  - `runtime_container`
  - `backend_state`
  - `frontend_state`
  - `health_ok`
  - `runtime_mode`
  - `dockerized: true/false`

---

## D. 最小可用改造顺序（推荐实际执行顺序）

### Phase 1：跑通长期化 full container
- [ ] 给 app container 生成前端入口文件
- [ ] app container 内同时服务前端和后端
- [ ] `/app/<slug>` 全量代理到容器
- [ ] publish 后不再依赖 preview-manager 暴露长期化 app

### Phase 2：清理混合架构遗留
- [ ] restore 不再为长期化 app 调 preview-manager
- [ ] admin/runtime 状态统一显示 full container 状态
- [ ] 清理 `api_port` / host-port 旧概念

### Phase 3：增强稳定性
- [ ] 为每个长期化 app 增加容器自检
- [ ] 增加 `/ready`、frontend smoke check
- [ ] 容器版本 / 发布版本映射
- [ ] rebuild / rollback 机制

---

## E. 风险点

1. `preview-manager.buildHtml(...)` 当前可能默认依赖主服务的静态资源路由
   - 需要确认 app 容器内也能拿到这些资源

2. app 容器镜像当前复用主服务镜像
   - 这可行，但要确认运行时依赖足够
   - 后续可考虑拆分更轻的 app-runner image

3. 当前 `/app/<slug>` 路由已绑定一些 preview 逻辑
   - 改造时要避免影响 workspace 开发态

---

## F. 我建议的第一批实际代码改动

1. 新增一个 runtime builder：
   - `server/app-runtime-builder.js`
   - 输入：`frontendCode`, `serverCode`, `schemaSql`, `slug`
   - 输出：长期化 app 容器可运行文件集

2. 修改 `server/app-backend-manager.js`
   - 让 `buildServerJs(...)` 支持前端页面托管
   - `dockerRunAppContainer(...)` 保持不变或少量增强

3. 修改 `server/index.js`
   - `handleAppSlug` 对长期化 app 统一走容器代理
   - preview-manager 仅用于 workspace / draft

4. 修改 `server/publish/pipeline.js`
   - publish 后校验 full container route 而不是 preview-manager route

---

## G. 当前阶段判断

这次建议不是小修补，而是一次明确的架构收敛：

> 长期化 app：full Docker runtime
> 开发态 app：preview-manager runtime

这条边界一旦拉清，很多现在的错位问题会自然消失。
