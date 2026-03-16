# DEV_RULES.md

## 总原则

funfo 生成的 app 应默认面向“可维护、可发布、可修复”，而不是只追求首屏效果。

## 前端规则

- 默认走 API-driven 数据流
- 不得把 localStorage / sessionStorage 作为核心真相源
- 允许把 localStorage 用于偏好、缓存、UI 状态，但不能承载业务主数据
- 对于存在后端的 app，关键数据必须来自 `/api/...`
- auth / stats / CRUD 等显式场景优先生成明确接口，而不是隐式前端推导

## 后端规则

- 必须有清晰的 route contract
- 路由命名优先稳定、可读、可推断
- 错误应返回结构化 JSON
- auth 类 app 应明确 session 读写逻辑
- 不要只做 happy-path；至少处理参数错误、未登录、记录不存在

## SQL / Schema 规则

- schema.sql 必须可重复执行或至少可安全 apply
- 新增字段优先考虑历史兼容
- 如果后端依赖某列，schema.sql 必须显式声明该列
- 对旧字段升级时，优先提供 compat migration 思路
- 对已有 app 做后台迭代时，默认采用 migration-first，而不是重建数据库
- 如果只是前端迭代，不要顺手复制/重做 backend
- 如果确实需要改 backend/schema，必须把前端、后端、schema、旧数据兼容当成一个系统来处理

## Express 路由顺序规则

- 同一前缀下，静态路由必须在参数化路由之前注册
- 例：/api/users/stats 在 /api/users/:id 之前
- 否则 Express 会把 "stats" 当作 :id 参数匹配，导致 404 或数据错误

## 发布友好性规则

- 前端 API 调用尽量使用易识别模式
- 避免过度动态拼接导致 verifier 无法提取 contract
- 对高频 archetype（login、CRUD、stats）优先使用稳定模板
- 前端每一个 fetch('/api/...') 调用，后端必须有对应路由且包含真实业务逻辑
