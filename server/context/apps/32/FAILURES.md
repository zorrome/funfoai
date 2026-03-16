# App 32 Failures


## 2026-03-15T19:42:08.458Z publish failed
- phase: candidate_runtime
- type: SCHEMA_DRYRUN_FAILED
- retryable: yes
- detail: release dry-run blocked before deploy: - SQL "db.prepare(<concatenated sql>)" would fail: SQL is built by JavaScript string concatenation inside db.prepare(); release requires one complete SQLite query string.
