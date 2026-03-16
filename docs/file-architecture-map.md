# funfo_AI_Store 文件架构地图（当前阶段）

> 这是拆分进行中的当前地图。后续每拆一层，就继续更新。

## 1. 项目总览

```txt
funfo_AI_Store/
├─ docs/
│  ├─ ai-store-generation-chain.html
│  ├─ module-split-plan.md
│  └─ file-architecture-map.md
├─ server/
│  ├─ index.js
│  ├─ db.js
│  ├─ preview-manager.js
│  ├─ app-backend-manager.js
│  ├─ modes/
│  │  └─ workspace.js
│  ├─ docs/
│  │  └─ index.js
│  ├─ validation/
│  │  └─ index.js
│  ├─ publish/
│  │  ├─ index.js
│  │  └─ pipeline.js
│  ├─ apps/
│  │  └─ <app_id>/...
│  └─ assets/
├─ src/
│  ├─ pages/
│  │  ├─ VibeCoding.tsx
│  │  └─ VibeCoding/
│  │     └─ ModeSwitcher.tsx
│  └─ services/
│     └─ api.ts
└─ package.json
```

---

## 2. 当前各文件职责

### `server/index.js`
**角色：平台后端入口 / 调度层**

当前主要负责：
- Express 路由注册
- DB 与权限检查
- 调用 modes/docs/validation 模块
- 版本保存
- preview / backend / publish 链路的主调度

目标方向：
- 继续瘦身
- 最终只保留“入口 + 调度”

---

### `server/modes/workspace.js`
**角色：workspace 模式层**

当前负责：
- Create / Edit / Rewrite 的 history 组装
- mode prompt 构建
- Repair pass（内部 Fix/Repair 角色）

目标方向：
- 未来继续细拆成：
  - `create.js`
  - `edit.js`
  - `rewrite.js`
  - `repair.js`

---

### `server/docs/index.js`
**角色：文档层 / 交接文档层**

当前负责：
- APP_SPEC / API_CONTRACT / DB_SCHEMA 路径与读写
- mode docs：CREATE_NOTES / EDIT_NOTES / REWRITE_BRIEF
- release docs：RELEASE_NOTES / RELEASE_REPORT
- create proposal docs
- app spec snapshot / api & db docs 更新

目标方向：
- 未来可进一步拆成：
  - `appSpec.js`
  - `contracts.js`
  - `modeDocs.js`

---

### `server/validation/index.js`
**角色：校验层**

当前负责：
- frontend only validation
- iteration early guard
- change ratio 判断
- design token 检查
- generated artifacts validation

目标方向：
- 未来可进一步拆成：
  - `frontend.js`
  - `iteration.js`
  - `publish.js`

---

### `server/publish/index.js`
**角色：发布状态层 / publish job 管理层**

当前负责：
- publish steps 模板
- publish_jobs 读写
- publish step 状态推进
- publish status response 组装

---

### `server/publish/pipeline.js`
**角色：发布执行流水线**

当前负责：
- `processPublishJob()` 主执行流程
- backend 生成 / 复用
- DB safety check
- backup
- docker/backend 启动
- health check
- release version 写回
- release report 写入

说明：
- 现在 publish 已拆成两层：状态层 + 执行层
- 后续若要继续细分，可再拆 backend generation / deploy / release-writeback 子模块

---

### `server/preview-manager.js`
**角色：前端预览运行时**

当前负责：
- preview 启动/停止
- 预览端口管理
- 从 DB 恢复 preview

---

### `server/app-backend-manager.js`
**角色：backend/runtime 管理**

当前负责：
- app backend 部署
- backend 停止
- api port 管理
- 容器运行时查询

---

### `server/apps/<app_id>/...`
**角色：app 产物层 / 每个 app 的数据与文档**

常见内容：
- `App.jsx`
- `server.js`
- `schema.sql`
- `APP_SPEC.md`
- `API_CONTRACT.md`
- `DB_SCHEMA.md`
- `CREATE_NOTES.md`
- `CREATE_PROPOSAL.md`
- `RELEASE_NOTES.md`
- `RELEASE_REPORT.md`
- `versions/vN/...`

说明：
- 这里不是平台逻辑定义层
- 这里是平台运行后生成出来的 app 实体数据层

---

### `src/pages/VibeCoding.tsx`
**角色：平台前端主工作台**

当前负责：
- workspace UI
- my apps / store 页面
- 生成 / 保存草稿 / 发布入口
- preview 展示

目标方向：
- 继续把 UI 面板和 hooks 外移

---

### `src/pages/VibeCoding/ModeSwitcher.tsx`
**角色：workspace 模式切换组件**

当前负责：
- Create / Edit / Rewrite 模式切换 UI
- 模式提示文案展示

说明：
- 这是前端拆分的第一刀
- 后续可继续拆 WorkspacePanel / MyAppsPanel / StorePanel

---

### `src/services/api.ts`
**角色：前端 API 通信层**

当前负责：
- chat
- publish
- save draft
- ensure workspace draft
- API base 处理

---

## 3. 当前已拆出的模块

### 已完成
- [x] `server/modes/workspace.js`
- [x] `server/docs/index.js`
- [x] `server/validation/index.js`

### 还建议继续拆
- [ ] `server/publish/`
- [ ] `server/runtime/`
- [ ] `server/ai/`
- [ ] `src/pages/VibeCoding/` 组件化

---

## 4. 当前最核心链路（简图）

```txt
VibeCoding.tsx
  -> src/services/api.ts
    -> server/index.js
      -> server/modes/workspace.js
      -> server/validation/index.js
      -> server/docs/index.js
      -> preview-manager.js / app-backend-manager.js
      -> server/apps/<app_id>/... 产物与文档
```

---

## 5. 当前结论

平台已经从“几乎全塞在 `server/index.js`”
开始变成“入口 + 模块”的结构。

目前最重要的后端模块边界已经初步形成：
- mode
- docs
- validation

后面继续拆的时候，这张地图会持续更新。
