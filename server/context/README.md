# funfo AI Store Context Layers

这套目录为 funfo AI Store 提供分层上下文系统，用于稳定生成、修复、发布和运营。

## 目标

让系统从“单次生成代码”升级为“带有平台规则、产品气质、用户记忆、app 记忆的持续型 AI app 平台”。

## 分层结构

### 1. `system/`
平台硬规则层。定义安全、发布、运行时、数据一致性等底线。

### 2. `dev/`
开发规则层。定义前端、后端、API、schema、迁移、鉴权、错误处理等工程规范。

### 3. `soul/`
产品气质层。定义 funfo AI Store 倾向生成什么样的产品、界面、架构与体验。

### 4. `agents/`
Agent 行为层。定义 planner / workspace / review / release / repair 等角色的职责与策略。

### 5. `users/`
用户层。存放每个用户的长期偏好、行为习惯、常见需求、常用模板。

### 6. `apps/`
App 层。存放每个 app 的长期记忆、决策记录、发布历史、app-specific skills。

## 当前编排顺序

运行时不再只是把几段字符串拼接在一起，而是按以下顺序组装：

1. `PLATFORM_KERNEL`
2. `SYSTEM + DEV + SOUL`
3. `ACTIVE_AGENT`
4. `USER_CONTEXT`
5. `APP_IDENTITY`
6. `APP_MEMORY`
7. `RUNTIME_CONTEXT`
8. 当前 surface 的 role prompt（workspace / release / repair）

其中优先级约定为：
- system > dev > active agent > app mission/capabilities > app decisions/failures > user preferences > ambient memory
- `DECISIONS.md` 比 `MEMORY.md` 更强
- `FAILURES.md` 视为反模式清单，默认不要重复
- `PLAN.md` 是下一步方向，不是硬指令

## 推荐注入策略

### 聊天生成阶段
- system/SYSTEM.md
- dev/DEV_RULES.md
- soul/SOUL.md
- agents/planner-agent.md（create）
- agents/workspace-agent.md
- users/<userId>/USER.md（如存在）
- users/<userId>/MEMORY.md（如存在）
- apps/<appId>/MISSION.md / SOUL.md / CAPABILITIES.md（如存在）
- apps/<appId>/MEMORY.md / DECISIONS.md / FAILURES.md / PLAN.md（编辑已有 app 时）

### 后端/SQL 生成阶段
- system/SYSTEM.md
- system/RELEASE_RULES.md
- dev/DEV_RULES.md
- dev/API_CONVENTIONS.md
- dev/SCHEMA_RULES.md
- agents/release-agent.md
- agents/review-agent.md
- apps/<appId>/MISSION.md / CAPABILITIES.md / MEMORY.md / DECISIONS.md / FAILURES.md（如存在）

### 发布验证阶段
- system/RELEASE_RULES.md
- system/RUNTIME_RULES.md
- dev/SCHEMA_RULES.md
- agents/release-agent.md
- agents/review-agent.md
- apps/<appId>/RELEASE_NOTES.md / FAILURES.md / PLAN.md（如存在）

### 修复阶段
- system/SYSTEM.md
- system/RELEASE_RULES.md
- dev/DEV_RULES.md
- agents/repair-agent.md
- agents/review-agent.md
- apps/<appId>/MEMORY.md / DECISIONS.md / FAILURES.md / RELEASE_NOTES.md

## 第一阶段优先级

建议优先启用以下六层：

1. system/
2. dev/
3. soul/
4. agents/workspace-agent.md
5. apps/<appId>/MISSION.md
6. apps/<appId>/MEMORY.md

这些层最直接改善：
- 生成一致性
- 修复质量
- 发布质量
- 历史问题复发率

## 约束

- system/ 与 dev/ 应视为平台级准只读规则来源。
- users/ 与 apps/ 属于长期记忆层，允许持续追加与修正。
- repair 和 release 过程应优先引用 app 级记忆，而不是每次从零猜测。
- verifier 的“通过”必须尽量靠行为验证，而不只是静态结构检查。
- 发布链路产出的 manifest 应沉淀为 `PLAN.md`，而不是只停留在临时 JSON。
