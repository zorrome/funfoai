# App 30 Release Notes


## 2026-03-15T16:57:22.675Z publish failed
- phase: candidate_runtime
- type: SCHEMA_DRYRUN_FAILED
- retryable: yes
- detail: release dry-run blocked before deploy: - SQL "SELECT id, name, phone, last_visit_date, created_at, updated_at FROM customers ORDER BY COALESCE(last_visit_date, "") DESC, name COLLATE NOCASE ASC, id ASC" would fail: no such column: "" - should this be a string literal in single-quotes?
