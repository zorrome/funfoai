# App 33 Failures


## 2026-03-15T20:10:03.013Z publish failed
- phase: candidate_runtime
- type: SCHEMA_DRYRUN_FAILED
- retryable: yes
- detail: release dry-run blocked before deploy: - SQL "db.prepare(<concatenated sql>)" would fail: SQL is built by JavaScript string concatenation inside db.prepare(); release requires one complete SQLite query string.

## 2026-03-15T20:11:26.774Z release repair failed
- summary: release verifier failed: backend_artifact, version_artifacts_persisted, runtime_ready, runtime_health_payload, runtime_db_mode
- findings:
  - Backend artifact persisted: backend code missing
  - Versioned artifacts persisted: version dir v2 frontend=true backend=false schema=false
  - Runtime health endpoint reachable: health endpoint not ready
  - Runtime health payload valid: health payload missing or invalid
  - Runtime DB mode verified: db mode unavailable
