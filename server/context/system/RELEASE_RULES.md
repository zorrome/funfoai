# RELEASE_RULES.md

## 发布判定原则

发布流程的目标不是“产物生成完成”，而是“发布后的 app 处于正常可用状态”。

## 发布完成前必须满足

1. 前端是 API-driven
2. 前后端契约对齐
3. schema 与 runtime 代码兼容
4. runtime 启动成功
5. health check 正常
6. 至少一条读接口 smoke 成功
7. 若存在 auth 流，则 login/session/logout smoke 必须成功
8. 版本产物 root / version 目录一致

## 一票否决项

- 前端仍被识别为 local-first
- 后端声明依赖的表/列不在 schema.sql 中
- runtime db mode 错误
- auth flow 存在但行为 smoke 失败
- 版本化产物未落盘

## repair 策略优先级

1. deterministic fallback
2. schema compat repair
3. backend contract repair
4. runtime redeploy
5. rollback

## 发布日志要求

每次发布都应有明确阶段日志：
- frontend_analyze
- backend_sql_generate
- verify
- db_check
- docker_start
- health_check
- completion

新增阶段可继续扩展，但不要跳过行为级验证。
