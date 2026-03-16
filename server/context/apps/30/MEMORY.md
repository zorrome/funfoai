# App 30 Memory

- Purpose:
- Core entities:
- Core routes:
- Known pitfalls:

- 2026-03-15T16:57:22.676Z: publish failed at phase candidate_runtime; type=SCHEMA_DRYRUN_FAILED; detail=release dry-run blocked before deploy: - SQL "SELECT id, name, phone, last_visit_date, created_at, updated_at FROM customers ORDER BY COALESCE(last_visit_date, "") DESC, name COLLATE NOCASE ASC, id ASC" would fail: no such column: "" - should this be a string literal in single-quotes?.
