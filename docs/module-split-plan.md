# funfo_AI_Store 模块拆分设计方案（v1）

## 目标

把当前过度集中的 `server/index.js`，逐步拆成可维护的大型项目结构。
原则：

- 先按职责拆，不先追求复杂架构
- 先“搬家式重构”，尽量不改行为
- 先拆最稳定、最会继续膨胀的边界
- 单仓库内模块化，暂不做微服务化

---

## 当前问题

`server/index.js` 目前同时承担：

- 路由入口
- Create / Edit / Rewrite / Repair / Release 模式逻辑
- Prompt 拼装
- 上下文瘦身与模式隔离
- 版本保存
- 文档读写
- 校验
- 发布工作流
- 运行时启动与健康检查

这会导致：

- 单文件认知负担过高
- 小改动容易影响整条链路
- review 和协作成本不断升高
- 新角色/新模式继续加入时，复杂度会指数上升

---

## 推荐拆分顺序

### Phase 1（现在开始）
先拆最核心、最稳定的模块边界：

1. `server/modes/`
   - `workspace.js`（先承接 Create/Edit/Rewrite/Repair 的共享逻辑）
   - 后续再继续拆成 `create.js` / `edit.js` / `rewrite.js` / `repair.js`
2. `server/docs/`
   - 文档读写与文档模板
3. `server/validation/`
   - 前端可运行性 / 迭代约束 / 发布约束

### Phase 2
继续拆平台能力：

4. `server/runtime/`
   - preview / backend deploy / runtime health
5. `server/publish/`
   - 发布步骤、状态机、发布工作流
6. `server/ai/`
   - LLM provider client / prompt builder / parse

### Phase 3
前端同步模块化：

7. `src/pages/VibeCoding/`
   - WorkspacePanel
   - StorePanel
   - MyAppsPanel
   - PublishPanel
   - hooks/

---

## 推荐目录结构

```txt
server/
  index.js
  modes/
    workspace.js
    create.js
    edit.js
    rewrite.js
    repair.js
    release.js
  docs/
    appSpec.js
    contracts.js
    modeDocs.js
  validation/
    frontend.js
    iteration.js
    publish.js
  runtime/
    preview.js
    backend.js
    containers.js
  publish/
    jobs.js
    pipeline.js
  ai/
    client.js
    prompts.js
    parse.js
```

---

## 第一阶段的具体做法

### 本次先做
- 新建 `server/modes/workspace.js`
- 把以下逻辑搬进去：
  - workspace mode history/context 组装
  - Create/Edit/Rewrite prompt 构建
  - isolated Repair pass
- `server/index.js` 只保留：
  - route 入口
  - DB/权限检查
  - 调用 workspace mode 模块
  - 保存版本与返回 SSE

### 本次不做
- 不改路由结构
- 不改数据库
- 不改前端 API 形式
- 不改发布链路行为

---

## 角色与模块边界建议

### Create
- 目标：从 0 到 1
- 输入：轻量需求 + 轻量 APP_SPEC
- 输出：前端首版 + CREATE_NOTES / CREATE_PROPOSAL
- 不混入 Edit/Release 约束

### Edit
- 目标：安全迭代
- 输入：当前版本 + APP/API/DB 基线 + 近期编辑上下文
- 输出：增量版本 + EDIT_NOTES

### Rewrite
- 目标：保留业务目标的大改
- 输入：业务目标 + 少量近期上下文 + REWRITE_BRIEF
- 输出：新结构版本 + REWRITE_BRIEF 更新

### Repair
- 目标：把当前阶段产物修到可运行
- 输入：当前 JSX + 轻量上下文 + 当前模式
- 输出：修正后的 JSX（用户无感知）

### Release
- 目标：发布交付
- 输入：最终代码 + 核心文档 + release notes
- 输出：release report + publish result

---

## 当前执行状态

- [x] 四模式已引入：Create / Edit / Rewrite / Release
- [x] 内部 Repair 已加入主链路
- [x] Create 已改为 local-first
- [x] 本文档已创建
- [ ] workspace mode 逻辑完全迁出 `server/index.js`
- [ ] docs 模块迁出
- [ ] validation 模块迁出

---

## 最终目标

把 `server/index.js` 收敛成一个轻量入口文件：

- 注册路由
- 调用模块
- 汇总响应

而不是继续作为“平台总装厂”。
