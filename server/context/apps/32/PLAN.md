# test16 Plan

- Publish mode: llm_provider
- Release strategy: 将当前localStorage驱动的用户登记与登录流程改为API驱动；使用users与sessions持久化数据，保留原有用户字段命名与核心流程；提供显式统计接口与登录会话接口，确保前端每个动作都有可验证的后端契约，并采用兼容安全的幂等建表策略。

## Entities
- users (id, name, gender, age, created_at)
- session (id, user_id, created_at, logged_out_at)
- stats (total_users, male_count, female_count, other_count, average_age)

## Routes
- GET /api/users — 获取用户列表
- POST /api/users — 创建用户并用于登记后登录
- DELETE /api/users/:id — 删除用户
- GET /api/users/stats — 获取用户统计数据
- POST /api/session/login — 按用户ID登录
- GET /api/session/current — 获取当前登录用户
- POST /api/session/logout — 退出当前登录

## Tables
- users (id, name, gender, age, created_at)
- sessions (id, user_id, created_at, logged_out_at)

## Notes
- 前端原型目前无fetch调用且明显local-first，发布版应改为调用显式API。
- 登录不要求密码，按现有原型保持通过用户ID切换会话。
- DELETE用户时后端应同时清理该用户的活跃session，避免current接口返回悬空用户。
- GET /api/users/stats 应返回对象而不是数组，键名需严格匹配 total_users、male_count、female_count、other_count、average_age。
- POST /api/users 应返回完整创建记录，至少包含 id、name、gender、age、created_at。
- GET /api/session/current 建议返回 null 或 { user: null } 中的一种固定形状，后续前后端需统一；优先返回 { user: ... } 以便扩展。
