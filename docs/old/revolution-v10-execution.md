# Revolution v10 Execution

基线版本：0.69.3B

## 本轮执行原则
由于当前仍处于开发状态，本轮允许更激进的结构性调整：

1. 优先按 v10 目标逻辑推进，而不是长期兼容旧模型
2. 允许先让新状态模型接管，再逐步清理旧逻辑
3. 优先解决“发布结果单义”和“失败版本不污染线上”
4. repair 从发布管线中降权，逐步移出

## 立即执行项
- 统一状态机继续收敛到 `release_state`
- 为 publish pipeline 引入 candidate/live 语义
- 收紧 verifier 为最小 blocking 模型
- 继续拆除 preview/live 混用链路

## 近期目标
- 不再出现“能打开但显示发布失败”
- 发布失败后有明确处理：rollback 或 stop candidate
- My Apps / Admin 用统一发布状态解释系统行为
