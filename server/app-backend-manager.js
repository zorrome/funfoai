/**
 * Per-app backend manager (Docker mode)
 *
 * One app backend = one dedicated Docker container.
 * This avoids host-port mixups and enables strict app/container binding.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

function buildServerJs(appId, routeCode, dbPath) {
  return `'use strict';
const fs = require('fs');
const express  = require('express');
const cors     = require('cors');
const Database = require('better-sqlite3');

const app = express();
const db  = new Database(${JSON.stringify(dbPath)});
const APP_ID = ${Number(appId)};
const PORT = Number(process.env.PORT || ${APP_PORT});

db.pragma('journal_mode = WAL');

try {
  if (fs.existsSync('schema.sql')) {
    const schema = fs.readFileSync('schema.sql', 'utf8');
    if (schema && schema.trim()) db.exec(schema);
  }
} catch (e) {
  console.warn('[app] schema apply warning:', e.message);
}

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, appId: APP_ID, port: PORT }));

${routeCode}

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    method: req.method,
    path: req.path,
    hint: 'This route was not generated. Ask AI to add it.',
  });
});

app.use((err, req, res, next) => {
  console.error('[app] Error:', err.message);
  res.status(500).json({ error: err.message, stack: err.stack });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ App backend on :' + PORT + ' app=' + APP_ID);
});
`;
}

function scaffoldAppFolder(appId, routeCode, schemaSql = '') {
  const dir = path.join(APPS_DIR, String(appId));
  const dbPath = path.join(dir, 'data.sqlite');
  fs.mkdirSync(dir, { recursive: true });

  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: `funfo-app-${appId}`,
      version: '1.0.0',
      main: 'server.js',
      dependencies: {
        express: '^4.21.2',
        cors: '^2.8.6',
        'better-sqlite3': '^9.6.0',
      },
    }, null, 2));
  }

  if (schemaSql && schemaSql.trim()) {
    fs.writeFileSync(path.join(dir, 'schema.sql'), schemaSql);
  }

  fs.writeFileSync(path.join(dir, 'server.js'), buildServerJs(appId, routeCode, 'data.sqlite'));
  return { dir, dbPath };
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

function dockerRunAppContainer(appId, slug, appDir) {
  const name = containerName(appId);
  dockerRemoveContainer(name);
  ensureDockerNetwork();

  const cmd = [
    'run', '-d',
    '--name', name,
    '--restart', 'unless-stopped',
    '--label', `funfo.app_id=${Number(appId)}`,
    '--label', `funfo.slug=${slug || ''}`,
    '--network', 'funfo_ai_store_default',
    '-v', `${appDir}:/app`,
    '-w', '/app',
    '-e', `PORT=${APP_PORT}`,
    'node:20-alpine',
    'sh', '-lc',
    'if [ ! -d node_modules ]; then npm install --omit=dev; fi; node server.js',
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
  return {
    appId: Number(appId),
    containerName: name,
    containerId: obj.Id,
    running: !!obj?.State?.Running,
    ip: ip || null,
    labels: obj?.Config?.Labels || {},
  };
}

function stopAppBackend(appId) {
  dockerRemoveContainer(containerName(appId));
}

async function deployAppBackend(appId, routeCode, schemaSql = '', slug = null) {
  const { dir } = scaffoldAppFolder(appId, routeCode, schemaSql);
  dockerRunAppContainer(appId, slug, dir);
  console.log(`🚀 App ${appId} backend(container) started`);
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
      (SELECT server_code FROM app_versions av WHERE av.app_id = a.id ORDER BY av.version_number DESC, av.id DESC LIMIT 1) AS server_code,
      (SELECT sql_code    FROM app_versions av WHERE av.app_id = a.id ORDER BY av.version_number DESC, av.id DESC LIMIT 1) AS sql_code
    FROM apps a
  `).all();

  for (const row of rows) {
    if (!row.server_code || !row.server_code.trim()) continue;
    try {
      await deployAppBackend(row.id, row.server_code, row.sql_code || '', row.preview_slug || null);
      console.log(`🔄 Restored app ${row.id} backend(container)`);
    } catch (e) {
      console.warn(`  ⚠️  restore app ${row.id} failed: ${e.message}`);
    }
  }
}

module.exports = {
  deployAppBackend,
  stopAppBackend,
  getApiPort,
  restoreBackendsFromDb,
  getContainerRuntime,
};
