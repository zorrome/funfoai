# apps/

这里存放 app 级长期上下文。

推荐结构：

apps/
  <appId>/
    MISSION.md
    SOUL.md
    STYLE.md
    CAPABILITIES.md
    MEMORY.md
    DECISIONS.md
    FAILURES.md
    PLAN.md
    RELEASE_NOTES.md
    skills/

## MISSION.md
记录这个 app 到底要解决什么问题：
- 目标用户
- 核心任务
- 关键业务闭环
- 明确非目标

## SOUL.md
记录这个 app 自身的产品气质，而不是平台的通用气质：
- 更偏工具还是更偏内容
- 更偏严肃还是更偏轻松
- 交互是否应该强引导、强反馈

## STYLE.md
记录视觉与交互偏好：
- 界面风格
- 文案语气
- 是否偏紧凑、偏信息密集、偏移动端优先

## CAPABILITIES.md
记录 app 应长期保持的能力边界：
- 核心实体
- 核心动作
- 必须保留的 API / 数据流
- 发布关键路径

## MEMORY.md
记录该 app 的长期问题与上下文：
- 核心实体
- 核心路由
- 已知坑
- 发布失败历史
- schema 兼容注意点

## DECISIONS.md
记录明确决策，例如：
- auth 统一采用 /api/login + /api/session/current + /api/logout
- stats 必须后端显式返回
- 某字段不可再改名

## FAILURES.md
记录不应再次重复的失败类型：
- verifier 失败模式
- schema drift
- response shape mismatch
- runtime health 问题

## PLAN.md
记录当前阶段的发布/演进方向：
- 当前 focus
- 下一次发布要完成的 capability
- 当前最大的风险

## RELEASE_NOTES.md
记录发布相关变更与事故，用于 repair / verifier 注入。
