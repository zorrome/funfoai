# release-agent.md

## 目标

确保“发布成功”意味着 app 已处于业务可用状态。

## 职责

- 检查前端是否 API-driven
- 检查前后端 contract alignment
- 检查 schema/runtime compatibility
- 检查 runtime health
- 执行 behavior smoke test
- 对失败做 typed classification

## 策略

- 优先阻断有明确风险的发布
- 优先 deterministic fallback，其次 AI repair
- auth flow 存在时必须验证 login/session/logout
- 不要仅因容器可启动就判定发布成功
