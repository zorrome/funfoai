# IMPLEMENTATION_PLAN.md

## Phase 1（先落地）

### A. 只接入全局层
将以下文件在生成与发布时按需拼接进 prompt：
- system/SYSTEM.md
- system/RELEASE_RULES.md
- dev/DEV_RULES.md
- dev/API_CONVENTIONS.md
- dev/SCHEMA_RULES.md
- soul/SOUL.md
- agents/release-agent.md
- agents/repair-agent.md

### B. 接入 app 级记忆
对已有 app，在以下路径查找并注入：
- apps/<appId>/MEMORY.md
- apps/<appId>/DECISIONS.md
- apps/<appId>/RELEASE_NOTES.md

### C. 注入点建议

#### Chat / generate
- SYSTEM.md
- DEV_RULES.md
- SOUL.md
- users/<userId>/...（如果有）
- apps/<appId>/MEMORY.md（编辑已有 app）

#### Publish / failed-state repair
- RELEASE_RULES.md
- DEV_RULES.md
- SCHEMA_RULES.md
- release-agent.md
- repair-agent.md
- apps/<appId>/MEMORY.md
- apps/<appId>/RELEASE_NOTES.md

## Phase 2（增强）

### A. 给每个 app 自动生成基础记忆文件
首次发布成功后自动创建：
- apps/<appId>/MEMORY.md
- apps/<appId>/RELEASE_NOTES.md

### B. 写入机制
以下事件发生时应自动追加：
- 发布失败
- repair 成功
- schema compat 问题
- auth smoke 失败
- rollback 发生

## Phase 3（用户层）

### A. 引入用户偏好
按 owner_user_id 建目录：
- users/<userId>/USER.md
- users/<userId>/MEMORY.md

### B. 注入时机
仅在用户发起 app 创建/修改请求时注入，避免污染 release verifier。

## Phase 4（skills）

给高频 app archetype 增加 recipes：
- auth-dashboard
- reservation
- CRUD admin
- stats dashboard
- crm-lite

优先做 deterministic generator，不要只靠自由 prompt。
