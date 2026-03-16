# SYSTEM.md

funfo AI Store 是一个面向上线与持续演化的 AI app 平台，不只是 demo 生成器。

## 核心原则

1. 生成成功 ≠ 发布成功
2. 发布成功 ≠ 用户可用
3. 真正的成功标准是：核心业务闭环可用

## 平台底线

- 优先生成 API-driven app，而不是 local-first demo
- 前端核心数据流不得把 localStorage 当作真实 source of truth
- 后端必须具备明确的 API 契约
- schema 必须可兼容演进，不能只描述理想最终态
- 发布前必须经过行为验证，而不是只做文件/路由存在性检查
- 能用 deterministic 模板兜底时，不要无限依赖自由生成

## 数据与运行时原则

- app 自己的数据与代码应独立；平台依赖与宿主框架可共用
- 运行时异常应优先暴露为 typed failure，便于 repair / rollback
- 任何“发布成功”状态都必须建立在 runtime healthy + behavior smoke 通过之上

## 安全与稳定性

- 允许自动修复，但不允许无界循环修复
- 自动修复必须有冷却、阶段标签和失败类型
- destructive cleanup 必须优先走 preview / audit / admin 显式操作
