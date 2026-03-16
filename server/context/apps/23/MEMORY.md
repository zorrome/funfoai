# App 23 Memory

- Purpose:
- Core entities:
- Core routes:
- Known pitfalls:

- 2026-03-15T14:14:50.510Z: publish failed at phase db_check; type=SCHEMA_DRYRUN_FAILED; detail=release dry-run blocked before deploy: - SQL "SELECT " +
      "COUNT(*) AS total_count, " +
      "SUM(CASE WHEN gender = 'male' THEN 1 ELSE 0 END) AS male_count, " +
      "SUM(CASE WHEN gender = 'female' THEN 1 ELSE 0 END) AS female_count, " +" would fail: near "(": syntax error
- SQL "SELECT id, name, gender, age, created_at, updated_at " +
        "FROM users " +
        "WHERE name LIKE ? " +
        "ORDER BY updated_at DESC, id DESC" would fail: near "" +
        "": syntax error.
