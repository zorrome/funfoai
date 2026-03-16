# test17 Plan

- Publish mode: llm_provider
- Release strategy: 将当前 localStorage 原型转换为 API-driven 单实体 users CRUD 应用，前端只通过显式 /api/users 与 /api/users/stats 访问 SQLite 持久化数据，后端严格保持 snake_case 字段与约定的 bare array、bare object、完整记录返回形状，schema 使用幂等且兼容演进的 users 表定义。

## Entities
- users (id, name, gender, age, created_at, updated_at)

## Routes
- GET /api/users — 获取用户列表，按最新更新时间倒序返回 bare array
- GET /api/users/stats — 获取用户总数、性别统计和平均年龄，返回 bare object
- POST /api/users — 新增用户并返回创建后的完整用户对象
- PUT /api/users/:id — 更新指定用户并返回更新后的完整用户对象
- DELETE /api/users/:id — 删除指定用户并返回包含 success 和 deleted_id 的结果
- DELETE /api/users — 清空全部用户记录并返回结构化成功结果

## Tables
- users (id, name, gender, age, created_at, updated_at)

## Notes
- 保留实体名 users 与字段名 id,name,gender,age,created_at,updated_at，不做重命名
- GET /api/users 必须返回 bare array，不能包裹 data
- GET /api/users/stats 必须返回 bare object，键为 total,male_count,female_count,other_count,avg_age
- POST /api/users 与 PUT /api/users/:id 必须返回完整用户记录，便于前端直接更新状态
- DELETE /api/users/:id 返回至少包含 success 和 deleted_id
- DELETE /api/users 返回结构化成功结果用于清空全部
- 后端需校验 gender 仅允许 male、female、other，age 范围为 0-120
- Express 路由顺序中 /api/users/stats 必须先于 /api/users/:id
- 用户列表按 updated_at DESC, id DESC 返回，保证最新记录优先显示
- schema 需覆盖 backend 实际查询与写入所需全部列，并可重复安全执行
