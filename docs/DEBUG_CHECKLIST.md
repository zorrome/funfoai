# funfo AI Store Debug Checklist (v0.63)

目标：低上下文消耗、快速定位 Docker + SQLite 问题。

## 每次改动后固定执行（按顺序）
1. `pnpm run lint`（或 `npm run lint`）
2. `pnpm run build`（或 `npm run build`）
3. `docker compose ps`
4. `docker compose logs --tail=120 funfo-ai-store`
5. `curl -sS http://127.0.0.1:3100/api/apps | head -c 300`
6. 关键业务 API 冒烟（1-2 个）
7. 最后再做 UI 检查（空/正常/边界 3 态）

## Docker 快速判定
- 先看 `ps` 再看日志，不先重建。
- 先 `docker compose restart`，再 `docker compose up -d --build`。
- 发布前至少做 1 次 `--build` 防止旧镜像假通过。

## SQLite 快速判定
- 只做增量迁移（禁止 DROP）。
- 先校验 schema，再测接口。
- 排查顺序：
  1) 挂载持久化是否正确
  2) 表是否存在
  3) 新列是否存在
  4) SQL 是否为 SQLite 方言

## 重试止损（强制）
- 同一根因最多修 3 次：
  - 第 1 次：直接修
  - 第 2 次：加日志再修
  - 第 3 次：回退最近稳定 commit，改最小方案
- 第 3 次仍失败：对照 v0.61/v0.62 副本，不硬扛。

## 每轮仅记录 3 行（节省上下文）
- 错误摘要：
- 修改点：
- 结果：
