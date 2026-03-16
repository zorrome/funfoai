/**
 * Per-app backend manager (Docker mode)
 *
 * One app backend = one dedicated Docker container.
 * This avoids host-port mixups and enables strict app/container binding.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildHtml } = require('./preview-manager');

const PROJECT_ROOT_CONTAINER = path.join(__dirname, '..');
const PROJECT_ROOT_HOST = process.env.HOST_PROJECT_ROOT || PROJECT_ROOT_CONTAINER;
const APPS_DIR = path.join(PROJECT_ROOT_HOST, 'server', 'apps');
if (!fs.existsSync(APPS_DIR)) fs.mkdirSync(APPS_DIR, { recursive: true });

const CONTAINER_PREFIX = 'funfo-app-';
const APP_PORT = 3001; // fixed inside app container

function sh(cmd, args = [], opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function containerName(appId) {
  return `${CONTAINER_PREFIX}${Number(appId)}`;
}

/**
 * Reorder Express route definitions so that static segments
 * (e.g. /api/users/stats) are registered BEFORE parameterized
 * segments (e.g. /api/users/:id).  This prevents Express from
 * matching "stats" as a :param and returning wrong results / 404.
 */
function reorderExpressRoutes(code) {
  if (!code || typeof code !== 'string') return code || '';

  // Extract all app.METHOD('...') blocks
  const routeBlockRe = /^(app\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]+)['"`][\s\S]*?\n\}\s*\)\s*;?\s*)$/gm;
  const blocks = [];
  let lastIndex = 0;
  const preamble = [];  // non-route code lines (variable declarations, helpers, etc.)
  let match;

  // Split into route blocks and non-route code
  const lines = code.split('\n');
  let currentBlock = [];
  let inRoute = false;
  let braceDepth = 0;
  const routeEntries = [];
  const nonRouteLines = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const routeStart = /^\s*app\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]+)['"`]/.exec(line);

    if (!inRoute && routeStart) {
      inRoute = true;
      currentBlock = [line];
      braceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      // Check if single-line route
      if (braceDepth <= 0 && /\)\s*;?\s*$/.test(line)) {
        routeEntries.push({ path: routeStart[2], method: routeStart[1], code: currentBlock.join('\n') });
        inRoute = false;
        currentBlock = [];
      }
    } else if (inRoute) {
      currentBlock.push(line);
      braceDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (braceDepth <= 0 && /\)\s*;?\s*$/.test(line)) {
        const startLine = currentBlock[0];
        const rm = /^\s*app\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]+)['"`]/.exec(startLine);
        routeEntries.push({ path: rm ? rm[2] : '', method: rm ? rm[1] : '', code: currentBlock.join('\n') });
        inRoute = false;
        currentBlock = [];
      }
    } else {
      nonRouteLines.push(line);
    }
    i++;
  }
  // If we were still in a route when code ended
  if (inRoute && currentBlock.length) {
    const startLine = currentBlock[0];
    const rm = /^\s*app\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]+)['"`]/.exec(startLine);
    routeEntries.push({ path: rm ? rm[2] : '', method: rm ? rm[1] : '', code: currentBlock.join('\n') });
  }

  if (routeEntries.length < 2) return code; // nothing to reorder

  // Sort: static paths before parameterized ones at the same prefix level
  routeEntries.sort((a, b) => {
    const segA = a.path.split('/').filter(Boolean);
    const segB = b.path.split('/').filter(Boolean);
    // Compare segment by segment
    const len = Math.max(segA.length, segB.length);
    for (let j = 0; j < len; j++) {
      const sa = segA[j] || '';
      const sb = segB[j] || '';
      const aParam = sa.startsWith(':');
      const bParam = sb.startsWith(':');
      if (!aParam && bParam) return -1;  // static before param
      if (aParam && !bParam) return 1;
      if (sa < sb) return -1;
      if (sa > sb) return 1;
    }
    return 0;
  });

  // Reassemble: non-route preamble first, then sorted routes
  return nonRouteLines.join('\n') + '\n\n' + routeEntries.map(e => e.code).join('\n\n');
}

function buildServerJs(appId, routeCode) {
  const orderedRouteCode = reorderExpressRoutes(routeCode);
  return `'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express  = require('express');
const cors     = require('cors');
const Database = require('better-sqlite3');

const app = express();
const APP_ID = ${Number(appId)};
const PORT = Number(process.env.PORT || ${APP_PORT});
const APP_DB_MODE = process.env.APP_DB_MODE || 'dev';
const DB_FILE = process.env.DB_FILE || (APP_DB_MODE === 'prod' ? 'data_prod.sqlite' : 'data_dev.sqlite');
const db = new Database(DB_FILE);
const FRONTEND_HTML = path.join(__dirname, 'index.html');
const ASSETS_DIR = path.join(__dirname, 'runtime-assets');

db.pragma('journal_mode = WAL');

db.exec(\`\
  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'schema.sql',
    applied_at TEXT DEFAULT (datetime('now'))
  );
\`);

function applySchemaIfChanged() {
  try {
    if (!fs.existsSync('schema.sql')) return;
    const schema = fs.readFileSync('schema.sql', 'utf8');
    if (!schema || !schema.trim()) return;

    const hash = crypto.createHash('sha256').update(schema).digest('hex');
    const exists = db.prepare('SELECT id FROM schema_migrations WHERE hash = ?').get(hash);
    if (exists) return;

    db.exec('BEGIN');
    db.exec(schema);
    db.prepare('INSERT INTO schema_migrations (hash, source) VALUES (?, ?)').run(hash, 'schema.sql');
    db.prepare(\`INSERT INTO schema_meta (key, value, updated_at)
      VALUES ('schema_hash', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')\`).run(hash);
    db.prepare(\`INSERT INTO schema_meta (key, value, updated_at)
      VALUES ('schema_version', CAST((SELECT COUNT(*) FROM schema_migrations) AS TEXT), datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = CAST((SELECT COUNT(*) FROM schema_migrations) AS TEXT), updated_at = datetime('now')\`).run();
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    console.warn('[app] schema apply warning:', e.message);
  }
}

applySchemaIfChanged();

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, appId: APP_ID, port: PORT, dbFile: DB_FILE, dbMode: APP_DB_MODE, frontend: fs.existsSync(FRONTEND_HTML) }));

${orderedRouteCode}

app.use(express.static(ASSETS_DIR, { fallthrough: true, maxAge: '1h' }));

app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    method: req.method,
    path: req.path,
    hint: 'This route was not generated. Ask AI to add it.',
  });
});

app.use((req, res) => {
  if (fs.existsSync(FRONTEND_HTML)) {
    return res.type('html').send(fs.readFileSync(FRONTEND_HTML, 'utf8'));
  }
  res.status(404).json({
    error: 'Route not found',
    method: req.method,
    path: req.path,
    hint: 'Frontend runtime missing',
  });
});

app.use((err, req, res, next) => {
  console.error('[app] Error:', err.message);
  res.status(500).json({ error: err.message, stack: err.stack });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ App backend on :' + PORT + ' app=' + APP_ID + ' db=' + DB_FILE + ' mode=' + APP_DB_MODE);
});
`;
}

function scaffoldAppFolder(appId, routeCode, schemaSql = '', frontendCode = '', slug = null) {
  const dir = path.join(APPS_DIR, String(appId));
  fs.mkdirSync(dir, { recursive: true });

  const assetsDir = path.join(dir, 'runtime-assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: `funfo-app-${appId}`,
      version: '1.0.0',
      main: 'server.js',
      dependencies: {
        express: '^4.21.2',
        cors: '^2.8.6',
        'better-sqlite3': '^12.6.2',
      },
    }, null, 2));
  }

  if (schemaSql && schemaSql.trim()) {
    fs.writeFileSync(path.join(dir, 'schema.sql'), schemaSql);
  }

  const bundleFiles = ['react.js', 'react-is.js', 'react-dom.js', 'prop-types.js', 'recharts.js'];
  for (const file of bundleFiles) {
    const src = path.join(__dirname, 'assets', file);
    const dst = path.join(assetsDir, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, dst);
  }

  const html = buildHtml(frontendCode || '<div style={{padding:24}}>App runtime is preparing...</div>', slug ? `/app/${slug}` : '/api');
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'server.js'), buildServerJs(appId, routeCode));
  return { dir };
}

function dockerContainerExists(name) {
  const r = sh('docker', ['inspect', name]);
  return r.status === 0;
}

function dockerRemoveContainer(name) {
  if (!dockerContainerExists(name)) return;
  sh('docker', ['rm', '-f', name]);
}

function ensureDockerNetwork() {
  // best effort (compose default network usually already exists)
  const r = sh('docker', ['network', 'inspect', 'funfo_ai_store_default']);
  if (r.status !== 0) sh('docker', ['network', 'create', 'funfo_ai_store_default']);
}

function dockerRunAppContainer(appId, slug, appDir, options = {}) {
  const name = containerName(appId);
  dockerRemoveContainer(name);
  ensureDockerNetwork();

  const appDbMode = options.dbMode || process.env.APP_DB_MODE || 'dev';
  const backendRunnerImage = process.env.APP_BACKEND_RUNNER_IMAGE || 'funfo_ai_store-funfo-ai-store:latest';
  const cmd = [
    'run', '-d',
    '--name', name,
    '--restart', 'unless-stopped',
    '--label', `funfo.app_id=${Number(appId)}`,
    '--label', `funfo.slug=${slug || ''}`,
    '--network', 'funfo_ai_store_default',
    '-p', `127.0.0.1::${APP_PORT}`,
    '-v', `${appDir}:/workspace/app`,
    '-w', '/workspace/app',
    '-e', `PORT=${APP_PORT}`,
    '-e', `APP_DB_MODE=${appDbMode}`,
    '-e', 'NODE_PATH=/app/node_modules',
    backendRunnerImage,
    'sh', '-lc',
    'node server.js',
  ];

  const r = sh('docker', cmd);
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'docker run failed');
  return (r.stdout || '').trim();
}

function inspectContainer(name) {
  const r = sh('docker', ['inspect', name]);
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout)[0] || null; } catch { return null; }
}

function getContainerRuntime(appId) {
  const name = containerName(appId);
  const obj = inspectContainer(name);
  if (!obj) return null;
  const nets = obj?.NetworkSettings?.Networks || {};
  const firstNet = Object.keys(nets)[0];
  const ip = firstNet ? nets[firstNet]?.IPAddress : null;
  const portBindings = obj?.NetworkSettings?.Ports || {};
  const hostPort = Number(portBindings?.[`${APP_PORT}/tcp`]?.[0]?.HostPort || 0) || null;
  return {
    appId: Number(appId),
    containerName: name,
    containerId: obj.Id,
    running: !!obj?.State?.Running,
    ip: ip || null,
    hostPort,
    labels: obj?.Config?.Labels || {},
  };
}

function stopAppBackend(appId) {
  dockerRemoveContainer(containerName(appId));
}

function getAppBackendLogs(appId, tail = 120) {
  const name = containerName(appId);
  const r = sh('docker', ['logs', '--tail', String(Math.max(1, Number(tail) || 120)), name]);
  const text = [r.stdout || '', r.stderr || ''].filter(Boolean).join('\n').trim();
  return {
    ok: r.status === 0,
    containerName: name,
    text,
  };
}

async function deployAppBackend(appId, routeCode, schemaSql = '', slug = null, options = {}) {
  const { dir } = scaffoldAppFolder(appId, routeCode, schemaSql, options.frontendCode || '', slug);
  dockerRunAppContainer(appId, slug, dir, options);
  console.log(`🚀 App ${appId} backend(container) started mode=${options.dbMode || process.env.APP_DB_MODE || 'dev'}`);
  return null;
}

function getApiPort() {
  return null; // host port no longer used in docker-per-app mode
}

async function restoreBackendsFromDb(db) {
  const rows = db.prepare(`
    SELECT
      a.id,
      a.preview_slug,
      a.app_role,
      a.runtime_mode,
      (SELECT code        FROM app_versions av WHERE av.app_id = a.id ORDER BY av.version_number DESC, av.id DESC LIMIT 1) AS code,
      (SELECT server_code FROM app_versions av WHERE av.app_id = a.id ORDER BY av.version_number DESC, av.id DESC LIMIT 1) AS server_code,
      (SELECT sql_code    FROM app_versions av WHERE av.app_id = a.id ORDER BY av.version_number DESC, av.id DESC LIMIT 1) AS sql_code
    FROM apps a
  `).all();

  for (const row of rows) {
    if (!row.server_code || !row.server_code.trim()) continue;
    try {
      await deployAppBackend(row.id, row.server_code, row.sql_code || '', row.preview_slug || null, {
        dbMode: (row.app_role === 'release' || row.runtime_mode === 'server') ? 'prod' : 'dev',
        frontendCode: row.code || '',
      });
      console.log(`🔄 Restored app ${row.id} backend(container)`);
    } catch (e) {
      console.warn(`  ⚠️  restore app ${row.id} failed: ${e.message}`);
    }
  }
}

module.exports = {
  deployAppBackend,
  stopAppBackend,
  getAppBackendLogs,
  getApiPort,
  restoreBackendsFromDb,
  getContainerRuntime,
};
