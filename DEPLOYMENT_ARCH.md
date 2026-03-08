# Funfo AI Store 部署逻辑（Docker + 按需运行）

## 目标
1. 生成后立即可体验（/app/<slug>/）
2. 用户可导出并自部署
3. 部署稳定（前后端不串）
4. 不活跃时自动省资源，数据长期保留

## 当前实现（v1）
- 平台主服务运行在 Docker 容器中（3100/5175）
- 每个 app 分配 8 位 `preview_slug`
- 访问入口：`/app/<slug>/`
- 若访问时 preview 未运行，后端会自动唤醒 runtime
- 新增 `last_access_at`，并启用 idle sweeper：
  - 默认 30 分钟无访问自动 `stopPreview + stopAppBackend`
  - 仅关闭计算进程，不删除数据

可调参数（环境变量）：
- `APP_IDLE_MINUTES`（默认 30）
- `APP_IDLE_CHECK_MS`（默认 300000）

## 数据持久化原则
- `server/funfo.db`（平台元数据）必须持久
- `server/apps/<appId>/data.sqlite`（各 app 数据）必须持久
- runtime 可随时停启，数据库文件不可删

## 下一步建议（v2）
- 增加导出部署包（每个 app 一键导出 Dockerfile + compose + README）
- 增加网关层（Nginx/Caddy）统一反代 /app/<slug>/
- 增加健康检查/重试与回滚
