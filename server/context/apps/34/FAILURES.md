# App 34 Failures


## 2026-03-15T21:04:13.020Z publish failed
- phase: candidate_runtime
- type: RUNTIME_HEALTH_FAILED
- retryable: yes
- detail: runtime health check failed after deploy

## 2026-03-15T21:12:38.879Z publish cancelled
- phase: frontend_analyze
- type: PUBLISH_CANCELLED
- retryable: no
- detail: 发布已取消

## 2026-03-15T21:26:57.248Z publish failed
- phase: candidate_runtime
- type: RUNTIME_HEALTH_FAILED
- retryable: yes
- detail: readiness=health timeout after 1500ms | container_logs_tail=✅ App backend on :3001 app=34 db=data_prod.sqlite mode=prod

## 2026-03-15T21:31:16.153Z release repair failed
- summary: release verifier failed: backend_artifact, version_artifacts_persisted, runtime_ready, runtime_health_payload, runtime_db_mode
- findings:
  - Backend artifact persisted: backend code missing
  - Versioned artifacts persisted: version dir v1 frontend=true backend=false schema=false
  - Runtime health endpoint reachable: health endpoint not ready
  - Runtime health payload valid: health payload missing or invalid
  - Runtime DB mode verified: db mode unavailable

## 2026-03-15T21:34:57.265Z release repair failed
- summary: release verifier failed: backend_artifact, version_artifacts_persisted, runtime_ready, runtime_health_payload, runtime_db_mode
- findings:
  - Backend artifact persisted: backend code missing
  - Versioned artifacts persisted: version dir v1 frontend=true backend=false schema=false
  - Runtime health endpoint reachable: health endpoint not ready
  - Runtime health payload valid: health payload missing or invalid
  - Runtime DB mode verified: db mode unavailable
