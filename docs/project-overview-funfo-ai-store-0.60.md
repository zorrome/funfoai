# funfo AI Store 0.60 项目概况

> 版本：**funfo AI Store 0.60**  
> 文档用途：快速接手开发、理解架构、定位关键流程

---

## 1. 项目目标

funfo AI Store 是一个“自然语言生成业务应用”的平台，核心目标：

1. 用户描述需求后，自动生成可运行 App（前后端一体）
2. 通过 `/app/<slug>/` 立即预览和试用
3. 子 App 运行隔离（每个 App 一个 Docker 容器）
4. 具备 QA 门禁，降低“能部署但不能用”的概率

---

## 2. 当前核心架构（0.60）

### 2.1 主容器（funfo-ai-store）

- 前端：Vite（默认 5175）
- 后端：Express（默认 3100）
- 主要职责：
  - PM/UI 两阶段 AI 流程
  - 代码生成与版本落库
  - `/app/<slug>/` 路由与代理
  - QA 检查与部署门禁

### 2.2 子 App 容器（funfo-app-<appId>）

- 每个子 App 单独容器运行（Express + SQLite）
- 容器标签绑定：`funfo.app_id`、`funfo.slug`
- API 访问通过主服务代理：`/app/<slug>/api/*`
- 避免传统端口错绑问题

### 2.3 数据存储

- `server/funfo.db`
  - apps / app_versions / messages / users / favorites 等平台数据
- `server/apps/<appId>/`
  - `server.js` / `schema.sql` / `data.sqlite`（子 App 数据）

---

## 3. 用户开发流程（聊天内可见）

### 串行流程（按顺序执行）

1. 产品经理策划中（AI）
2. UI 设计师设计中（AI）
3. 前后端工程师开发中（代码生成）
4. 测试工程师测试中（真实 QA 检查）
5. 服务器工程师部署中（仅 QA 通过才执行）

> 说明：步骤 1/2 的结果会显示在聊天框中，可查看具体内容。

---

## 4. 质量与稳定性机制

### 4.1 生成前/生成后校验

- SQL lint（SQLite 方言约束）
- SQL dry-run（临时 DB 执行）
- 前后端 API 合约检查（前端 fetch 与后端 route 对齐）

### 4.2 QA Gate

`GET /api/apps/:id/qa-check`

默认检查：
- runtime 唤醒
- 预览页可达性
- 稳定 GET API 冒烟（含重试，降低瞬时 502/503 假失败）

部署规则：
- QA 通过 -> 部署
- QA 不通过 -> 阻止部署并回显检查详情

### 4.3 Debug/Auto-fix 策略

- 自动无限 debug 循环已关闭（Docker 模式）
- 保留手动修复入口，避免“已可用但仍自动修修补补”体验问题

---

## 5. UI 生成策略（当前状态）

### 已实现

- 多范式（含 Tailwind Native）
- 每范式骨架 `skeleton`
- 设计 token 约束 + 服务端 restyle retry
- 默认降低蓝紫偏置（避免所有 App 同色）

### 待加强（建议）

- 范式结构评分门禁（低于阈值不放行）
- 范式命中率可视化（Admin 面板）
- 历史 App 一键“精致化重构 UI”

---

## 6. 关键目录

```text
funfo_AI_Store/
├─ src/
│  ├─ pages/VibeCoding.tsx          # 主工作台（聊天、流程、预览）
│  ├─ pages/Admin.tsx               # 管理台（runtime/审核）
│  └─ services/api.ts               # 前端 API 封装
├─ server/
│  ├─ index.js                      # 主后端入口（流程/路由/QA）
│  ├─ app-backend-manager.js        # 子App容器生命周期管理
│  ├─ preview-manager.js            # 预览构建与 iframe 页
│  ├─ db.js                         # 平台 DB 初始化/迁移
│  ├─ funfo.db                      # 平台数据库
│  └─ apps/<appId>/                 # 子App目录
├─ docker-compose.yml               # 主服务容器编排
├─ Dockerfile                       # 主服务镜像
└─ docs/
   ├─ architecture-funfo-ai-store-0.60.html
   └─ project-overview-funfo-ai-store-0.60.md
```

---

## 7. 下次开发建议

1. 先验证流程：PM -> UI -> DEV -> QA -> DEPLOY 是否串行
2. 先看 QA 详情再判断是否“真失败”
3. 优先改“范式门禁与评分”，再改视觉细节
4. 所有稳定性改动都先在 Docker 内回归（不要只测本机裸跑）

---

## 8. 快速启动（开发环境）

```bash
cd /Users/Joe/.openclaw/workspace/projects/funfo/funfo_AI_Store
docker compose up -d --build
```

访问：
- 前端：`http://localhost:5175`
- 后端：`http://localhost:3100`

