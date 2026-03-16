# App 8 Release Notes


## 2026-03-15T06:38:52.508Z verifier failed
- summary: release verifier failed: behavior_smoke_session, behavior_smoke_logout
- failures:
  - AUTH_SMOKE_FAILED: /api/session/current failed
  - AUTH_SMOKE_FAILED: /api/session/logout failed

## 2026-03-15T06:39:49.896Z publish failed
- phase: verifier
- type: AUTH_SMOKE_FAILED
- retryable: yes
- detail: release verifier failed after repair: Behavior smoke session/current (/api/session/current failed) | Behavior smoke logout (/api/session/logout failed)

## 2026-03-15T06:43:13.765Z verifier failed
- summary: release verifier failed: behavior_smoke_login, behavior_smoke_session, behavior_smoke_logout
- failures:
  - AUTH_SMOKE_FAILED: /api/session/login failed (500)
  - AUTH_SMOKE_FAILED: /api/session/current failed
  - AUTH_SMOKE_FAILED: /api/session/logout failed

## 2026-03-15T06:44:35.854Z publish failed
- phase: verifier
- type: AUTH_SMOKE_FAILED
- retryable: yes
- detail: release verifier failed after repair: Behavior smoke login (/api/session/login failed (500)) | Behavior smoke session/current (/api/session/current failed) | Behavior smoke logout (/api/session/logout failed)
