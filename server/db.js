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
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'published'
    current_version INTEGER NOT NULL DEFAULT 1,
    api_port INTEGER DEFAULT NULL,
    preview_slug TEXT DEFAULT NULL,
    last_access_at TEXT DEFAULT (datetime('now')),
    color TEXT DEFAULT NULL,
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
`);

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
  if (!cols.find(c => c.name === 'last_access_at')) {
    db.exec("ALTER TABLE apps ADD COLUMN last_access_at TEXT DEFAULT NULL");
    db.exec("UPDATE apps SET last_access_at = datetime('now') WHERE last_access_at IS NULL");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_apps_preview_slug ON apps(preview_slug)");
} catch (e) {
  console.warn('apps migration warning:', e.message);
}

module.exports = db;
