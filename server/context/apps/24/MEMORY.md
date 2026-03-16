# App 24 Memory

- Purpose:
- Core entities:
- Core routes:
- Known pitfalls:

- 2026-03-15T14:26:44.001Z: publish failed at phase db_check; type=SCHEMA_DRYRUN_FAILED; detail=release dry-run blocked before deploy: - SQL "SELECT s.id AS session_id, s.user_id, u.name, u.gender, u.age, u.created_at AS user_created_at " +
    "FROM sessions s " +
    "JOIN users u ON u.id = s.user_id " +
    "WHERE s.logged_out_at IS NULL" would fail: near "" +
    "": syntax error
- SQL "SELECT id, name, gender, age, created_at " +
    "FROM users " +
    "WHERE name = ? AND gender = ? AND age = ? " +
    "ORDER BY id ASC " +
    "LIMIT 1" would fail: near "" +
    "": syntax error
- SQL "SELECT " +
      "COUNT(*) AS total_users, " +
      "printf('%.1f', COALESCE(AVG(age), 0)) AS average_age, " +
      "SUM(CASE WHEN gender = 'male' THEN 1 ELSE 0 END) AS male_count, " +
      "SUM(CA" would fail: near "(": syntax error
- SQL "SELECT s.id AS session_id, s.user_id, u.name, u.gender, u.age, u.created_at AS user_created_at " +
      "FROM sessions s " +
      "JOIN users u ON u.id = s.user_id " +
      "WHERE s.id = ? " +
    " would fail: near "" +
      "": syntax error.
