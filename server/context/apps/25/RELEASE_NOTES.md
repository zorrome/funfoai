# App 25 Release Notes


## 2026-03-15T14:49:13.491Z publish failed
- phase: db_check
- type: SCHEMA_DRYRUN_FAILED
- retryable: yes
- detail: release dry-run blocked before deploy: - SQL "SELECT s.id, s.user_id, s.token, s.created_at, s.logged_out_at, " +
    "u.name, u.gender, u.age, u.created_at AS user_created_at, u.updated_at " +
    "FROM sessions s " +
    "INNER JOIN users u ON " would fail: near ".": syntax error
- SQL "SELECT " +
      "COUNT(*) AS total, " +
      "SUM(CASE WHEN gender = 'male' THEN 1 ELSE 0 END) AS male_count, " +
      "SUM(CASE WHEN gender = 'female' THEN 1 ELSE 0 END) AS female_count, " +
     " would fail: near "(": syntax error
