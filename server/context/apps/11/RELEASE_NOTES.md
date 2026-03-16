# App 11 Release Notes


## 2026-03-14T18:05:33.756Z verifier failed
- summary: release verifier failed: schema_runtime_compat, behavior_smoke_login, behavior_smoke_session, behavior_smoke_logout
- failures:
  - SCHEMA_COMPAT_FAILED: server expects missing schema parts: sessions.session_token
  - AUTH_SMOKE_FAILED: /api/session/login failed
  - AUTH_SMOKE_FAILED: /api/session/current failed
  - AUTH_SMOKE_FAILED: /api/session/logout failed

## 2026-03-14T18:06:23.649Z publish failed
- phase: verifier
- type: AUTH_SMOKE_FAILED
- retryable: yes
- detail: release verifier failed after repair: Behavior smoke login (/api/session/login failed (400)) | Behavior smoke session/current (/api/session/current failed) | Behavior smoke logout (/api/session/logout failed)
