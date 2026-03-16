const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'funfo.db');
const db = new Database(DB_PATH);

// WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    nickname TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_url TEXT DEFAULT NULL,
    session_token TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reset_token TEXT NOT NULL UNIQUE,
    used INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
    guest_key TEXT DEFAULT NULL,
    name TEXT NOT NULL DEFAULT '新規アプリ',
    icon TEXT NOT NULL DEFAULT '✨',
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft', -- legacy compatibility field: 'draft' | 'private' | 'published' (prefer release_state)
    review_status TEXT NOT NULL DEFAULT 'none', -- 'none' | 'pending' | 'approved' | 'rejected'
    publish_status TEXT NOT NULL DEFAULT 'idle', -- 'idle' | 'publishing' | 'failed'
    app_role TEXT NOT NULL DEFAULT 'release', -- 'release' | 'draft'
    release_app_id INTEGER DEFAULT NULL REFERENCES apps(id) ON DELETE SET NULL,
    current_version INTEGER NOT NULL DEFAULT 1,
    api_port INTEGER DEFAULT NULL,
    ai_model_key TEXT DEFAULT NULL,
    preview_slug TEXT DEFAULT NULL,
    last_access_at TEXT DEFAULT (datetime('now')),
    color TEXT DEFAULT NULL,
    runtime_mode TEXT NOT NULL DEFAULT 'local', -- 'local' | 'server'
    app_stage TEXT NOT NULL DEFAULT 'prototype', -- 'prototype' | 'frontend_ready' | 'backend_proposed' | 'backend_generated' | 'backend_verified' | 'release_blocked' | 'release_ready' | 'published_live' (legacy internal label for live) | 'repair_needed'
    stage_reason TEXT DEFAULT NULL,
    release_state TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'candidate' | 'live' | 'failed' | 'rollback'
    live_version_id INTEGER DEFAULT NULL REFERENCES app_versions(id) ON DELETE SET NULL,
    candidate_version_id INTEGER DEFAULT NULL REFERENCES app_versions(id) ON DELETE SET NULL,
    last_failure_reason TEXT DEFAULT NULL,
    last_failure_at TEXT DEFAULT NULL,
    last_promoted_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL DEFAULT 1,
    label TEXT DEFAULT NULL,
    code TEXT DEFAULT '',
    server_code TEXT DEFAULT NULL,
    sql_code TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    role TEXT NOT NULL, -- 'user' | 'assistant'
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(app_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS publish_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL UNIQUE REFERENCES apps(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'idle', -- 'idle' | 'publishing' | 'completed' | 'failed'
    current_step TEXT DEFAULT NULL,
    steps_json TEXT NOT NULL DEFAULT '[]',
    error_message TEXT DEFAULT NULL,
    started_at TEXT DEFAULT NULL,
    completed_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_release_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    release_app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    source_draft_app_id INTEGER DEFAULT NULL REFERENCES apps(id) ON DELETE SET NULL,
    backup_version_number INTEGER NOT NULL,
    release_version_number INTEGER DEFAULT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    description TEXT DEFAULT '',
    color TEXT DEFAULT NULL,
    code TEXT DEFAULT '',
    server_code TEXT DEFAULT NULL,
    sql_code TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_access_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    visitor_key TEXT NOT NULL,
    source TEXT DEFAULT 'preview',
    path TEXT DEFAULT '/',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS platform_ai_providers (
    provider_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    auth_type TEXT NOT NULL,
    connection_status TEXT NOT NULL DEFAULT 'disconnected',
    credentials_json TEXT DEFAULT NULL,
    enabled_models_json TEXT NOT NULL DEFAULT '[]',
    default_model_id TEXT DEFAULT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    last_error TEXT DEFAULT NULL,
    metadata_json TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS platform_ai_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    default_model_key TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
db.prepare("INSERT OR IGNORE INTO platform_ai_state (id, default_model_key) VALUES (1, NULL)").run();

// ── migrations for existing DBs ─────────────────────────────────────
try {
  const cols = db.prepare("PRAGMA table_info(apps)").all();
  if (!cols.find(c => c.name === 'owner_user_id')) {
    db.exec("ALTER TABLE apps ADD COLUMN owner_user_id INTEGER DEFAULT NULL");
  }
  if (!cols.find(c => c.name === 'guest_key')) {
    db.exec("ALTER TABLE apps ADD COLUMN guest_key TEXT DEFAULT NULL");
  }
  if (!cols.find(c => c.name === 'preview_slug')) {
    db.exec("ALTER TABLE apps ADD COLUMN preview_slug TEXT DEFAULT NULL");
  }
  if (!cols.find(c => c.name === 'ai_model_key')) {
    db.exec("ALTER TABLE apps ADD COLUMN ai_model_key TEXT DEFAULT NULL");
  }
  if (!cols.find(c => c.name === 'last_access_at')) {
    db.exec("ALTER TABLE apps ADD COLUMN last_access_at TEXT DEFAULT NULL");
    db.exec("UPDATE apps SET last_access_at = datetime('now') WHERE last_access_at IS NULL");
  }
  if (!cols.find(c => c.name === 'review_status')) {
    db.exec("ALTER TABLE apps ADD COLUMN review_status TEXT DEFAULT 'none'");
    db.exec("UPDATE apps SET review_status = 'none' WHERE review_status IS NULL OR review_status = ''");
  }
  if (!cols.find(c => c.name === 'publish_status')) {
    db.exec("ALTER TABLE apps ADD COLUMN publish_status TEXT DEFAULT 'idle'");
    db.exec("UPDATE apps SET publish_status = 'idle' WHERE publish_status IS NULL OR publish_status = ''");
  }
  if (!cols.find(c => c.name === 'runtime_mode')) {
    db.exec("ALTER TABLE apps ADD COLUMN runtime_mode TEXT DEFAULT 'local'");
    db.exec("UPDATE apps SET runtime_mode = CASE WHEN status = 'published' THEN 'server' ELSE 'local' END WHERE runtime_mode IS NULL OR runtime_mode = ''");
  }
  if (!cols.find(c => c.name === 'app_role')) {
    db.exec("ALTER TABLE apps ADD COLUMN app_role TEXT DEFAULT 'release'");
    db.exec("UPDATE apps SET app_role = CASE WHEN status = 'published' THEN 'release' ELSE 'draft' END WHERE app_role IS NULL OR app_role = ''");
  }
  if (!cols.find(c => c.name === 'release_app_id')) {
    db.exec("ALTER TABLE apps ADD COLUMN release_app_id INTEGER DEFAULT NULL");
  }
  if (!cols.find(c => c.name === 'app_stage')) {
    db.exec("ALTER TABLE apps ADD COLUMN app_stage TEXT DEFAULT 'prototype'");
    db.exec(`UPDATE apps
      SET app_stage = CASE
        WHEN status = 'published' AND runtime_mode = 'server' THEN 'published_live'
        WHEN publish_status = 'failed' THEN 'release_blocked'
        WHEN runtime_mode = 'server' THEN 'backend_verified'
        WHEN current_version > 0 THEN 'frontend_ready'
        ELSE 'prototype'
      END
      WHERE app_stage IS NULL OR app_stage = ''`);
  }
  if (!cols.find(c => c.name === 'stage_reason')) {
    db.exec("ALTER TABLE apps ADD COLUMN stage_reason TEXT DEFAULT NULL");
  }
  if (!cols.find(c => c.name === 'workspace_slug')) {
    db.exec("ALTER TABLE apps ADD COLUMN workspace_slug TEXT DEFAULT NULL");
  }
  if (!cols.find(c => c.name === 'release_state')) {
    db.exec("ALTER TABLE apps ADD COLUMN release_state TEXT DEFAULT 'draft'");
  }
  db.exec(`UPDATE apps SET release_state = CASE
    WHEN publish_status = 'publishing' THEN 'candidate'
    WHEN publish_status = 'failed' OR app_stage IN ('release_blocked','repair_needed') THEN 'failed'
    WHEN runtime_mode = 'server' AND status != 'draft' THEN 'live'
    ELSE 'draft'
  END`);
  if (!cols.find(c => c.name === 'live_version_id')) {
    db.exec("ALTER TABLE apps ADD COLUMN live_version_id INTEGER DEFAULT NULL");
  }
  if (!cols.find(c => c.name === 'candidate_version_id')) {
    db.exec("ALTER TABLE apps ADD COLUMN candidate_version_id INTEGER DEFAULT NULL");
  }
  if (!cols.find(c => c.name === 'last_failure_reason')) {
    db.exec("ALTER TABLE apps ADD COLUMN last_failure_reason TEXT DEFAULT NULL");
  }
  if (!cols.find(c => c.name === 'last_failure_at')) {
    db.exec("ALTER TABLE apps ADD COLUMN last_failure_at TEXT DEFAULT NULL");
  }
  if (!cols.find(c => c.name === 'last_promoted_at')) {
    db.exec("ALTER TABLE apps ADD COLUMN last_promoted_at TEXT DEFAULT NULL");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_apps_preview_slug ON apps(preview_slug)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_apps_workspace_slug ON apps(workspace_slug)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_apps_release_app_id ON apps(release_app_id)");

  const publishJobCols = db.prepare("PRAGMA table_info(publish_jobs)").all();
  if (!publishJobCols.length) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS publish_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id INTEGER NOT NULL UNIQUE REFERENCES apps(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'idle',
        current_step TEXT DEFAULT NULL,
        steps_json TEXT NOT NULL DEFAULT '[]',
        error_message TEXT DEFAULT NULL,
        started_at TEXT DEFAULT NULL,
        completed_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  } else {
    if (!publishJobCols.find(c => c.name === 'current_step')) db.exec("ALTER TABLE publish_jobs ADD COLUMN current_step TEXT DEFAULT NULL");
    if (!publishJobCols.find(c => c.name === 'steps_json')) {
      db.exec("ALTER TABLE publish_jobs ADD COLUMN steps_json TEXT DEFAULT '[]'");
      db.exec("UPDATE publish_jobs SET steps_json = '[]' WHERE steps_json IS NULL OR steps_json = ''");
    }
    if (!publishJobCols.find(c => c.name === 'error_message')) db.exec("ALTER TABLE publish_jobs ADD COLUMN error_message TEXT DEFAULT NULL");
    if (!publishJobCols.find(c => c.name === 'started_at')) db.exec("ALTER TABLE publish_jobs ADD COLUMN started_at TEXT DEFAULT NULL");
    if (!publishJobCols.find(c => c.name === 'completed_at')) db.exec("ALTER TABLE publish_jobs ADD COLUMN completed_at TEXT DEFAULT NULL");
    if (!publishJobCols.find(c => c.name === 'updated_at')) db.exec("ALTER TABLE publish_jobs ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))");
  }

  const backupCols = db.prepare("PRAGMA table_info(app_release_backups)").all();
  if (!backupCols.length) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_release_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        release_app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        source_draft_app_id INTEGER DEFAULT NULL REFERENCES apps(id) ON DELETE SET NULL,
        backup_version_number INTEGER NOT NULL,
        release_version_number INTEGER DEFAULT NULL,
        name TEXT NOT NULL,
        icon TEXT NOT NULL,
        description TEXT DEFAULT '',
        color TEXT DEFAULT NULL,
        code TEXT DEFAULT '',
        server_code TEXT DEFAULT NULL,
        sql_code TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_access_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      visitor_key TEXT NOT NULL,
      source TEXT DEFAULT 'preview',
      path TEXT DEFAULT '/',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_app_access_events_app_created ON app_access_events(app_id, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_app_access_events_app_visitor ON app_access_events(app_id, visitor_key)");

  const platformProviderCols = db.prepare("PRAGMA table_info(platform_ai_providers)").all();
  if (!platformProviderCols.length) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_ai_providers (
        provider_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        auth_type TEXT NOT NULL,
        connection_status TEXT NOT NULL DEFAULT 'disconnected',
        credentials_json TEXT DEFAULT NULL,
        enabled_models_json TEXT NOT NULL DEFAULT '[]',
        default_model_id TEXT DEFAULT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        last_error TEXT DEFAULT NULL,
        metadata_json TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  } else {
    if (!platformProviderCols.find(c => c.name === 'connection_status')) db.exec("ALTER TABLE platform_ai_providers ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'disconnected'");
    if (!platformProviderCols.find(c => c.name === 'credentials_json')) db.exec("ALTER TABLE platform_ai_providers ADD COLUMN credentials_json TEXT DEFAULT NULL");
    if (!platformProviderCols.find(c => c.name === 'enabled_models_json')) {
      db.exec("ALTER TABLE platform_ai_providers ADD COLUMN enabled_models_json TEXT NOT NULL DEFAULT '[]'");
      db.exec("UPDATE platform_ai_providers SET enabled_models_json = '[]' WHERE enabled_models_json IS NULL OR enabled_models_json = ''");
    }
    if (!platformProviderCols.find(c => c.name === 'default_model_id')) db.exec("ALTER TABLE platform_ai_providers ADD COLUMN default_model_id TEXT DEFAULT NULL");
    if (!platformProviderCols.find(c => c.name === 'enabled')) db.exec("ALTER TABLE platform_ai_providers ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0");
    if (!platformProviderCols.find(c => c.name === 'last_error')) db.exec("ALTER TABLE platform_ai_providers ADD COLUMN last_error TEXT DEFAULT NULL");
    if (!platformProviderCols.find(c => c.name === 'metadata_json')) db.exec("ALTER TABLE platform_ai_providers ADD COLUMN metadata_json TEXT DEFAULT NULL");
    if (!platformProviderCols.find(c => c.name === 'created_at')) db.exec("ALTER TABLE platform_ai_providers ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))");
    if (!platformProviderCols.find(c => c.name === 'updated_at')) db.exec("ALTER TABLE platform_ai_providers ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  }

  const platformStateCols = db.prepare("PRAGMA table_info(platform_ai_state)").all();
  if (!platformStateCols.length) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_ai_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        default_model_key TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  } else {
    if (!platformStateCols.find(c => c.name === 'default_model_key')) db.exec("ALTER TABLE platform_ai_state ADD COLUMN default_model_key TEXT DEFAULT NULL");
    if (!platformStateCols.find(c => c.name === 'created_at')) db.exec("ALTER TABLE platform_ai_state ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))");
    if (!platformStateCols.find(c => c.name === 'updated_at')) db.exec("ALTER TABLE platform_ai_state ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  }
  db.prepare("INSERT OR IGNORE INTO platform_ai_state (id, default_model_key) VALUES (1, NULL)").run();
} catch (e) {
  console.warn('apps migration warning:', e.message);
}

module.exports = db;
