# App 31 Release Notes


## 2026-03-15T18:54:23.088Z publish failed
- phase: candidate_runtime
- type: SCHEMA_DRYRUN_FAILED
- retryable: yes
- detail: release dry-run blocked before deploy: - SQL "db.prepare(<concatenated sql>)" would fail: SQL is built by JavaScript string concatenation inside db.prepare(); release requires one complete SQLite query string.
