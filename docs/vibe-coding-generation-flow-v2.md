# Vibe Coding Generation Flow v2

## 主流程

```mermaid
flowchart TD
    A["用户进入 Create / Workspace"] --> B["前端加载平台公开模型<br/>GET /api/ai/models"]
    B --> C["用户选择平台提供的模型"]
    C --> D["创建新 App 或打开已有 App"]
    D --> E["前端发起生成<br/>POST /api/apps/:id/chat<br/>message + mode + modelKey"]

    E --> F["后端校验编辑权限<br/>owner / guest / workspace draft"]
    F --> G["解析并持久化 ai_model_key<br/>resolveSelectedModelKey()"]
    G --> H["写入用户消息 messages"]
    H --> I["确保上下文目录存在<br/>app/user context"]

    I --> J["加载运行时上下文<br/>history + APP_SPEC + API_CONTRACT + DB_SCHEMA"]
    J --> K["判断生成模式<br/>create / edit / rewrite"]
    K --> L["Prompt Orchestrator 组装系统层"]

    L --> L1["Platform Kernel"]
    L --> L2["System / Dev / Soul"]
    L --> L3["Active Agent"]
    L --> L4["User Context"]
    L --> L5["App Identity"]
    L --> L6["App Memory"]
    L --> L7["Runtime Context"]

    L7 --> M["调用平台 LLM Provider 流式生成<br/>streamLlmText()"]
    M --> N["SSE 持续回传 delta 到前端编辑器"]
    M --> O["后端接收完整响应并 parseAIResponse()"]

    O --> P{"是否返回 jsx?"}
    P -- "否" --> P1["返回生成失败，不进入预览"]
    P -- "是" --> Q["JSX 预处理<br/>lintAndRepairJsx()"]

    Q --> R{"workspace 校验通过?"}
    R -- "否" --> R1["返回 validation error"]
    R -- "是" --> S["保存 app version 与版本文件"]

    S --> T["更新 docs<br/>APP_SPEC / API_CONTRACT / RELEASE_NOTES 等"]
    T --> U{"runtime_mode = server?"}
    U -- "否" --> V["启动前端预览"]
    U -- "是" --> W["补全缺失 API route<br/>校验 frontend/backend/sql 一致性"]
    W --> X["部署 app backend（如有）"]
    X --> V["启动前端预览"]

    V --> Y["前端刷新 preview / versions / messages"]
    Y --> Z["用户继续迭代，进入下一轮 edit / rewrite"]
```

## Prompt 编排层

```mermaid
flowchart LR
    A["Platform Kernel"] --> H["最终 System Prompt"]
    B["System / Dev / Soul"] --> H
    C["Active Agent<br/>planner / workspace / release / repair / review"] --> H
    D["User Context<br/>USER / PREFERENCES / CAPABILITIES / MEMORY"] --> H
    E["App Identity<br/>MISSION / SOUL / STYLE / CAPABILITIES"] --> H
    F["App Memory<br/>MEMORY / DECISIONS / FAILURES / PLAN / RELEASE_NOTES"] --> H
    G["Runtime Context<br/>mode / app stage / release state / schema diff"] --> H
```

## 关键结果

- 用户不再直接依赖 OpenClaw，而是走平台配置好的 provider + model。
- 生成不是“单 prompt”，而是带有 identity、agent、memory、runtime 的分层编排。
- 发布前的 release manifest 会沉淀为 `PLAN.md`，失败会沉淀为 `FAILURES.md`，让后续迭代和修复更连续。
