# SCHEMA_RULES.md

## 目标

schema.sql 不只是创建表，更是运行时代码的契约来源。

## 规则

- schema 中的表与列必须覆盖 server.js 的实际读写需求
- 迁移应优先幂等
- 发布时应允许对 prod DB 做安全补齐
- 历史字段变更要考虑兼容，例如：
  - `last_login_at` -> `login_at`
  - 新增 `logged_out_at`

## 迭代后台的默认原则（migration-first）

- 编辑已有 app 时，默认是在旧数据库之上安全演进，而不是重建数据库
- 优先 additive migration：
  - `ADD COLUMN`
  - `ADD TABLE`
  - 数据回填（backfill）
- 不要默认执行破坏性变更：
  - `DROP COLUMN`
  - `DROP TABLE`
  - rename 后直接丢弃旧字段
  - 覆盖式重建导致旧数据不可读
- 如果新代码依赖新字段，必须同时给出兼容迁移思路
- 如果逻辑上要重命名字段，优先“新增新字段 + 回填 + 兼容读取”而不是直接替换旧字段

## 推荐时间字段

- created_at
- updated_at
- login_at
- logged_out_at

## Session 相关

若 app 使用 session：
- 应有稳定的 session 表
- 需要 token / user_id / created_at
- 若支持登出，建议有 logged_out_at

## 验证要求

- verifier 应检查 server.js 依赖的列是否在 schema.sql 中出现
- 发布后应对 prod DB 进行 schema apply / compat check
