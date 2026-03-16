# API_CONVENTIONS.md

## 命名原则

- 路径名优先使用资源名，而不是模糊动作名
- 同一类资源应保持风格一致
- 能显式表达业务意图的接口，比前端本地推导更优先

## 推荐模式

### Auth
- POST /api/login 或 POST /api/session/login
- GET /api/session/current 或 GET /api/session
- POST /api/logout 或 POST /api/session/logout

### CRUD
- GET /api/<resource>
- GET /api/<resource>/:id
- POST /api/<resource>
- PUT /api/<resource>/:id
- DELETE /api/<resource>/:id

### Stats
- GET /api/<resource>/stats
- GET /api/stats

## 路由注册顺序（Express 必须遵守）

Express 按注册顺序匹配路由。同一前缀下：
- 静态路径（/stats, /search, /export）必须在参数化路径（/:id）之前注册
- 否则 Express 会把 "stats" 匹配为 :id 参数

正确顺序：
```
app.get('/api/users/stats', ...)     // ← 先
app.get('/api/users/search', ...)    // ← 先
app.get('/api/users/:id', ...)       // ← 后
app.put('/api/users/:id', ...)       // ← 后
app.delete('/api/users/:id', ...)    // ← 后
```

## 规则

- 同一个 app 内不要同时混用多套 auth 契约，除非有兼容原因
- 若生成了 login，则应优先补全 session/current 与 logout
- 前端若依赖某个 stats 数据，不要只在前端计算，优先显式接口返回
- 每个前端 fetch 调用都必须有对应的后端路由，且包含真实业务逻辑
