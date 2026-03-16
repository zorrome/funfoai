# FRONTEND_RULES.md

## 目标

funfo 生成的前端应首先是可上线、可维护、可与 verifier 对齐的前端。

## 规则

- 优先使用明确的 API 调用
- 对发布链路友好：避免过度动态的接口拼接
- 若使用 helper，应尽量采用稳定模式，如：
  - apiGet('/api/...')
  - apiSend('/api/...', 'POST', body)
  - apiDelete('/api/...')
- 若使用 fetch，则优先明确 `API_BASE + '/api/...'`
- 页面应优先围绕真实业务动作，而不是纯展示型 mock UI

## 禁忌

- 只靠 local array / localStorage 完成核心增删改查
- 没有后端接口却伪装成已可发布 app
- 过度依赖隐式状态，导致 repair 和 verifier 难以推断
