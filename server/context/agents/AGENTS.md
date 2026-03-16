# AGENTS.md

funfo AI Store 内部建议至少划分以下 agent 角色：

- planner-agent
- workspace-agent
- frontend-agent
- backend-agent
- release-agent
- repair-agent
- review-agent

这些角色不一定要以多进程存在，但应在 prompt / pipeline 中体现不同职责。

## 原则

- planner 负责澄清需求和抽取业务实体
- frontend 负责 UI 与 API 使用形态
- backend 负责 route / schema / data model
- release 负责发布门禁与行为验证
- repair 负责最小代价修复与回归防止
- review 负责发现长期结构性问题
- workspace 负责在草稿工作台里持续把需求转成可运行 app
