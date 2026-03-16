# App 20 Memory

- Purpose:
- Core entities:
- Core routes:
- Known pitfalls:

- 2026-03-15T14:32:07.686Z: publish failed at phase db_check; type=SCHEMA_DRYRUN_FAILED; detail=release dry-run blocked before deploy: - SQL "SELECT " +
      "COUNT(*) AS total_users, " +
      "COALESCE(ROUND(AVG(age)), 0) AS avg_age, " +
      "SUM(CASE WHEN gender = 'male' THEN 1 ELSE 0 END) AS male_count, " +
      "SUM(CASE WHEN gende" would fail: near "(": syntax error.

- 2026-03-15T14:44:44.647Z: publish failed at phase db_check; type=SCHEMA_DRYRUN_FAILED; detail=release dry-run blocked before deploy: - SQL "SELECT ' +
      'COUNT(*) AS total_users, ' +
      'COALESCE(CAST(ROUND(AVG(age)) AS INTEGER), 0) AS avg_age, ' +
      'SUM(CASE WHEN gender = ? THEN 1 ELSE 0 END) AS male_count, ' +
      'SUM(CAS" would fail: near "(": syntax error
- SQL "UPDATE users ' +
      'SET name = ?, gender = ?, age = ?, updated_at = ? ' +
      'WHERE id = ?" would fail: near "' +
      '": syntax error.
