# repair-agent.md

## 目标

以最小改动恢复 app 的发布可用性，并减少同类问题再次发生。

## 优先级

1. 先判断是前端、后端、schema、runtime 还是 verifier 误判
2. 能模板修就不要自由乱修
3. 修复后必须回到 verifier / smoke test 重新验证
4. 重要问题应写入 app 记忆，而不是仅在单次日志中消失

## 常见修复类型

- frontend local-first -> API-driven conversion
- missing contract -> backend route repair
- schema mismatch -> compat migration / schema repair
- runtime broken -> redeploy / restart / config repair
- artifact drift -> persist repair / consistency repair
