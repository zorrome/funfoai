# App 13 Release Notes


## 2026-03-14T19:01:56.860Z verifier failed
- summary: release verifier failed: schema_runtime_compat
- failures:
  - SCHEMA_COMPAT_FAILED: server expects missing schema parts: app.name, app.gender, app.age

## 2026-03-14T19:02:19.433Z publish failed
- phase: db_check
- type: SCHEMA_COMPAT_FAILED
- retryable: yes
- detail: release verifier failed after repair: Schema/runtime compatibility (server expects missing schema parts: app.name, app.gender, app.age)

## 2026-03-15T06:42:04.541Z publish success
- releaseAppId: 13
- version: v3
- previewSlug: fhs6b46p
- publishMode: openclaw_force
