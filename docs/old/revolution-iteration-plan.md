# funfo AI Store 革命性迭代计划

起点版本：0.69.3A

## 总目标
把当前“复杂、混合、容易歧义失败”的发布系统，收敛成一个以稳定发布为第一目标的系统。

## 核心原则
1. 发布成功就是成功，失败就是失败
2. 失败版本不能继续在线污染结果
3. verifier 只阻止真正不能上线的东西
4. 开发态和长期态分开，不再混跑
5. 少状态、少修复、少隐式行为

## 迭代阶段

### Phase R1：状态模型收敛
- 引入 `candidate` / `live` 概念
- 区分 runtime 状态 与 release 状态
- UI 明确显示：draft / candidate / live / failed

### Phase R2：发布链路收敛
- 新版本先部署为 candidate runtime
- health_check 通过后再进入 verifier
- verifier 通过才 promote 为 live
- verifier 失败则 rollback 或 stop candidate

### Phase R3：verifier 降级为最小阻塞模型
Blocking：
- runtime health
- gateway route reachable
- prod db mode
- 核心 API 存在

Warning only：
- local-first signals
- schema 风格问题
- 产物整洁性
- 非关键 smoke

### Phase R4：开发态 / 长期态分离
- preview-manager 仅服务开发态
- full Docker runtime 仅服务长期态
- 手动 restart / restore / wake 都按模式处理

## 第一批落地任务
1. 定义 app release state machine
2. 调整 publish_jobs / apps 状态字段语义
3. 在 publish pipeline 中加入 candidate → promote / rollback
4. 把 verifier blocking 项缩减
5. 把 Admin / My Apps 状态展示改成新模型

## 成功标准
- 用户能稳定发布常见 CRUD / dashboard / form app
- 不再出现“能打开但显示发布失败”的歧义
- 失败原因能一眼定位到阶段
- 回滚是明确的、自动的、可预期的
