const fs      = require('fs');
const path    = require('path');
const express = require('express');
const cors    = require('cors');
const os      = require('os');
const net     = require('net');
const http    = require('http');
const crypto  = require('crypto');
const babel   = require('@babel/core');
const BetterSqlite3 = require('better-sqlite3');
const db      = require('./db');

const BABEL_PRESET_REACT = require.resolve('@babel/preset-react');
const BABEL_PLUGIN_REACT_JSX = require.resolve('@babel/plugin-transform-react-jsx');
const { startPreview, stopPreview, getPreviewPort, getPreviewSessionBySlug, restoreFromDb, proxyPreviewRequest } = require('./preview-manager');
const { deployAppBackend, stopAppBackend, getAppBackendLogs, getApiPort, restoreBackendsFromDb, getContainerRuntime } = require('./app-backend-manager');
const { buildWorkspaceHistory, buildModePrompt, runRepairPass } = require('./modes/workspace');
const { createDocsModule } = require('./docs');
const { createValidationModule } = require('./validation');
const { createPublishModule } = require('./publish');
const { createPublishPipeline } = require('./publish/pipeline');
const { createVerifierModule } = require('./verifier');
const { runBrowserSmoke } = require('./browser-smoke');
const { BASE_SYSTEM_PROMPT, buildFailureContextRepairPrompt } = require('./prompts');
const { ensureAppMemoryFiles, ensureUserContextDir, appendAppMemory, appendAppFailures, appendAppReleaseNotes, writeAppContextManifest } = require('./context-loader');
const {
  buildRepairSystemPrompt,
} = require('./prompt-orchestrator');
const {
  callLlmOnce,
  streamLlmText,
  getLlmProviderSummary,
  resolveSelectedModelKey,
  getPublicModelCatalog,
  getAdminAiConfig,
  saveAnthropicProvider,
  updatePlatformProviderModels,
  disconnectPlatformProvider,
  updatePlatformDefaultModel,
  startOpenAICodexOAuthSession,
  getOpenAICodexOAuthSession,
  submitOpenAICodexOAuthManualInput,
} = require('./llm-provider');

const app   = express();
const PORT  = Number(process.env.PORT || '3100');

// ── Auto-detect LAN IP ────────────────────────────────────────────────
// Used so preview iframes inject the correct API_BASE for LAN clients
function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}
const SERVER_HOST = getLanIp();
console.log(`🌐 Server LAN IP: ${SERVER_HOST}`);
const llmProviderSummary = getLlmProviderSummary();
console.log(`🤖 App generation provider: ${llmProviderSummary.configured ? `${llmProviderSummary.provider}:${llmProviderSummary.model || 'unset-model'}` : 'unconfigured'}`);
const REQ_CARD_PREFIX = '__FUNFO_REQ__';

// Auto-fix guardrails (prevent infinite repair loops)
const autoFixInFlight = new Set(); // appId
const autoFixCooldownUntil = new Map(); // appId -> epoch ms

// ── System Prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = BASE_SYSTEM_PROMPT;

app.use(cors());
app.use(express.json());
app.get('/api/__build_tag', (_req, res) => res.json({ tag: 'p0-state-machine-20260312-1918' }));
app.get('/api/ai/models', async (_req, res) => {
  try {
    const catalog = await getPublicModelCatalog();
    res.json({ ok: true, models: catalog.models, defaultModelKey: catalog.defaultModelKey });
  } catch (e) {
    res.status(500).json({ error: `ai model catalog failed: ${String(e?.message || e)}` });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────

function randomSlug(len = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function ensurePreviewSlug(appId) {
  const row = db.prepare('SELECT preview_slug FROM apps WHERE id = ?').get(appId);
  if (!row) return null;
  if (row.preview_slug) return row.preview_slug;

  for (let i = 0; i < 20; i++) {
    const slug = randomSlug(8);
    const exists = db.prepare('SELECT id FROM apps WHERE preview_slug = ?').get(slug);
    if (!exists) {
      db.prepare('UPDATE apps SET preview_slug = ? WHERE id = ?').run(slug, appId);
      return slug;
    }
  }
  return null;
}

function ensureWorkspaceSlug(appId) {
  const row = db.prepare('SELECT workspace_slug FROM apps WHERE id = ?').get(appId);
  if (!row) return null;
  if (row.workspace_slug) return row.workspace_slug;

  for (let i = 0; i < 20; i++) {
    const slug = `w_${randomSlug(12)}`;
    const exists = db.prepare('SELECT id FROM apps WHERE workspace_slug = ?').get(slug);
    if (!exists) {
      db.prepare('UPDATE apps SET workspace_slug = ? WHERE id = ?').run(slug, appId);
      return slug;
    }
  }
  return null;
}

const WORKSPACE_PREVIEW_SUFFIX = '_preview';

function buildWorkspacePublicPath(workspaceSlug) {
  const slug = String(workspaceSlug || '').trim();
  return slug ? `/w/${slug}` : null;
}

function buildWorkspacePreviewPath(workspaceSlug) {
  const slug = String(workspaceSlug || '').trim();
  return slug ? `/w/${slug}${WORKSPACE_PREVIEW_SUFFIX}` : null;
}

function buildWorkspacePublicUrl(workspaceSlug) {
  const path = buildWorkspacePublicPath(workspaceSlug);
  return path ? `http://${SERVER_HOST}:${PORT}${path}` : null;
}

function buildWorkspacePreviewUrl(workspaceSlug) {
  const path = buildWorkspacePreviewPath(workspaceSlug);
  return path ? `http://${SERVER_HOST}:${PORT}${path}` : null;
}

function parseWorkspaceRouteToken(rawToken = '') {
  const token = String(rawToken || '').trim();
  const isPreview = token.endsWith(WORKSPACE_PREVIEW_SUFFIX);
  const workspaceSlug = isPreview ? token.slice(0, -WORKSPACE_PREVIEW_SUFFIX.length) : token;
  return { token, workspaceSlug, isPreview };
}

function deriveReleaseState(appRow, publishJob = null) {
  if (!appRow) return 'draft';
  if (appRow.release_state) return appRow.release_state;
  const publishStatus = appRow.publish_status || publishJob?.status || 'idle';
  const stage = appRow.app_stage || '';
  if (publishStatus === 'publishing') return 'candidate';
  if (publishStatus === 'failed' || stage === 'release_blocked' || stage === 'repair_needed') return 'failed';
  if ((appRow.runtime_mode === 'server' && (appRow.release_state || 'draft') !== 'draft') || stage === 'published_live') return 'live';
  return 'draft';
}

function withPreviewLink(appRow) {
  if (!appRow) return appRow;
  const slug = appRow.preview_slug || ensurePreviewSlug(appRow.id);
  const workspaceSlug = appRow.workspace_slug || ensureWorkspaceSlug(appRow.id);
  return {
    ...appRow,
    release_state: appRow.release_state || deriveReleaseState(appRow),
    preview_slug: slug,
    workspace_slug: workspaceSlug,
    preview_path: buildWorkspacePreviewPath(workspaceSlug),
    preview_url: buildWorkspacePreviewUrl(workspaceSlug),
    public_path: buildWorkspacePublicPath(workspaceSlug),
    public_url: buildWorkspacePublicUrl(workspaceSlug),
    legacy_preview_path: slug ? `/app/${slug}` : null,
  };
}

function getEffectiveReleaseAppId(appRow) {
  if (!appRow) return null;
  if (appRow.app_role === 'draft' && appRow.release_app_id) return Number(appRow.release_app_id);
  return Number(appRow.id);
}

function isWorkspaceDraft(appRow) {
  return !!appRow && appRow.app_role === 'draft';
}

function isReleaseEditingLocked(appRow) {
  if (!appRow) return false;
  if (isWorkspaceDraft(appRow)) return false;
  return (appRow.release_state || deriveReleaseState(appRow)) === 'live' || appRow.runtime_mode === 'server';
}

function findExistingWorkspaceDraftForRelease(releaseAppId, ownerUserId) {
  if (!releaseAppId || !ownerUserId) return null;
  return db.prepare(`
    SELECT * FROM apps
    WHERE owner_user_id = ? AND app_role = 'draft' AND release_app_id = ?
    ORDER BY datetime(updated_at) DESC, id DESC
    LIMIT 1
  `).get(ownerUserId, releaseAppId);
}

async function cloneReleaseToWorkspaceDraft(sourceReleaseId, ownerUserId) {
  const source = db.prepare('SELECT * FROM apps WHERE id = ?').get(sourceReleaseId);
  if (!source) throw new Error('Live App が見つかりません');
  if ((source.release_state || deriveReleaseState(source)) !== 'live') throw new Error('Live release のみワークスペース化できます');

  let newAppId = null;
  let lastVersion = 1;
  const tx = db.transaction(() => {
    const r = db.prepare(
      "INSERT INTO apps (owner_user_id, name, icon, description, status, app_role, release_app_id, current_version, color, runtime_mode, ai_model_key) VALUES (?, ?, ?, ?, 'draft', 'draft', ?, ?, ?, 'local', ?)"
    ).run(ownerUserId, `${source.name}（ワークスペース）`, source.icon, source.description || '', source.id, Number(source.current_version || 1), source.color || null, source.ai_model_key || null);

    newAppId = Number(r.lastInsertRowid);
    const versionsRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number ASC').all(source.id);
    const versions = hydrateVersionRows(source.id, versionsRaw);
    for (const v of versions) {
      db.prepare(
        'INSERT INTO app_versions (app_id, version_number, label, code, server_code, sql_code) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(newAppId, v.version_number, v.label, '', '', '');
    }
    const mv = db.prepare('SELECT MAX(version_number) as mv FROM app_versions WHERE app_id = ?').get(newAppId).mv || 1;
    lastVersion = Number(mv || 1);
    db.prepare("UPDATE apps SET current_version = ?, updated_at = datetime('now') WHERE id = ?").run(lastVersion, newAppId);
  });
  tx();

  cloneAppAllFiles(source.id, newAppId);
  const sourceVersionsRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number ASC').all(source.id);
  const sourceVersions = hydrateVersionRows(source.id, sourceVersionsRaw);
  for (const v of sourceVersions) {
    const srcFiles = readVersionFiles(source.id, v.version_number);
    const codeToUse = v.code || srcFiles.code || '';
    const serverToUse = v.server_code || srcFiles.server_code || '';
    const sqlToUse = v.sql_code || srcFiles.sql_code || '';
    writeVersionFiles(newAppId, v.version_number, codeToUse, serverToUse, sqlToUse);
  }

  validateClonedAppFiles(newAppId, lastVersion);

  const latestRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(newAppId);
  const latest = hydrateVersionRow(newAppId, latestRaw);

  if (latest) {
    appendAppSpecSnapshot(newAppId, `${source.name}（コピー）`, latest.version_number || lastVersion, latest.code || '', latest.server_code || '', latest.sql_code || '');
    writeApiAndDbDocs(newAppId, `${source.name}（コピー）`, latest.version_number || lastVersion, latest.code || '', latest.server_code || '', latest.sql_code || '');
  }

  let apiPort = null;
  if (latest?.server_code) {
    apiPort = await deployAppBackend(newAppId, latest.server_code, latest.sql_code || '', ensurePreviewSlug(newAppId), { frontendCode: latest.code || '', dbMode: 'dev' });
    if (apiPort) db.prepare('UPDATE apps SET api_port = ? WHERE id = ?').run(apiPort, newAppId);
  }
  const previewSlug = ensurePreviewSlug(newAppId);
  if (latest?.code) startPreview(newAppId, latest.code, '', previewSlug);

  ensureAppFilesMaterializedFromDb(newAppId);
  db.prepare("UPDATE apps SET owner_user_id = ?, guest_key = NULL, updated_at = datetime('now') WHERE id = ?").run(ownerUserId, newAppId);
  return db.prepare('SELECT * FROM apps WHERE id = ?').get(newAppId);
}

async function ensureWorkspaceDraftFromRelease(sourceReleaseId, ownerUserId) {
  const existing = findExistingWorkspaceDraftForRelease(sourceReleaseId, ownerUserId);
  if (existing) {
    ensureAppFilesMaterializedFromDb(existing.id);
    touchAppAccess(existing.id);
    return { app: existing, created: false };
  }
  const createdApp = await cloneReleaseToWorkspaceDraft(sourceReleaseId, ownerUserId);
  touchAppAccess(createdApp.id);
  return { app: createdApp, created: true };
}

function buildWorkspaceDraftRedirectPayload(sourceAppRow, draftAppRow, created = false) {
  const releaseAppId = getEffectiveReleaseAppId(sourceAppRow);
  const withLink = withPreviewLink(draftAppRow);
  return {
    error: 'Live release 不能直接编辑。请打开对应的 Workspace 草稿。',
    code: 'RELEASE_EDIT_REDIRECT',
    needs_workspace_draft: true,
    created_workspace_draft: !!created,
    release_app_id: releaseAppId,
    workspace_draft: {
      ...withLink,
      preview_port: getPreviewPort(draftAppRow.id),
      api_port: getApiPort(draftAppRow.id) ?? draftAppRow.api_port,
    },
  };
}

function createReleaseBackupSnapshot(releaseAppId, sourceDraftAppId = null) {
  const releaseRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(releaseAppId);
  if (!releaseRow) throw new Error('release app not found');
  const latestRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(releaseAppId);
  const latest = hydrateVersionRow(releaseAppId, latestRaw);
  const nextBackupVersion = Number((db.prepare('SELECT MAX(backup_version_number) as mv FROM app_release_backups WHERE release_app_id = ?').get(releaseAppId)?.mv || 0) + 1);
  db.prepare(`
    INSERT INTO app_release_backups (
      release_app_id, source_draft_app_id, backup_version_number, release_version_number,
      name, icon, description, color, code, server_code, sql_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    releaseAppId,
    sourceDraftAppId || null,
    nextBackupVersion,
    latest?.version_number || releaseRow.current_version || 1,
    releaseRow.name || '新規アプリ',
    releaseRow.icon || '✨',
    releaseRow.description || '',
    releaseRow.color || null,
    latest?.code || '',
    latest?.server_code || '',
    latest?.sql_code || '',
  );
  return nextBackupVersion;
}

function touchAppAccess(appId) {
  if (!appId) return;
  db.prepare("UPDATE apps SET last_access_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(appId);
}

function buildVisitorKey(req) {
  const user = getAuthUser(req);
  if (user?.id) return `user:${user.id}`;
  const guestKey = getGuestKey(req);
  if (guestKey) return `guest:${guestKey}`;
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const ua = String(req.headers['user-agent'] || 'unknown');
  const raw = `${ip}|${ua}`;
  return `anon:${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16)}`;
}

function recordAppVisit(appId, req, source = 'preview') {
  if (!appId || !req) return;
  const visitorKey = buildVisitorKey(req);
  const pathPart = String(req.originalUrl || req.url || '/').slice(0, 400);
  db.prepare('INSERT INTO app_access_events (app_id, visitor_key, source, path) VALUES (?, ?, ?, ?)').run(appId, visitorKey, source, pathPart || '/');
}

function requireAppOwner(appId, userId) {
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return { error: 'Not found', status: 404, appRow: null };
  if (appRow.owner_user_id !== userId) return { error: '编辑权限不存在', status: 403, appRow };
  return { appRow, error: null, status: 200 };
}

function quoteSqliteIdentifier(name = '') {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function getAppDbPath(appId) {
  return path.join(ensureAppRuntimeDir(appId), 'data_prod.sqlite');
}

function getAppSchemaPath(appId) {
  return path.join(ensureAppRuntimeDir(appId), 'schema.sql');
}

function listAppDatabaseTables(appId) {
  const dbPath = getAppDbPath(appId);
  if (!fs.existsSync(dbPath)) return { dbPath, exists: false, tables: [] };
  const sqlite = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const tables = rows.map((row) => {
      const tableName = String(row.name || '');
      const cols = sqlite.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`).all().map(c => c.name);
      let rowCount = null;
      try {
        rowCount = Number(sqlite.prepare(`SELECT COUNT(*) as c FROM ${quoteSqliteIdentifier(tableName)}`).get().c || 0);
      } catch {}
      return { name: tableName, rowCount, columns: cols };
    });
    return { dbPath, exists: true, tables };
  } finally {
    try { sqlite.close(); } catch {}
  }
}

function buildAnalyticsBuckets(range = 'day') {
  const buckets = [];
  const now = new Date();
  const count = range === 'month' ? 12 : range === 'week' ? 12 : 14;
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now);
    if (range === 'month') d.setUTCMonth(d.getUTCMonth() - i, 1);
    else if (range === 'week') d.setUTCDate(d.getUTCDate() - (i * 7));
    else d.setUTCDate(d.getUTCDate() - i);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    let bucket = `${year}-${month}-${day}`;
    let label = `${month}/${day}`;
    if (range === 'week') {
      const start = new Date(d);
      start.setUTCDate(d.getUTCDate() - d.getUTCDay());
      const y = start.getUTCFullYear();
      const m = String(start.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(start.getUTCDate()).padStart(2, '0');
      bucket = `${y}-W${m}${dd}`;
      label = `${m}/${dd}`;
    }
    if (range === 'month') {
      bucket = `${year}-${month}`;
      label = `${year}/${month}`;
    }
    buckets.push({ bucket, label });
  }
  return buckets;
}

function getAppAnalytics(appId, range = 'day') {
  const rows = db.prepare('SELECT visitor_key, created_at FROM app_access_events WHERE app_id = ? ORDER BY created_at ASC').all(appId);
  const bucketMap = new Map(buildAnalyticsBuckets(range).map(item => [item.bucket, { ...item, visits: 0, activeUsersSet: new Set() }]));
  for (const row of rows) {
    const dt = new Date(String(row.created_at).replace(' ', 'T') + 'Z');
    if (Number.isNaN(dt.getTime())) continue;
    const year = dt.getUTCFullYear();
    const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dt.getUTCDate()).padStart(2, '0');
    let bucket = `${year}-${month}-${day}`;
    if (range === 'week') {
      const start = new Date(dt);
      start.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
      bucket = `${start.getUTCFullYear()}-W${String(start.getUTCMonth() + 1).padStart(2, '0')}${String(start.getUTCDate()).padStart(2, '0')}`;
    }
    if (range === 'month') bucket = `${year}-${month}`;
    const item = bucketMap.get(bucket);
    if (!item) continue;
    item.visits += 1;
    item.activeUsersSet.add(String(row.visitor_key || 'unknown'));
  }
  const points = [...bucketMap.values()].map(item => ({
    bucket: item.bucket,
    label: item.label,
    visits: item.visits,
    activeUsers: item.activeUsersSet.size,
  }));
  const summary = points.reduce((acc, item) => {
    acc.visits += item.visits;
    acc.activeUsers += item.activeUsers;
    return acc;
  }, { visits: 0, activeUsers: 0 });
  const appRow = db.prepare('SELECT last_access_at FROM apps WHERE id = ?').get(appId);
  return { range, summary: { ...summary, lastVisitedAt: appRow?.last_access_at || null }, points };
}

async function wakeAppRuntime(appId) {
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return { previewPort: null, apiPort: null };

  const latestRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appId);
  const latest = hydrateVersionRow(appId, latestRaw);
  const previewSlug = ensurePreviewSlug(appId);

  const contract = injectMissingApiStubs(latest?.code || '', latest?.server_code || '');
  const normalizedServer = normalizeBackendSqlStrings(contract.code || '');
  const serverToUse = normalizedServer.code || contract.code;

  let runtime = getContainerRuntime(appId);
  const labelOk = !!runtime && runtime.labels?.['funfo.app_id'] === String(appId) && runtime.labels?.['funfo.slug'] === String(previewSlug);
  if ((!runtime || !runtime.running || !labelOk) && serverToUse && serverToUse.trim()) {
    await deployAppBackend(appId, serverToUse, latest?.sql_code || '', previewSlug, { frontendCode: latest?.code || '', dbMode: appRow?.runtime_mode === 'server' ? 'prod' : 'dev' });
    runtime = getContainerRuntime(appId);
    if (latest?.id && (!latest.server_code || !latest.server_code.trim())) {
      db.prepare('UPDATE app_versions SET server_code = ? WHERE id = ?').run(serverToUse, latest.id);
    }
  }

  let previewPort = null;
  if (appRow.runtime_mode !== 'server') {
    previewPort = startPreview(appId, latest?.code || '', '', previewSlug);
  }
  touchAppAccess(appId);
  return { previewPort, apiPort: null };
}

async function resolveVerifierBrowserSmokeUrl(appId, _latest = null, options = {}) {
  const appRow = db.prepare('SELECT runtime_mode FROM apps WHERE id = ?').get(appId);
  if (appRow?.runtime_mode === 'server' && options?.runtime) {
    const runtimeUrl = getRuntimeBaseUrl(options.runtime);
    if (runtimeUrl) return `${runtimeUrl}/`;
  }
  const workspaceSlug = ensureWorkspaceSlug(appId);
  if (!workspaceSlug) throw new Error('workspace slug missing');
  await wakeAppRuntime(appId);
  const previewPath = buildWorkspacePreviewPath(workspaceSlug);
  if (!previewPath) throw new Error('preview path missing');
  return `http://127.0.0.1:${PORT}${previewPath}/`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs || 1500));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function resolveRuntimeTarget(target) {
  if (!target) return { appId: null, runtime: null };
  if (typeof target === 'number' || /^\d+$/.test(String(target || ''))) {
    return { appId: Number(target), runtime: null };
  }
  if (target.runtime) {
    return {
      appId: Number(target.appId || target.runtime?.appId || 0) || null,
      runtime: target.runtime,
    };
  }
  return {
    appId: Number(target.appId || target.app_id || 0) || null,
    runtime: target,
  };
}

function getRuntimeBaseUrl(runtime) {
  if (!runtime?.running) return '';
  if (runtime.hostPort) return `http://127.0.0.1:${runtime.hostPort}`;
  if (runtime.ip) return `http://${runtime.ip}:3001`;
  return '';
}

async function waitRuntimeReadyDetailed(target, retries = 8, delayMs = 250, options = {}) {
  const { appId, runtime: initialRuntime } = resolveRuntimeTarget(target);
  const timeoutMs = Math.max(200, Number(options.timeoutMs || 1500));
  let runtime = initialRuntime || null;
  let lastError = null;
  let lastStatus = null;
  let lastHealth = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    if ((!runtime?.running || !runtime?.ip) && appId) {
      runtime = getContainerRuntime(appId);
    }

    if (runtime?.running && (runtime?.ip || runtime?.hostPort)) {
      try {
        const runtimeBaseUrl = getRuntimeBaseUrl(runtime);
        if (!runtimeBaseUrl) {
          lastError = 'runtime endpoint unavailable';
          if (attempt < retries) {
            await sleep(delayMs);
            if (appId) runtime = getContainerRuntime(appId) || runtime;
          }
          continue;
        }
        const response = await fetchWithTimeout(`${runtimeBaseUrl}/health`, { timeoutMs });
        lastStatus = response.status;
        if (response.ok) {
          try {
            lastHealth = await response.json();
          } catch {
            lastHealth = null;
          }
          return {
            ok: true,
            attempts: attempt,
            runtime,
            status: response.status,
            health: lastHealth,
            error: null,
          };
        }
        lastError = `health responded ${response.status}`;
      } catch (error) {
        lastError = String(error?.name === 'AbortError' ? `health timeout after ${timeoutMs}ms` : (error?.message || error));
      }
    } else {
      const state = runtime?.running ? 'runtime ip unavailable' : 'runtime not running';
      lastError = appId ? `${state}; waiting for container inspect` : state;
    }

    if (attempt < retries) {
      await sleep(delayMs);
      if (appId) runtime = getContainerRuntime(appId) || runtime;
    }
  }

  if ((!runtime?.running || !runtime?.ip) && appId) {
    runtime = getContainerRuntime(appId) || runtime;
  }

  return {
    ok: false,
    attempts: retries,
    runtime: runtime || null,
    status: lastStatus,
    health: lastHealth,
    error: lastError || 'health endpoint not ready',
  };
}

async function waitRuntimeReady(target, retries = 8, delayMs = 250, options = {}) {
  const result = await waitRuntimeReadyDetailed(target, retries, delayMs, options);
  return !!result.ok;
}

function proxyToAppContainer(req, res, runtime, pathPart) {
  if (!runtime?.running || (!runtime?.ip && !runtime?.hostPort)) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'App container unavailable' }));
  }

  const targetHost = runtime.hostPort ? '127.0.0.1' : runtime.ip;
  const targetPort = runtime.hostPort || 3001;
  const headers = { ...req.headers, host: `${targetHost}:${targetPort}` };
  const method = String(req.method || 'GET').toUpperCase();
  const mayHaveBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  let bodyText = null;
  if (mayHaveBody && req.body !== undefined) {
    bodyText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    headers['content-type'] = headers['content-type'] || 'application/json';
    headers['content-length'] = String(Buffer.byteLength(bodyText));
  } else {
    delete headers['content-length'];
  }

  const options = {
    hostname: targetHost,
    port: targetPort,
    path: pathPart,
    method,
    headers,
  };

  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxy.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'App backend proxy error' }));
  });

  if (bodyText !== null) {
    proxy.write(bodyText);
    proxy.end();
  } else {
    req.pipe(proxy);
  }
}

const IDLE_MINUTES = Number(process.env.APP_IDLE_MINUTES || '30');
const IDLE_CHECK_MS = Number(process.env.APP_IDLE_CHECK_MS || String(5 * 60 * 1000));

function startIdleRuntimeSweeper() {
  setInterval(() => {
    try {
      const rows = db.prepare(`
        SELECT id, last_access_at
        FROM apps
        WHERE (last_access_at IS NOT NULL)
      `).all();
      const now = Date.now();
      for (const r of rows) {
        const ts = r.last_access_at ? new Date(r.last_access_at.replace(' ', 'T') + 'Z').getTime() : 0;
        if (!ts) continue;
        const idleMin = (now - ts) / 60000;
        if (idleMin >= IDLE_MINUTES) {
          stopPreview(r.id);
          stopAppBackend(r.id);
        }
      }
    } catch (e) {
      console.warn('idle sweeper warning:', e.message);
    }
  }, IDLE_CHECK_MS);
}

function normalizeMessageForModel(content) {
  if (typeof content !== 'string') return '';
  if (!content.startsWith(REQ_CARD_PREFIX)) return content;
  try {
    const card = JSON.parse(content.slice(REQ_CARD_PREFIX.length));
    const text = String(card?.text || '').trim();
    const answers = Array.isArray(card?.answers)
      ? card.answers
          .map(a => `- ${String(a?.title || '').trim()}: ${String(a?.answer || '').trim()}`)
          .filter(Boolean)
          .join('\n')
      : '';
    return answers ? `${text}\n\n[選択条件]\n${answers}` : text;
  } catch {
    return content;
  }
}

function parseAIResponse(content) {
  const text = String(content || '');
  const forbiddenPathHints = [
    'projects/apps/',
    '/Users/Joe/.openclaw/workspace/projects/apps/',
    'standalone repo',
    'external project folder',
  ];
  const hasForbiddenPathHint = forbiddenPathHints.some((hint) => text.includes(hint));

  // Frontend JSX: collect all jsx/tsx blocks and pick the best full-app candidate.
  const jsxBlocks = [];
  const jsxRe = /```(?:jsx|tsx)\n([\s\S]*?)```/g;
  let m;
  while ((m = jsxRe.exec(text)) !== null) {
    const block = String(m[1] || '').trim();
    if (block) jsxBlocks.push(block);
  }

  const scoreJsx = (code) => {
    let s = 0;
    if (/function\s+App\s*\(/.test(code) || /const\s+App\s*=/.test(code)) s += 4;
    if (/export\s+default\s+App/.test(code)) s += 3;
    if (/useState\s*\(/.test(code) || /useEffect\s*\(/.test(code)) s += 2;
    if (/return\s*\(/.test(code)) s += 2;
    s += Math.min(4, Math.floor(code.length / 4000));
    return s;
  };

  let jsx = null;
  if (jsxBlocks.length) {
    jsx = [...jsxBlocks].sort((a, b) => scoreJsx(b) - scoreJsx(a) || b.length - a.length)[0];
    // If response only gave tiny snippet/tutorial fragment, do not overwrite app.
    if (jsx.length < 2000 && !/function\s+App\s*\(/.test(jsx)) jsx = null;
  }

  // Backend server code
  const serverMatch = text.match(/```javascript server\n([\s\S]*?)```/) ||
                      text.match(/```js server\n([\s\S]*?)```/);
  // SQL schema
  const sqlMatch = text.match(/```sql\n([\s\S]*?)```/);

  if (hasForbiddenPathHint) {
    console.warn('⚠️ AI response referenced forbidden external app path; keeping funfo-internal app semantics');
  }

  return {
    jsx:    jsx?.trim() ?? null,
    server: serverMatch?.[1]?.trim() ?? null,
    sql:    sqlMatch?.[1]?.trim() ?? null,
    hasForbiddenPathHint,
  };
}

function extractFrontendApiContracts(frontendCode = '') {
  const map = new Map();
  const src = String(frontendCode || '');
  const normalizePath = (rawPath = '') => {
    let path = String(rawPath || '').trim();
    if (!path) return '';
    const apiIdx = path.indexOf('/api/');
    if (apiIdx < 0) return '';
    path = path.slice(apiIdx).split('?')[0].trim();
    path = path.replace(/["'`]/g, '');
    path = path.replace(/\$\{[^}]+\}/g, ':id');
    path = path.replace(/\s*\+\s*[^,+)]+/g, ':id');
    path = path.replace(/:id:id+/g, ':id');
    path = path.replace(/\/+:id/g, '/:id');
    path = path.replace(/\/+/g, '/');
    if (path.length > 1) path = path.replace(/\/+$/g, '');
    return path.trim();
  };
  const add = (method, path) => {
    const clean = normalizePath(path);
    if (!clean || !clean.startsWith('/api/')) return;
    const m = String(method).toUpperCase();
    map.set(`${m} ${clean}`, { method: m, path: clean, expect: m === 'GET' ? 'array' : 'object' });
  };

  const re1 = /fetch\(\s*(?:[A-Z_][A-Z0-9_]*\s*\+\s*)?["'`]([^"'`]+)["'`]\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/g;
  let m;
  while ((m = re1.exec(src)) !== null) {
    const path = m[1] || '';
    const opts = m[2] || '';
    const mm = opts.match(/method\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/i);
    add(mm ? mm[1] : 'GET', path);
  }

  const reConcatFetch = /fetch\(\s*[^,)]*?["'`]([^"'`]*\/api\/[^"'`]*)["'`][^,)]*(?:,\s*\{([\s\S]*?)\})?\s*\)/g;
  while ((m = reConcatFetch.exec(src)) !== null) {
    const path = m[1] || '';
    const opts = m[2] || '';
    const mm = opts.match(/method\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/i);
    add(mm ? mm[1] : 'GET', path);
  }

  const reTemplateFetch = /fetch\(\s*`([^`]+)`\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/g;
  while ((m = reTemplateFetch.exec(src)) !== null) {
    const path = m[1] || '';
    const opts = m[2] || '';
    const mm = opts.match(/method\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/i);
    add(mm ? mm[1] : 'GET', path);
  }

  const re2 = /axios\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi;
  while ((m = re2.exec(src)) !== null) add(m[1], m[2]);

  const reAxiosTemplate = /axios\.(get|post|put|patch|delete)\(\s*`([^`]+)`/gi;
  while ((m = reAxiosTemplate.exec(src)) !== null) add(m[1], m[2]);

  const helperPatterns = [
    { re: /\bapiGet\(\s*["'`]([^"'`]+)["'`]/g, method: 'GET' },
    { re: /\bapiDelete\(\s*["'`]([^"'`]+)["'`]/g, method: 'DELETE' },
    { re: /\bapiSend\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/g, methodFromMatch: 2 },
    { re: /\bapiGet\(\s*([^)]+)\)/g, method: 'GET' },
    { re: /\bapiDelete\(\s*([^)]+)\)/g, method: 'DELETE' },
    { re: /\bapiSend\(\s*([^,]+)\s*,\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/g, methodFromMatch: 2 },
  ];
  for (const pattern of helperPatterns) {
    while ((m = pattern.re.exec(src)) !== null) {
      const path = m[1] || '';
      const method = pattern.methodFromMatch ? (m[pattern.methodFromMatch] || 'GET') : pattern.method;
      add(method, path);
    }
  }

  return Array.from(map.values());
}

function extractBackendApiContracts(serverCode = '') {
  const set = new Set();
  const src = String(serverCode || '');
  const re = /app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const method = String(m[1] || '').toUpperCase();
    const path = String(m[2] || '').split('?')[0].replace(/\/$/, '');
    if (path.startsWith('/api/')) set.add(`${method} ${path}`);
  }
  return set;
}

async function fetchRuntimeHealth(runtime) {
  const runtimeBaseUrl = getRuntimeBaseUrl(runtime);
  if (!runtimeBaseUrl) return null;
  try {
    const res = await fetchWithTimeout(`${runtimeBaseUrl}/health`, { timeoutMs: 1500 });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function injectMissingApiStubs(frontendCode = '', serverCode = '') {
  const wanted = extractFrontendApiContracts(frontendCode);
  if (!wanted.length) return { code: serverCode, missing: [] };

  const have = extractBackendApiContracts(serverCode || '');
  const buildAliases = (method, path) => {
    const cleanMethod = String(method || '').toUpperCase();
    const cleanPath = String(path || '').trim().replace(/\/+$/g, '');
    const aliases = new Set([`${cleanMethod} ${cleanPath}`]);
    if (cleanPath.startsWith('/api/') && /\/:id$/.test(cleanPath)) {
      aliases.add(`${cleanMethod} ${cleanPath.replace(/\/:id$/, '')}`);
    } else if (cleanPath.startsWith('/api/') && !/:([A-Za-z_][A-Za-z0-9_]*)/.test(cleanPath)) {
      aliases.add(`${cleanMethod} ${cleanPath}/:id`);
    }
    return aliases;
  };
  const missing = wanted.filter(c => !Array.from(buildAliases(c.method, c.path)).some(key => have.has(key)));
  if (missing.length === 0) return { code: serverCode, missing };

  // Build smarter stubs: stats routes get db-aware defaults
  const stubs = missing.map(c => {
    const lower = c.method.toLowerCase();

    // For /stats routes, generate a db-aware stub that tries to count from the likely table
    if (c.method === 'GET' && /\/stats$/.test(c.path)) {
      const segments = c.path.replace(/^\/api\//, '').split('/').filter(Boolean);
      const resource = segments[0] || 'items';
      return `\napp.${lower}('${c.path}', (req, res) => {\n  try {\n    const total = db.prepare('SELECT COUNT(*) as count FROM ${resource}').get();\n    return res.json({ total: total?.count || 0 });\n  } catch(e) {\n    return res.json({ total: 0, _stub: true });\n  }\n});\n`;
    }

    const listResp = c.method === 'GET'
      ? '[]'
      : `{ ok: true, placeholder: true, route: '${c.method} ${c.path}' }`;

    const base = `\napp.${lower}('${c.path}', (req, res) => {\n  return res.json(${listResp});\n});\n`;

    if (c.path.endsWith('/')) {
      const itemResp = c.method === 'GET'
        ? `{ id: req.params.id }`
        : `{ ok: true, placeholder: true, route: '${c.method} ${c.path}:id', id: req.params.id }`;
      return base + `\napp.${lower}('${c.path}:id', (req, res) => {\n  return res.json(${itemResp});\n});\n`;
    }
    return base;
  }).join('\n');

  // Insert stubs BEFORE any existing parameterized routes to avoid shadowing
  // Find the best insertion point: before the first /:param route at a matching prefix
  let insertionCode = serverCode || '';
  const stubBlock = `\n// Auto-added API contract stubs to prevent runtime 404\n${stubs}`;

  // Try to insert stubs at the top of the route section (after any helper functions/variables)
  const firstRouteMatch = insertionCode.match(/\napp\.(get|post|put|patch|delete)\(/);
  if (firstRouteMatch && firstRouteMatch.index != null) {
    insertionCode = insertionCode.slice(0, firstRouteMatch.index) + stubBlock + insertionCode.slice(firstRouteMatch.index);
  } else {
    insertionCode = `${insertionCode}\n${stubBlock}`;
  }

  return {
    code: insertionCode,
    missing,
  };
}

function lintAndRepairJsx(code) {
  if (!code) return { code, notes: [] };
  let fixed = code;
  const notes = [];

  // normalize fullwidth punctuation that often breaks parsing
  const before = fixed;
  fixed = fixed
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/，/g, ',')
    .replace(/：/g, ':')
    .replace(/；/g, ';');
  if (fixed !== before) notes.push('normalized punctuation');

  // reduce template-literal URL parser issues: fetch(API_BASE + `...${a}...`)
  fixed = fixed.replace(/fetch\(\s*API_BASE\s*\+\s*`([^`]*)`\s*\)/g, (_m, tpl) => {
    const converted = tpl.replace(/\$\{([^}]+)\}/g, '" + ($1) + "');
    notes.push('rewrote template-literal fetch URL');
    return `fetch(API_BASE + "${converted}")`;
  });

  // precompile self-check (lint-like gate)
  try {
    babel.transformSync(`function __tmp(){${fixed}\n}`, { presets: [BABEL_PRESET_REACT], filename: 'Preflight.jsx' });
  } catch (e) {
    const msg = String(e?.message || e || '');
    // Fallback: still try JSX transform plugin when preset package resolution fails
    if (msg.includes('@babel/preset-react') || msg.includes('Cannot find module')) {
      try {
        babel.transformSync(`function __tmp(){${fixed}\n}`, {
          plugins: [BABEL_PLUGIN_REACT_JSX],
          filename: 'Preflight.jsx',
        });
      } catch (e2) {
        notes.push(`preflight parse warning: ${String(e2?.message || e2).slice(0, 120)}`);
      }
    } else {
      // keep fixed code; caller can still run auto-fix path on compile/runtime error
      notes.push(`preflight parse warning: ${msg.slice(0, 120)}`);
    }
  }

  return { code: fixed, notes };
}

function lintSqlDialect(sql = '') {
  const src = String(sql || '');
  const issues = [];
  const checks = [
    { re: /\bNOW\s*\(/i, msg: "Use datetime('now') instead of NOW() in SQLite" },
    { re: /\bCURRENT_TIMESTAMP\b/i, msg: "Prefer datetime('now') for consistency in SQLite apps" },
    { re: /\bILIKE\b/i, msg: "ILIKE is PostgreSQL-specific; use LIKE in SQLite" },
    { re: /\bSERIAL\b/i, msg: "SERIAL is not supported in SQLite" },
    { re: /datetime\s*\(\s*now\s*\)/i, msg: "Use datetime('now') with quoted 'now'" },
    { re: /date\s*\(\s*now\s*\)/i, msg: "Use date('now') with quoted 'now'" },
    { re: /\b=\s*now\b/i, msg: "'now' should be a quoted string in SQLite functions" },
  ];
  for (const c of checks) if (c.re.test(src)) issues.push(c.msg);
  return issues;
}

function dryRunSqlSchema(sql = '') {
  const src = String(sql || '').trim();
  if (!src) return { ok: true };
  const tmp = path.join(os.tmpdir(), `funfo-sql-dryrun-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  let testDb;
  try {
    testDb = new BetterSqlite3(tmp);
    testDb.exec(src);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    try { testDb?.close(); } catch {}
    try { fs.existsSync(tmp) && fs.unlinkSync(tmp); } catch {}
  }
}

function looksLikeStaticSqlText(value = '') {
  return /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH|PRAGMA)\b/i.test(String(value || ''));
}

function evaluateStaticStringExpression(expr = '') {
  const raw = String(expr || '').trim();
  if (!raw) return null;
  const stripped = raw.replace(/`(?:\\[\s\S]|[^`])*`|"(?:\\[\s\S]|[^"])*"|'(?:\\[\s\S]|[^'])*'/g, (token) => {
    if (token.startsWith('`') && token.includes('${')) return '__FUNFO_DYNAMIC_TEMPLATE__';
    return '';
  });
  if (stripped.includes('__FUNFO_DYNAMIC_TEMPLATE__')) return null;
  if (!/^[\s+()]*$/.test(stripped)) return null;
  try {
    const value = Function(`"use strict"; return (${raw});`)();
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function applyTextReplacements(code = '', replacements = []) {
  if (!replacements.length) return code;
  const sorted = [...replacements].sort((a, b) => b.start - a.start);
  let out = String(code || '');
  for (const item of sorted) {
    out = out.slice(0, item.start) + item.replacement + out.slice(item.end);
  }
  return out;
}

function walkDbPrepareCalls(code = '', visitor = () => {}) {
  const src = String(code || '');
  const needle = 'db.prepare(';
  let cursor = 0;
  while (cursor < src.length) {
    const start = src.indexOf(needle, cursor);
    if (start < 0) break;
    const argsStart = start + needle.length;
    let i = argsStart;
    let depth = 1;
    let quote = null;
    let escaped = false;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === quote) {
          quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === '\'' || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '(') {
        depth += 1;
        continue;
      }
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          const argExpr = src.slice(argsStart, i);
          visitor({
            start,
            end: i + 1,
            expressionStart: argsStart,
            expressionEnd: i,
            argExpr,
          });
          break;
        }
      }
    }
    cursor = i + 1;
  }
}

function buildStaticSqlBindingMap(serverCode = '') {
  const bindings = new Map();
  const src = String(serverCode || '');
  const assignmentRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);/g;
  let m;
  while ((m = assignmentRe.exec(src)) !== null) {
    const name = m[1];
    const expr = m[2];
    const value = evaluateStaticStringExpression(expr);
    if (value != null && looksLikeStaticSqlText(value)) {
      bindings.set(name, value);
    }
  }
  return bindings;
}

function normalizeBackendSqlStrings(serverCode = '') {
  let code = String(serverCode || '');
  let changed = false;
  const rewrites = [];

  code = code.replace(/((?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*)([\s\S]*?)(\s*;)/g, (match, prefix, name, expr, suffix) => {
    const value = evaluateStaticStringExpression(expr);
    if (value == null || !looksLikeStaticSqlText(value)) return match;
    changed = true;
    rewrites.push({ type: 'binding', name });
    return `${prefix}${JSON.stringify(value)}${suffix}`;
  });

  const bindings = buildStaticSqlBindingMap(code);
  const replacements = [];
  walkDbPrepareCalls(code, ({ start, end, argExpr }) => {
    const trimmed = String(argExpr || '').trim();
    if (!trimmed) return;
    let sql = evaluateStaticStringExpression(trimmed);
    let rewriteType = 'inline';
    if (sql == null && /^[A-Za-z_$][\w$]*$/.test(trimmed) && bindings.has(trimmed)) {
      sql = bindings.get(trimmed);
      rewriteType = 'binding_ref';
    }
    if (sql == null || !looksLikeStaticSqlText(sql)) return;
    replacements.push({
      start,
      end,
      replacement: `db.prepare(${JSON.stringify(sql)})`,
    });
    changed = true;
    rewrites.push({ type: rewriteType, target: trimmed });
  });

  code = applyTextReplacements(code, replacements);
  return { code, changed, rewrites };
}

/**
 * Validate backend SQL statements against the schema by extracting
 * all db.prepare('...') calls and dry-running them on a temp DB with the schema applied.
 * Returns { ok, errors[] } where errors list SQL statements that would fail at runtime.
 */
function dryRunBackendAgainstSchema(serverCode = '', schemaSql = '') {
  const schema = String(schemaSql || '').trim();
  const normalization = normalizeBackendSqlStrings(serverCode || '');
  const server = String(normalization.code || '').trim();
  if (!schema || !server) return { ok: true, errors: [], tested: 0 };

  const concatenationErrors = [];
  if (/db\.prepare\(\s*(?:"[\s\S]*?"\s*\+|'[\s\S]*?'\s*\+|`[\s\S]*?`\s*\+)/.test(server)) {
    concatenationErrors.push({
      sql: 'db.prepare(<concatenated sql>)',
      error: 'SQL is built by JavaScript string concatenation inside db.prepare(); release requires one complete SQLite query string.',
      kind: 'sql_concatenation',
    });
  }
  const concatenatedVars = [...server.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);/g)]
    .filter(([, , expr]) => /["'`][\s\S]*?\+[\s\S]*?["'`]/.test(expr))
    .map(([, name]) => name);
  for (const name of concatenatedVars) {
    if (new RegExp(`db\\.prepare\\(\\s*${name}\\s*\\)`).test(server)) {
      concatenationErrors.push({
        sql: `db.prepare(${name})`,
        error: `SQL variable "${name}" is assembled by JS concatenation; release requires a single complete SQLite query string.`,
        kind: 'sql_concatenation',
      });
    }
  }
  if (concatenationErrors.length) {
    return { ok: false, errors: concatenationErrors, tested: 0 };
  }

  const tmp = path.join(os.tmpdir(), `funfo-backend-dryrun-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  let testDb;
  try {
    testDb = new BetterSqlite3(tmp);
    testDb.exec(schema);

    // Extract SQL from db.prepare('...') patterns
    const sqlStatements = [];
    const bindings = buildStaticSqlBindingMap(server);
    walkDbPrepareCalls(server, ({ argExpr }) => {
      const trimmed = String(argExpr || '').trim();
      if (!trimmed) return;
      let sql = evaluateStaticStringExpression(trimmed);
      if (sql == null && /^[A-Za-z_$][\w$]*$/.test(trimmed) && bindings.has(trimmed)) {
        sql = bindings.get(trimmed);
      }
      if (sql && sql.trim()) sqlStatements.push(sql.trim());
    });

    const errors = [];
    const seen = new Set();
    for (const sql of sqlStatements) {
      // Replace template literal placeholders with dummy values for validation
      let testSql = sql
        .replace(/\$\{[^}]+\}/g, '1')
        .replace(/\?\s*$/g, '?');

      // Skip if already tested
      if (seen.has(testSql)) continue;
      seen.add(testSql);

      // Skip non-query statements that are hard to dry-run (INSERT with values)
      if (/\bINSERT\b/i.test(testSql)) continue; // INSERT needs actual values
      if (/\bUPDATE\b.*\bSET\b/i.test(testSql)) continue; // UPDATE needs values
      if (/\bDELETE\b/i.test(testSql)) continue; // DELETE is destructive

      try {
        // For SELECT statements, just prepare (don't run) to validate columns exist
        testDb.prepare(testSql);
      } catch (e) {
        const raw = String(e?.message || e).slice(0, 200);
        const normalized = /no such column:\s*""|string literal in single-quotes/i.test(raw)
          ? 'SQLite string literal error. Use single quotes for strings and empty string literals (for example: COALESCE(x, \'\') instead of COALESCE(x, "")).'
          : /near\s+['"][+]['"]|near\s+['"][.]['"]|near\s+['"][()]['"]/.test(raw)
            ? 'SQLite parse error. This usually means the generated SQL still contains JS string fragments or an incomplete query; emit one complete SQLite statement in db.prepare(...).'
            : raw;
        const kind = /no such column:\s*""|string literal in single-quotes/i.test(raw) ? 'sqlite_string_literal' : 'sqlite_prepare';
        errors.push({ sql: testSql.slice(0, 200), error: normalized, kind });
      }
    }

    return { ok: errors.length === 0, errors, tested: seen.size, normalized: normalization.changed };
  } catch (e) {
    return { ok: false, errors: [{ sql: 'schema', error: String(e?.message || e).slice(0, 200) }], tested: 0 };
  } finally {
    try { testDb?.close(); } catch {}
    try { fs.existsSync(tmp) && fs.unlinkSync(tmp); } catch {}
  }
}

const validation = createValidationModule({
  babel,
  BABEL_PRESET_REACT,
  lintSqlDialect,
  dryRunSqlSchema,
  extractFrontendApiContracts,
  extractBackendApiContracts,
  evaluateStaticStringExpression,
  looksLikeStaticSqlText,
});

const {
  extractDesignTokensFromPrompt,
  isDesignApplied,
  findUndefinedJsxComponents,
  validateFrontendOnlyArtifacts,
  inferWorkspaceIterationProfile,
  validateWorkspaceIterationEarly,
  estimateLineChangeRatio,
  inferAllowedChangeRatio,
  extractStableIdentifiers,
  hasStructuralOverlap,
  isIncrementalChangePreferred,
  validateGeneratedArtifacts,
} = validation;

const publish = createPublishModule({
  db,
  withPreviewLink,
  getPreviewPort,
  getApiPort,
});

const verifier = createVerifierModule({
  getAppDir,
  hydrateVersionRow,
  getContainerRuntime,
  waitRuntimeReady,
  extractFrontendApiContracts,
  extractBackendApiContracts,
  fetchRuntimeHealth,
  runBrowserSmoke,
  resolveBrowserSmokeUrl: resolveVerifierBrowserSmokeUrl,
});
const { verifyAppRelease, mapVerifierCheckToFailure } = verifier;

const {
  PUBLISH_STEP_TEMPLATES,
  publishJobsInFlight,
  createPublishSteps,
  parsePublishSteps,
  getPublishJob,
  savePublishJob,
  setPublishStep,
  startPublishJobRecord,
  finishPublishJobRecord,
  buildPublishStatusResponse,
  requestPublishCancel,
  clearPublishCancel,
  isPublishCancelRequested,
} = publish;
function getAppDir(appId) {
  return path.join(__dirname, 'apps', String(appId));
}

function getVersionDir(appId, versionNumber) {
  return path.join(getAppDir(appId), 'versions', `v${versionNumber}`);
}

function inspectSqliteSchema(dbPath) {
  try {
    if (!fs.existsSync(dbPath)) return { exists: false, tables: {} };
    const sqlite = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
    const rows = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const tables = {};
    for (const row of rows) {
      const cols = sqlite.prepare(`PRAGMA table_info(${row.name})`).all().map(c => c.name);
      tables[row.name] = cols;
    }
    sqlite.close();
    return { exists: true, tables };
  } catch (e) {
    return { exists: false, error: String(e?.message || e), tables: {} };
  }
}

function extractExpectedSchemaFromDoc(dbSchemaDoc = '') {
  const out = {};
  const sql = String(dbSchemaDoc || '');
  const matches = [...sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(([^]*?)\);/gi)];
  for (const m of matches) {
    const table = String(m[1] || '').trim();
    const body = String(m[2] || '');
    const cols = [];
    for (const raw of body.split(',')) {
      const line = raw.trim();
      if (!line || /^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK)\b/i.test(line)) continue;
      const mm = line.match(/^(\w+)\s+/);
      if (mm) cols.push(mm[1]);
    }
    out[table] = cols;
  }
  return out;
}

function buildSchemaDiffWarning(appId, dbSchemaDoc = '') {
  const expected = extractExpectedSchemaFromDoc(dbSchemaDoc);
  if (!Object.keys(expected).length) return '';
  const appDir = getAppDir(appId);
  const devInfo = inspectSqliteSchema(path.join(appDir, 'data_dev.sqlite'));
  const prodInfo = inspectSqliteSchema(path.join(appDir, 'data_prod.sqlite'));
  const safeLines = [];
  const riskLines = [];
  const compare = (label, info) => {
    if (!info.exists) {
      riskLines.push(`- ${label}: database file missing or unreadable`);
      return;
    }
    for (const [table, cols] of Object.entries(expected)) {
      if (!info.tables[table]) {
        safeLines.push(`- ${label}: missing table ${table} (safe direction: add table)`);
        continue;
      }
      const missing = cols.filter(c => !info.tables[table].includes(c));
      if (missing.length) safeLines.push(`- ${label}: ${table} missing columns ${missing.join(', ')} (safe direction: add column)`);
      const extra = info.tables[table].filter(c => !cols.includes(c));
      if (extra.length) riskLines.push(`- ${label}: ${table} has extra existing columns ${extra.join(', ')} (dangerous to drop/rename without migration)`);
    }
  };
  compare('data_dev.sqlite', devInfo);
  compare('data_prod.sqlite', prodInfo);
  if (!safeLines.length && !riskLines.length) return '';
  return `Current runtime databases do not fully match schema.sql for app ${appId}.\n\nSafe migration-first actions:\n${safeLines.length ? safeLines.join('\n') : '- none'}\n\nPotentially dangerous actions requiring explicit migration planning:\n${riskLines.length ? riskLines.join('\n') : '- none'}\n\nTreat this as an existing app migration task. Prefer additive evolution (ADD COLUMN / ADD TABLE / backfill). Do not assume an empty database. Do not silently rebuild or drop existing structures.`;
}

const docs = createDocsModule({
  db,
  getAppDir,
  extractBackendApiContracts,
  extractFrontendApiContracts,
  extractSqlTables,
  buildWorkspacePreviewPath,
  buildWorkspacePublicPath,
  writeAppContextManifest,
});

const {
  getDocsDir,
  getAppSpecPath,
  getApiContractPath,
  getDbSchemaPath,
  getAppManifestPath,
  readAppSpec,
  readApiContract,
  readDbSchemaDoc,
  getModeDocPath,
  writeModeDoc,
  readModeDoc,
  updateWorkspaceModeDocs,
  writeReleaseNotes,
  writeReleaseReport,
  writeReleaseManifest,
  writeCreateProposalDocs,
  writeApiAndDbDocs,
  writeAppManifest,
  appendAppSpecSnapshot,
} = docs;

function syncAppStructuredManifest(appId, appRow = null) {
  try {
    const row = appRow || db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
    if (!row) return;
    const latestRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appId);
    const latest = hydrateVersionRow(appId, latestRaw);
    if (!latest) return;
    writeAppManifest(appId, {
      appRow: row,
      appName: row.name,
      versionNumber: latest.version_number || row.current_version || null,
      frontendCode: latest.code || '',
      serverCode: latest.server_code || '',
      sqlCode: latest.sql_code || '',
    });
  } catch (e) {
    console.warn('structured manifest sync warning:', e?.message || e);
  }
}

const publishPipeline = createPublishPipeline({
  db,
  publishJobsInFlight,
  getEffectiveReleaseAppId,
  hydrateVersionRow,
  readLatestFrontendCodeFromFiles,
  isReusablePublishBackend,
  readVersionFiles,
  setPublishStep,
  callLlmOnce: (...args) => callLlmOnce(...args),
  SYSTEM_PROMPT,
  parseAIResponse,
  injectMissingApiStubs,
  isWorkspaceDraft,
  validateServerCodeSyntax,
  validatePublishSchemaSafety,
  applySchemaToDbFile,
  createReleaseBackupSnapshot,
  ensurePreviewSlug,
  deployAppBackend,
  getAppBackendLogs,
  getContainerRuntime,
  waitRuntimeReady,
  waitRuntimeReadyDetailed,
  startPreview,
  isPortReachable,
  writeVersionFiles,
  appendAppSpecSnapshot,
  writeApiAndDbDocs,
  writeReleaseReport,
  writeReleaseManifest,
  touchAppAccess,
  startPublishJobRecord,
  finishPublishJobRecord,
  savePublishJob,
  isPublishCancelRequested,
  clearPublishCancel,
  verifyAppRelease,
  mapVerifierCheckToFailure,
  setAppStage,
  extractFrontendApiContracts,
  extractBackendApiContracts,
  dryRunBackendAgainstSchema,
  normalizeBackendSqlStrings,
  platformBaseUrl: `http://127.0.0.1:${PORT}`,
});
const { processPublishJob } = publishPipeline;

function writeVersionFiles(appId, versionNumber, frontendCode = '', serverCode = '', sqlCode = '') {
  try {
    const vdir = getVersionDir(appId, versionNumber);
    fs.mkdirSync(vdir, { recursive: true });
    fs.writeFileSync(path.join(vdir, 'App.jsx'), String(frontendCode || ''));
    fs.writeFileSync(path.join(vdir, 'server.js'), String(serverCode || ''));
    fs.writeFileSync(path.join(vdir, 'schema.sql'), String(sqlCode || ''));

    const appDir = getAppDir(appId);
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(path.join(appDir, 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(appDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(appDir, 'styles'), { recursive: true });
    fs.mkdirSync(path.join(appDir, 'versions'), { recursive: true });
    fs.writeFileSync(path.join(appDir, 'App.jsx'), String(frontendCode || ''));
    fs.writeFileSync(path.join(appDir, 'server.js'), String(serverCode || ''));
    fs.writeFileSync(path.join(appDir, 'schema.sql'), String(sqlCode || ''));
    const readmePath = path.join(appDir, 'README.md');
    if (!fs.existsSync(readmePath)) {
      fs.writeFileSync(readmePath, `# funfo app ${appId}\n\nCore files stay at the app root for compatibility.\n\n- App.jsx\n- server.js\n- schema.sql\n\nSupport directories:\n- versions/\n- runtime/\n- docs/\n- styles/\n`);
    }
    const styleReadmePath = path.join(appDir, 'styles', 'README.md');
    if (!fs.existsSync(styleReadmePath)) {
      fs.writeFileSync(styleReadmePath, '# Styles\n\nPlace app-specific style files here, such as app.css or globals.css.\nKeep the current root App.jsx/server.js/schema.sql layout for compatibility, but prefer colocating new style assets inside this folder.\n');
    }
    const appCssPath = path.join(appDir, 'styles', 'app.css');
    if (!fs.existsSync(appCssPath)) {
      fs.writeFileSync(appCssPath, `/* funfo app ${appId} styles */\n/* Add app-specific styles here. Root-level frontend remains App.jsx for compatibility. */\n`);
    }
    const runtimeReadmePath = path.join(appDir, 'runtime', 'README.md');
    if (!fs.existsSync(runtimeReadmePath)) {
      fs.writeFileSync(runtimeReadmePath, '# Runtime\n\nThis folder is for runtime artifacts such as sqlite databases, WAL/SHM files, and other generated runtime state. Legacy flows may still write some of these files at the app root; new maintenance should gradually converge runtime artifacts here.\n');
    }
    for (const runtimeName of ['data_dev.sqlite', 'data_dev.sqlite-wal', 'data_dev.sqlite-shm', 'data_prod.sqlite', 'data_prod.sqlite-wal', 'data_prod.sqlite-shm']) {
      const legacyPath = path.join(appDir, runtimeName);
      const runtimePath = path.join(appDir, 'runtime', runtimeName);
      if (fs.existsSync(legacyPath) && !fs.existsSync(runtimePath)) {
        fs.copyFileSync(legacyPath, runtimePath);
      }
    }
  } catch (e) {
    console.warn('write version files warning:', e?.message || e);
  }
}

function readLatestFrontendCodeFromFiles(appId) {
  try {
    const p = path.join(getAppDir(appId), 'App.jsx');
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function readVersionFiles(appId, versionNumber) {
  try {
    const vdir = getVersionDir(appId, versionNumber);
    const read = (name) => {
      const p = path.join(vdir, name);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    };
    return {
      code: read('App.jsx'),
      server_code: read('server.js'),
      sql_code: read('schema.sql'),
    };
  } catch {
    return { code: '', server_code: '', sql_code: '' };
  }
}

function hydrateVersionRow(appId, row) {
  if (!row) return row;
  const files = readVersionFiles(appId, row.version_number);
  return {
    ...row,
    code: files.code || row.code || '',
    server_code: files.server_code || row.server_code || '',
    sql_code: files.sql_code || row.sql_code || '',
  };
}

function hydrateVersionRows(appId, rows = []) {
  return (rows || []).map(r => hydrateVersionRow(appId, r));
}

function ensureAppFilesMaterializedFromDb(appId) {
  const appDir = getAppDir(appId);
  const rootApp = path.join(appDir, 'App.jsx');
  if (fs.existsSync(rootApp)) return;
  const rows = db.prepare("SELECT version_number, ifnull(code,'') code, ifnull(server_code,'') server_code, ifnull(sql_code,'') sql_code FROM app_versions WHERE app_id = ? ORDER BY version_number ASC").all(appId);
  if (!rows.length) return;
  for (const r of rows) {
    writeVersionFiles(appId, r.version_number, r.code || '', r.server_code || '', r.sql_code || '');
  }
}

function syncAppVersionIndexFromFiles(appId) {
  try {
    const vRoot = path.join(getAppDir(appId), 'versions');
    if (!fs.existsSync(vRoot)) return;
    const dirs = fs.readdirSync(vRoot, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^v\d+$/.test(d.name))
      .map(d => Number(d.name.slice(1)))
      .filter(n => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (!dirs.length) return;

    const hasVersion = db.prepare('SELECT 1 FROM app_versions WHERE app_id = ? AND version_number = ? LIMIT 1');
    const getVersion = db.prepare('SELECT id, ifnull(code, \'\') AS code, ifnull(server_code, \'\') AS server_code, ifnull(sql_code, \'\') AS sql_code FROM app_versions WHERE app_id = ? AND version_number = ? LIMIT 1');
    const insVersion = db.prepare('INSERT INTO app_versions (app_id, version_number, label, code, server_code, sql_code) VALUES (?, ?, ?, ?, ?, ?)');
    const patchVersion = db.prepare(`
      UPDATE app_versions
      SET
        code = CASE WHEN ifnull(code, '') = '' THEN ? ELSE code END,
        server_code = CASE WHEN ifnull(server_code, '') = '' THEN ? ELSE server_code END,
        sql_code = CASE WHEN ifnull(sql_code, '') = '' THEN ? ELSE sql_code END
      WHERE app_id = ? AND version_number = ?
    `);

    for (const v of dirs) {
      const exists = hasVersion.get(appId, v);
      if (!exists) {
        insVersion.run(appId, v, `file-sync v${v}`, '', '', '');
      }
      const files = readVersionFiles(appId, v);
      if (files.code || files.server_code || files.sql_code) {
        const row = getVersion.get(appId, v);
        const needsPatch = row && (
          (!row.code && files.code) ||
          (!row.server_code && files.server_code) ||
          (!row.sql_code && files.sql_code)
        );
        if (needsPatch) {
          patchVersion.run(files.code || '', files.server_code || '', files.sql_code || '', appId, v);
        }
      }
    }

    const maxDb = db.prepare('SELECT MAX(version_number) as mv FROM app_versions WHERE app_id = ?').get(appId)?.mv || 1;
    db.prepare("UPDATE apps SET current_version = ?, updated_at = datetime('now') WHERE id = ?").run(maxDb, appId);
  } catch (e) {
    console.warn('sync versions from files warning:', e?.message || e);
  }
}


function normalizeDocLines(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^(app_id|version|updated_at):/i.test(line));
}

function parseApiContractDoc(text = '') {
  const lines = normalizeDocLines(text);
  const sections = { backend: [], frontend: [], missing: [] };
  let current = null;
  for (const line of lines) {
    if (/^##\s+Backend routes/i.test(line)) {
      current = 'backend';
      continue;
    }
    if (/^##\s+Frontend API usage/i.test(line)) {
      current = 'frontend';
      continue;
    }
    if (/^##\s+Contract diff/i.test(line)) {
      current = 'missing';
      continue;
    }
    if (line.startsWith('- ')) {
      const value = line.slice(2).trim();
      if (!value || value === 'none' || !current) continue;
      sections[current].push(value);
    }
  }
  return {
    backend: [...new Set(sections.backend)].sort(),
    frontend: [...new Set(sections.frontend)].sort(),
    missing: [...new Set(sections.missing)].sort(),
  };
}

function normalizeSqlForComparison(sql = '') {
  return String(sql || '')
    .replace(/```sql[\s\S]*?```/gi, (block) => block.replace(/```sql\s*/i, '').replace(/```$/, ''))
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;=])\s*/g, '$1')
    .trim()
    .toLowerCase();
}

function extractSqlBlockFromDoc(text = '') {
  const match = String(text || '').match(/```sql\n([\s\S]*?)```/i);
  return (match?.[1] || '').trim();
}

function isReusablePublishBackend(appId, releaseAppId) {
  if (!appId || !releaseAppId || Number(appId) === Number(releaseAppId)) {
    return { reusable: false, reason: 'workspace draft comparison not applicable' };
  }

  const draftApiRaw = readApiContract(appId);
  const releaseApiRaw = readApiContract(releaseAppId);
  const draftSchemaRaw = readDbSchemaDoc(appId);
  const releaseSchemaRaw = readDbSchemaDoc(releaseAppId);

  if (!draftApiRaw || !releaseApiRaw || !draftSchemaRaw || !releaseSchemaRaw) {
    return { reusable: false, reason: 'baseline docs missing' };
  }

  const draftApi = parseApiContractDoc(draftApiRaw);
  const releaseApi = parseApiContractDoc(releaseApiRaw);
  const draftSchemaSql = extractSqlBlockFromDoc(draftSchemaRaw);
  const releaseSchemaSql = extractSqlBlockFromDoc(releaseSchemaRaw);

  const sameBackendRoutes = JSON.stringify(draftApi.backend) === JSON.stringify(releaseApi.backend);
  const sameFrontendUsage = JSON.stringify(draftApi.frontend) === JSON.stringify(releaseApi.frontend);
  const sameMissing = JSON.stringify(draftApi.missing) === JSON.stringify(releaseApi.missing);
  const sameSchema = normalizeSqlForComparison(draftSchemaSql) === normalizeSqlForComparison(releaseSchemaSql);

  const reusable = sameBackendRoutes && sameFrontendUsage && sameMissing && sameSchema;
  return {
    reusable,
    reason: reusable ? 'api contract and db schema unchanged' : 'api contract or db schema changed',
    details: {
      sameBackendRoutes,
      sameFrontendUsage,
      sameMissing,
      sameSchema,
    },
  };
}

function cloneIterationBaselineDocs(sourceAppId, newAppId) {
  try {
    const srcDir = getDocsDir(sourceAppId);
    const dstDir = getDocsDir(newAppId);
    fs.mkdirSync(dstDir, { recursive: true });
    const files = ['APP_SPEC.md', 'API_CONTRACT.md', 'DB_SCHEMA.md'];
    for (const f of files) {
      const s = path.join(srcDir, f);
      const d = path.join(dstDir, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, d);
    }
  } catch (e) {
    console.warn('clone baseline docs warning:', e?.message || e);
  }
}

function copyDirRecursive(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(dstDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, ent.name);
    const dst = path.join(dstDir, ent.name);
    if (ent.isDirectory()) copyDirRecursive(src, dst);
    else if (ent.isFile()) fs.copyFileSync(src, dst);
  }
}

function cloneAppAllFiles(sourceAppId, newAppId) {
  const srcDir = getAppDir(sourceAppId);
  const dstDir = getAppDir(newAppId);
  if (fs.existsSync(dstDir)) fs.rmSync(dstDir, { recursive: true, force: true });
  copyDirRecursive(srcDir, dstDir);
}

function removeAppFiles(appId) {
  try {
    fs.rmSync(getAppDir(appId), { recursive: true, force: true });
  } catch (e) {
    console.warn('remove app files warning:', e?.message || e);
  }
}

function deleteAppDeep(appId, seen = new Set()) {
  const id = Number(appId);
  if (!Number.isFinite(id) || id <= 0 || seen.has(id)) return [];
  seen.add(id);

  const row = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
  if (!row) return [];

  const deleted = [];
  const childDrafts = db.prepare("SELECT id FROM apps WHERE app_role = 'draft' AND release_app_id = ?").all(id);
  for (const child of childDrafts) {
    deleted.push(...deleteAppDeep(child.id, seen));
  }

  stopPreview(id);
  stopAppBackend(id);

  db.prepare('DELETE FROM app_favorites WHERE app_id = ?').run(id);
  db.prepare('DELETE FROM messages WHERE app_id = ?').run(id);
  db.prepare('DELETE FROM app_versions WHERE app_id = ?').run(id);
  db.prepare('DELETE FROM publish_jobs WHERE app_id = ?').run(id);
  db.prepare('DELETE FROM app_release_backups WHERE release_app_id = ? OR source_draft_app_id = ?').run(id, id);
  db.prepare('UPDATE apps SET release_app_id = NULL WHERE release_app_id = ?').run(id);
  db.prepare('DELETE FROM apps WHERE id = ?').run(id);
  removeAppFiles(id);
  deleted.push(id);
  return deleted;
}

function listInvalidReleaseDrafts() {
  return db.prepare(`
    SELECT a.id, a.name, a.icon, a.owner_user_id, a.release_app_id, a.updated_at,
           u.email as owner_email, u.nickname as owner_nickname
    FROM apps a
    LEFT JOIN apps r ON r.id = a.release_app_id
    LEFT JOIN users u ON u.id = a.owner_user_id
    WHERE a.app_role = 'draft'
      AND a.release_app_id IS NOT NULL
      AND r.id IS NULL
    ORDER BY datetime(a.updated_at) DESC, a.id DESC
  `).all();
}

function cleanupInvalidReleaseDrafts() {
  const invalidDrafts = listInvalidReleaseDrafts();

  const deletedIds = [];
  for (const row of invalidDrafts) {
    deletedIds.push(...deleteAppDeep(row.id));
  }
  return { deletedIds, count: deletedIds.length };
}

function getDirSizeBytes(dir) {
  let total = 0;
  try {
    if (!fs.existsSync(dir)) return 0;
    const stack = [dir];
    while (stack.length) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile()) {
          try { total += fs.statSync(full).size; } catch {}
        }
      }
    }
  } catch {}
  return total;
}

function listOrphanAppResources() {
  const root = path.join(__dirname, 'apps');
  if (!fs.existsSync(root)) return [];
  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .map((d) => Number(d.name))
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((a, b) => a - b);

  const out = [];
  for (const id of dirs) {
    const row = db.prepare('SELECT id FROM apps WHERE id = ?').get(id);
    if (row) continue;
    const dir = getAppDir(id);
    const runtime = getContainerRuntime(id);
    const sizeBytes = getDirSizeBytes(dir);
    out.push({
      id,
      exists_in_db: false,
      dir_exists: fs.existsSync(dir),
      size_bytes: sizeBytes,
      size_mb: Number((sizeBytes / 1024 / 1024).toFixed(2)),
      runtime_running: !!runtime?.running,
      runtime_container: runtime?.containerName || null,
      preview_port: getPreviewPort(id) || null,
      has_versions: fs.existsSync(path.join(dir, 'versions')),
      has_prod_db: fs.existsSync(path.join(dir, 'data_prod.sqlite')),
      has_dev_db: fs.existsSync(path.join(dir, 'data_dev.sqlite')),
    });
  }
  return out.sort((a, b) => (b.size_bytes - a.size_bytes) || (a.id - b.id));
}

function cleanupOrphanAppResources(ids = []) {
  const targets = listOrphanAppResources();
  const allowed = new Set((Array.isArray(ids) && ids.length ? ids : targets.map((x) => x.id)).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0));
  const picked = targets.filter((item) => allowed.has(item.id));
  const deletedIds = [];
  let reclaimedBytes = 0;
  for (const item of picked) {
    stopPreview(item.id);
    stopAppBackend(item.id);
    removeAppFiles(item.id);
    reclaimedBytes += Number(item.size_bytes || 0);
    deletedIds.push(item.id);
  }
  return {
    deletedIds,
    count: deletedIds.length,
    reclaimedBytes,
    reclaimedMb: Number((reclaimedBytes / 1024 / 1024).toFixed(2)),
  };
}

function validateClonedAppFiles(appId, currentVersion) {
  const appDir = getAppDir(appId);
  const rootApp = path.join(appDir, 'App.jsx');
  const versionApp = path.join(getVersionDir(appId, currentVersion), 'App.jsx');
  const hasRoot = fs.existsSync(rootApp) && fs.statSync(rootApp).size > 0;
  const hasVersion = fs.existsSync(versionApp) && fs.statSync(versionApp).size > 0;
  if (!hasRoot || !hasVersion) {
    throw new Error(`clone file validation failed (root:${hasRoot} version:${hasVersion})`);
  }
}

function extractSqlTables(sql = '') {
  const out = [];
  const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi;
  let m;
  while ((m = re.exec(String(sql || '')))) out.push(m[1]);
  return [...new Set(out)];
}


function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}
function createToken() {
  return crypto.randomBytes(24).toString('hex');
}
function getAuthUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  return db.prepare('SELECT id, email, nickname, avatar_url FROM users WHERE session_token = ?').get(token) || null;
}
function requireAuth(req, res, next) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'ログインが必要です' });
  req.user = user;
  next();
}

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'funfo123';
const adminSessions = new Set();

function getAdminToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const h = req.headers['x-admin-token'];
  return typeof h === 'string' ? h : null;
}
function requireAdmin(req, res, next) {
  const token = getAdminToken(req);
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'admin unauthorized' });
  next();
}

function getGuestKey(req) {
  const v = req.headers['x-guest-key'];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function claimGuestAppsToUser(guestKey, userId) {
  if (!guestKey || !userId) return;
  db.prepare("UPDATE apps SET owner_user_id = ?, guest_key = NULL, updated_at = datetime('now') WHERE owner_user_id IS NULL AND guest_key = ?")
    .run(userId, guestKey);
}

function canAccessApp(appRow, req) {
  const user = getAuthUser(req);
  const guestKey = getGuestKey(req);
  const ownerMatch = !!(appRow.owner_user_id && user && appRow.owner_user_id === user.id);
  const guestMatch = !!(!appRow.owner_user_id && appRow.guest_key && guestKey && appRow.guest_key === guestKey);
  return ownerMatch || guestMatch;
}

const APP_STAGE_ORDER = [
  'prototype',
  'frontend_ready',
  'backend_proposed',
  'backend_generated',
  'backend_verified',
  'release_blocked',
  'release_ready',
  'published_live',
  'repair_needed',
];

function normalizeAppStage(stage = '') {
  const value = String(stage || '').trim();
  return APP_STAGE_ORDER.includes(value) ? value : 'prototype';
}

function setAppStage(appId, stage, reason = null, extras = {}) {
  const normalizedStage = normalizeAppStage(stage);
  const fields = ['app_stage = ?', 'stage_reason = ?', "updated_at = datetime('now')"];
  const values = [normalizedStage, reason || null];
  for (const [key, value] of Object.entries(extras || {})) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  values.push(appId);
  db.prepare(`UPDATE apps SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
}

function isPortReachable(port, host = '127.0.0.1', timeoutMs = 1200) {
  return new Promise((resolve) => {
    if (!port) return resolve(false);
    const socket = net.createConnection({ port, host });
    const done = (ok) => { try { socket.destroy(); } catch {} resolve(ok); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function ensureAppRuntimeDir(appId) {
  const dir = path.join(__dirname, 'apps', String(appId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function validateServerCodeSyntax(appId, serverCode = '') {
  const trimmed = String(serverCode || '').trim();
  if (!trimmed) return { ok: true, skipped: true };
  const dir = ensureAppRuntimeDir(appId);
  const tmpPath = path.join(dir, '.publish-server-check.js');
  fs.writeFileSync(tmpPath, trimmed);
  try {
    const r = require('child_process').spawnSync(process.execPath, ['--check', tmpPath], { encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error((r.stderr || r.stdout || 'server syntax check failed').trim());
    }
    return { ok: true };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

function applySchemaToDbFile(dbFile, schemaText = '') {
  const sql = String(schemaText || '').trim();
  const appDb = new BetterSqlite3(dbFile);
  const applied = [];
  try {
    if (!sql) return { ok: true, applied, summary: 'schema empty' };

    appDb.exec(sql);

    const tableBlocks = [...sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(([\s\S]*?)\);/gi)];
    for (const m of tableBlocks) {
      const table = m[1];
      const body = m[2] || '';
      const exists = appDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) continue;

      const currentCols = appDb.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      const defs = body.split(',').map(x => x.trim()).filter(Boolean);
      for (const d of defs) {
        if (/^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK)\b/i.test(d)) continue;
        const mm = d.match(/^(\w+)\s+(.+)$/s);
        if (!mm) continue;
        const col = mm[1];
        const colDef = `${col} ${mm[2].trim()}`;
        if (!currentCols.includes(col)) {
          try {
            appDb.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
            applied.push(`ADD COLUMN ${table}.${col}`);
          } catch (e) {
            applied.push(`SKIP ${table}.${col}: ${String(e.message || e)}`);
          }
        }
      }
    }

    return { ok: true, applied, summary: applied.length ? 'schema drift fixed' : 'schema already aligned' };
  } finally {
    try { appDb.close(); } catch {}
  }
}




function validatePublishSchemaSafety(appId, schemaText = '') {
  const dir = ensureAppRuntimeDir(appId);
  const prodDbPath = path.join(dir, 'data_prod.sqlite');
  const tempDbPath = path.join(dir, `.publish-check-${Date.now()}.sqlite`);
  if (fs.existsSync(prodDbPath)) fs.copyFileSync(prodDbPath, tempDbPath);
  const result = applySchemaToDbFile(tempDbPath, schemaText);
  try { fs.unlinkSync(tempDbPath); } catch {}
  return { ...result, targetDb: prodDbPath };
}

function isInternalLoopbackRequest(req) {
  const raw = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  return raw === '127.0.0.1' || raw === '::1' || raw === '::ffff:127.0.0.1' || raw === '';
}

function proxyToLocalPort(req, res, port, pathPart) {
  const targetPort = Number(port);
  if (!Number.isFinite(targetPort) || targetPort <= 0) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'Preview unavailable' }));
  }
  const options = {
    hostname: '127.0.0.1',
    port: targetPort,
    path: pathPart || '/',
    method: req.method,
    headers: { ...req.headers, host: `localhost:${targetPort}` },
  };
  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxy.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Preview unavailable' }));
  });
  req.pipe(proxy);
}

const handleCandidateRoute = async (req, res) => {
  if (!isInternalLoopbackRequest(req)) return res.status(403).json({ error: 'candidate route is internal only' });
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'Not found' });
  const releaseState = deriveReleaseState(appRow);
  if (releaseState !== 'candidate') return res.status(409).json({ error: 'app is not in candidate state', release_state: releaseState });
  const runtime = getContainerRuntime(appId);
  const bound = !!runtime && runtime.labels?.['funfo.app_id'] === String(appId);
  if (!bound) return res.status(502).json({ error: 'Candidate runtime not bound' });
  const ready = await waitRuntimeReady({ appId, runtime });
  if (!ready) return res.status(502).json({ error: 'Candidate runtime starting' });
  const pathPart = req.originalUrl.replace(new RegExp(`^/__candidate/app/${appId}`), '') || '/';
  return proxyToAppContainer(req, res, runtime, pathPart);
};

const handleWorkspacePublicRoute = async (req, res, next) => {
  const parsed = parseWorkspaceRouteToken(req.params.workspaceSlug || '');
  const workspaceSlug = parsed.workspaceSlug;
  if (!/^w_[a-z0-9]{12}$/.test(workspaceSlug)) return next();

  const appRow = db.prepare('SELECT * FROM apps WHERE workspace_slug = ?').get(workspaceSlug);
  if (!appRow) return next();

  const routeBase = parsed.isPreview ? buildWorkspacePreviewPath(workspaceSlug) : buildWorkspacePublicPath(workspaceSlug);
  if (req.path === routeBase) {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(302, `${routeBase}/${q}`);
  }

  const releaseState = deriveReleaseState(appRow);
  const isPublicRelease = ['live', 'rollback'].includes(releaseState);
  if (!parsed.isPreview && !isPublicRelease) {
    return res.status(409).json({
      error: 'App 尚未公开发布。请使用 preview 链接查看当前开发版本。',
      release_state: releaseState,
      preview_path: buildWorkspacePreviewPath(workspaceSlug),
    });
  }

  touchAppAccess(appRow.id);
  recordAppVisit(appRow.id, req, parsed.isPreview ? 'workspace-preview' : 'workspace-public');
  if (parsed.isPreview || releaseState !== 'failed') {
    await wakeAppRuntime(appRow.id);
  }

  const pathPart = req.originalUrl.replace(new RegExp(`^${routeBase}`), '') || '/';
  const runtime = getContainerRuntime(appRow.id);
  const isServerRuntime = appRow.runtime_mode === 'server' && !parsed.isPreview && isPublicRelease;
  const bound = !!runtime
    && runtime.labels?.['funfo.app_id'] === String(appRow.id)
    && runtime.labels?.['funfo.slug'] === String(appRow.preview_slug || ensurePreviewSlug(appRow.id));

  if (isServerRuntime) {
    if (!bound) return res.status(502).json({ error: 'Runtime binding mismatch' });
    const ready = await waitRuntimeReady({ appId: appRow.id, runtime });
    if (!ready) return res.status(502).json({ error: 'App backend starting, retry in 1s' });
    return proxyToAppContainer(req, res, runtime, pathPart || '/');
  }

  if (pathPart.startsWith('/api/')) {
    if (!bound) return res.status(502).json({ error: 'Runtime binding mismatch' });
    const ready = await waitRuntimeReady({ appId: appRow.id, runtime });
    if (!ready) return res.status(502).json({ error: 'App backend starting, retry in 1s' });
    return proxyToAppContainer(req, res, runtime, pathPart);
  }

  const previewPort = getPreviewPort(appRow.id);
  if (!previewPort) {
    return res.status(404).json({ error: parsed.isPreview ? 'Preview not running' : 'Public app preview unavailable' });
  }
  return proxyToLocalPort(req, res, previewPort, pathPart);
};

// Public preview links: http://host:3100/app/<8-char-slug>
const handleAppSlug = async (req, res, next) => {
  const slug = String(req.params.slug || '');
  if (!/^[a-z0-9]{8}$/.test(slug)) return next();
  let appRow = db.prepare('SELECT id FROM apps WHERE preview_slug = ?').get(slug);
  if (!appRow) {
    const previewSession = getPreviewSessionBySlug(slug);
    if (previewSession) appRow = { id: null, _sessionOnly: true };
  }
  if (!appRow) return next();

  if (req.path === `/app/${slug}`) {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(302, `/app/${slug}/${q}`);
  }

  const fullAppRow = appRow.id ? db.prepare('SELECT * FROM apps WHERE id = ?').get(appRow.id) : null;
  const releaseState = fullAppRow ? deriveReleaseState(fullAppRow) : 'draft';
  const isServerRuntime = !!fullAppRow && fullAppRow.runtime_mode === 'server' && fullAppRow.status !== 'draft' && (releaseState === 'live' || releaseState === 'rollback');

  if (appRow.id) {
    touchAppAccess(appRow.id);
    recordAppVisit(appRow.id, req, isServerRuntime ? 'server-runtime' : 'preview');
    if (releaseState !== 'failed') {
      await wakeAppRuntime(appRow.id);
    }
  }

  const pathPart = req.originalUrl.replace(new RegExp(`^/app/${slug}`), '') || '/';
  const previewAssetNames = new Set(['/react.js', '/react-is.js', '/react-dom.js', '/prop-types.js', '/recharts.js']);

  let runtime = appRow.id ? getContainerRuntime(appRow.id) : null;
  let bound = !!runtime && runtime.labels?.['funfo.app_id'] === String(appRow.id) && runtime.labels?.['funfo.slug'] === slug;

  if (releaseState === 'failed') {
    return res.status(409).json({ error: 'Release candidate failed and is not promoted live', release_state: releaseState });
  }

  if (!isServerRuntime && previewAssetNames.has(pathPart)) {
    return proxyPreviewRequest(req, res, slug);
  }

  // server-mode apps: route ALL public paths through the live/rollback app container
  if (isServerRuntime) {
    // auto-heal binding mismatch on first-hit or stale container labels
    if (!bound) {
      try {
        const latestRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appRow.id);
        const latest = hydrateVersionRow(appRow.id, latestRaw);
        const contract = injectMissingApiStubs(latest?.code || '', latest?.server_code || '');
        const normalizedServer = normalizeBackendSqlStrings(contract.code || '');
        const serverToUse = normalizedServer.code || contract.code;
        if (serverToUse && serverToUse.trim()) {
          await deployAppBackend(appRow.id, serverToUse, latest?.sql_code || '', slug, { frontendCode: latest?.code || '', dbMode: isServerRuntime ? 'prod' : 'dev' });
          if (latest?.id) db.prepare('UPDATE app_versions SET server_code = ? WHERE id = ?').run(serverToUse, latest.id);
          runtime = getContainerRuntime(appRow.id);
          bound = !!runtime && runtime.labels?.['funfo.app_id'] === String(appRow.id) && runtime.labels?.['funfo.slug'] === slug;
        }
      } catch (e) {
        console.warn('runtime rebind warning:', e?.message || e);
      }
    }

    if (!bound) return res.status(502).json({ error: 'Runtime binding mismatch' });
    const ready = await waitRuntimeReady({ appId: appRow.id, runtime });
    if (!ready) return res.status(502).json({ error: 'App backend starting, retry in 1s' });
    return proxyToAppContainer(req, res, runtime, pathPart || '/');
  }

  // /app/<slug>/api/* must be strictly bound to the app container in preview mode too
  if (pathPart.startsWith('/api/')) {
    if (!bound) return res.status(502).json({ error: 'Runtime binding mismatch' });
    const ready = await waitRuntimeReady({ appId: appRow.id, runtime });
    if (!ready) return res.status(502).json({ error: 'App backend starting, retry in 1s' });
    return proxyToAppContainer(req, res, runtime, pathPart);
  }

  const previewPort = getPreviewPort(appRow.id);
  if (!previewPort) return res.status(404).json({ error: 'Preview not running' });
  return proxyToLocalPort(req, res, previewPort, pathPart);
};
app.all('/w/:workspaceSlug', handleWorkspacePublicRoute);
app.all('/w/:workspaceSlug/*rest', handleWorkspacePublicRoute);
app.all('/app/:slug', handleAppSlug);
app.all('/app/:slug/*rest', handleAppSlug);
app.all('/__candidate/app/:id', handleCandidateRoute);
app.all('/__candidate/app/:id/*rest', handleCandidateRoute);

// ── Auth ──────────────────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { email, password, nickname } = req.body || {};
  if (!email || !password || !nickname) {
    return res.status(400).json({ error: 'email/password/nickname が必要です' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (exists) return res.status(409).json({ error: 'このメールは既に登録済みです' });

  const token = createToken();
  const r = db.prepare(
    'INSERT INTO users (email, nickname, password_hash, session_token) VALUES (?, ?, ?, ?)'
  ).run(email.trim().toLowerCase(), nickname.trim(), hashPassword(password), token);
  const user = db.prepare('SELECT id, email, nickname, avatar_url FROM users WHERE id = ?').get(r.lastInsertRowid);
  claimGuestAppsToUser(getGuestKey(req), user.id);
  res.json({ token, user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email/password が必要です' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || user.password_hash !== hashPassword(password)) {
    return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });
  }
  const token = createToken();
  db.prepare("UPDATE users SET session_token = ?, updated_at = datetime('now') WHERE id = ?").run(token, user.id);
  claimGuestAppsToUser(getGuestKey(req), user.id);
  res.json({ token, user: { id: user.id, email: user.email, nickname: user.nickname, avatar_url: user.avatar_url } });
});

app.get('/api/auth/me', (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  const favoriteCount = db.prepare('SELECT COUNT(*) as c FROM app_favorites WHERE user_id = ?').get(user.id).c;
  res.json({ ...user, favoriteCount });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare("UPDATE users SET session_token = NULL, updated_at = datetime('now') WHERE id = ?").run(req.user.id);
  res.json({ ok: true });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email が必要です' });
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user) return res.json({ ok: true });

  const resetToken = createToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();
  db.prepare('INSERT INTO password_resets (user_id, reset_token, expires_at) VALUES (?, ?, ?)').run(user.id, resetToken, expiresAt);
  // demo: return token directly (replace with real email later)
  res.json({ ok: true, resetToken, message: 'デモ環境のためリセットトークンを返しています' });
});

app.get('/api/auth/check-email', (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email が必要です' });
  const exists = !!db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  res.json({ exists });
});


app.post('/api/auth/reset-password', (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'token/newPassword が必要です' });

  const row = db.prepare('SELECT * FROM password_resets WHERE reset_token = ? AND used = 0').get(token);
  if (!row) return res.status(400).json({ error: '無効なトークンです' });
  if (new Date(row.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'トークンの有効期限が切れました' });

  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hashPassword(newPassword), row.user_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

app.patch('/api/auth/profile', requireAuth, (req, res) => {
  const { nickname, avatar_url } = req.body || {};
  db.prepare("UPDATE users SET nickname = COALESCE(?, nickname), avatar_url = COALESCE(?, avatar_url), updated_at = datetime('now') WHERE id = ?")
    .run(nickname || null, avatar_url || null, req.user.id);
  const user = db.prepare('SELECT id, email, nickname, avatar_url FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

app.patch('/api/auth/password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'oldPassword/newPassword が必要です' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.password_hash !== hashPassword(oldPassword)) return res.status(400).json({ error: '現在のパスワードが正しくありません' });
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

// ── Apps CRUD ─────────────────────────────────────────────────────────

app.get('/api/apps', (req, res) => {
  const user = getAuthUser(req);
  const apps = user
    ? db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM app_versions WHERE app_id = a.id) as version_count,
        (SELECT COUNT(*) FROM app_favorites f WHERE f.app_id = a.id AND f.user_id = ?) as is_favorite
      FROM apps a
      WHERE a.release_state = 'live' OR a.owner_user_id = ?
      ORDER BY a.updated_at DESC
    `).all(user.id, user.id)
    : db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM app_versions WHERE app_id = a.id) as version_count,
        0 as is_favorite
      FROM apps a
      WHERE a.release_state = 'live'
      ORDER BY a.updated_at DESC
    `).all();

  for (const a of apps) {
    ensureAppFilesMaterializedFromDb(Number(a.id));
    syncAppVersionIndexFromFiles(Number(a.id));
  }

  const freshApps = (user
    ? db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM app_versions WHERE app_id = a.id) as version_count,
        (SELECT COUNT(*) FROM app_favorites f WHERE f.app_id = a.id AND f.user_id = ?) as is_favorite
      FROM apps a
      WHERE a.release_state = 'live' OR a.owner_user_id = ?
      ORDER BY a.updated_at DESC
    `).all(user.id, user.id)
    : db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM app_versions WHERE app_id = a.id) as version_count,
        0 as is_favorite
      FROM apps a
      WHERE a.release_state = 'live'
      ORDER BY a.updated_at DESC
    `).all());

  res.json(freshApps.map(a => {
    const withLink = withPreviewLink(a);
    return {
      ...withLink,
      release_state: deriveReleaseState(a),
      preview_port: getPreviewPort(a.id),
      api_port:     getApiPort(a.id) ?? a.api_port,
    };
  }));
});

app.post('/api/apps', async (req, res) => {
  const user = getAuthUser(req);
  const guestKey = getGuestKey(req);
  const { name = '新規アプリ', icon = '✨', description = '' } = req.body || {};
  try {
    const aiModelKey = await resolveSelectedModelKey(typeof req.body?.ai_model_key === 'string' ? req.body.ai_model_key : null);
    const r = db.prepare('INSERT INTO apps (owner_user_id, guest_key, name, icon, description, ai_model_key) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user?.id ?? null, user ? null : guestKey, name, icon, description, aiModelKey || null);
    const row = db.prepare('SELECT * FROM apps WHERE id = ?').get(r.lastInsertRowid);
    const withLink = withPreviewLink(row);
    res.json({ ...withLink, preview_port: null, api_port: null });
  } catch (e) {
    res.status(500).json({ error: `create app failed: ${String(e?.message || e)}` });
  }
});

app.get('/api/apps/:id', async (req, res) => {
  const row = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const user = getAuthUser(req);
  const guestKey = getGuestKey(req);
  const ownerMatch = !!(row.owner_user_id && user && row.owner_user_id === user.id);
  const guestMatch = !!(!row.owner_user_id && row.guest_key && guestKey && row.guest_key === guestKey);
  const releaseState = deriveReleaseState(row);
  if (releaseState !== 'live') {
    if (!ownerMatch && !guestMatch) {
      return res.status(403).json({ error: 'アクセス権限がありません' });
    }
  }
  ensureAppFilesMaterializedFromDb(Number(req.params.id));
  syncAppVersionIndexFromFiles(Number(req.params.id));
  const freshRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id) || row;
  let previewPort = getPreviewPort(freshRow.id);
  let apiPort = getApiPort(freshRow.id) ?? freshRow.api_port;
  const shouldWakeWorkspaceRuntime = freshRow.runtime_mode !== 'server' && (releaseState !== 'live' || ownerMatch || guestMatch);
  if (shouldWakeWorkspaceRuntime) {
    try {
      const runtime = await wakeAppRuntime(freshRow.id);
      previewPort = runtime?.previewPort ?? getPreviewPort(freshRow.id);
      apiPort = runtime?.apiPort ?? getApiPort(freshRow.id) ?? freshRow.api_port;
    } catch (e) {
      console.warn(`wake runtime on getApp failed for app ${freshRow.id}:`, e?.message || e);
    }
  }
  touchAppAccess(freshRow.id);
  const messages = db.prepare('SELECT * FROM messages WHERE app_id = ? ORDER BY created_at ASC').all(req.params.id);
  const versionsRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC').all(req.params.id);
  const versions = hydrateVersionRows(Number(req.params.id), versionsRaw);
  const withLink = withPreviewLink(freshRow);
  res.json({
    ...withLink,
    release_state: deriveReleaseState(freshRow),
    messages,
    versions,
    preview_port: previewPort,
    api_port: apiPort,
  });
});

app.get('/api/workspace/:slug', (req, res) => {
  const row = db.prepare('SELECT * FROM apps WHERE workspace_slug = ?').get(String(req.params.slug || ''));
  if (!row) return res.status(404).json({ error: 'Not found' });
  const user = getAuthUser(req);
  const guestKey = getGuestKey(req);
  if (deriveReleaseState(row) !== 'live') {
    const ownerMatch = !!(row.owner_user_id && user && row.owner_user_id === user.id);
    const guestMatch = !!(!row.owner_user_id && row.guest_key && guestKey && row.guest_key === guestKey);
    if (!ownerMatch && !guestMatch) {
      return res.status(403).json({ error: 'アクセス権限がありません' });
    }
  }
  const withLink = withPreviewLink(row);
  return res.json({ ok: true, app: withLink });
});

app.patch('/api/apps/:id', requireAuth, async (req, res) => {
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!appRow) return res.status(404).json({ error: 'Not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '編集権限がありません' });

  const { name, icon, description, status, color } = req.body;
  if (status !== undefined && !['draft', 'private'].includes(status)) {
    return res.status(400).json({ error: 'live release state must be set via publish flow' });
  }
  try {
    const fields = [], values = [];
    if (name        !== undefined) { fields.push('name = ?');        values.push(name); }
    if (icon        !== undefined) { fields.push('icon = ?');        values.push(icon); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    if (status      !== undefined) {
      fields.push('status = ?');
      values.push(status);
      fields.push('runtime_mode = ?');
      values.push(status === 'draft' ? 'local' : 'server');
      fields.push("review_status = 'none'");
      fields.push("publish_status = 'idle'");
      fields.push("app_stage = 'prototype'");
      fields.push("stage_reason = 'manually moved back to draft/candidate state'");
    }
    if (color !== undefined) { fields.push('color = ?'); values.push(color); }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'ai_model_key')) {
      const nextModelKey = await resolveSelectedModelKey(typeof req.body?.ai_model_key === 'string' ? req.body.ai_model_key : null);
      fields.push('ai_model_key = ?');
      values.push(nextModelKey || null);
    }
    fields.push("updated_at = datetime('now')");
    values.push(req.params.id);
    db.prepare(`UPDATE apps SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
    const withLink = withPreviewLink(updated);
    res.json({ ...withLink, preview_port: getPreviewPort(updated.id), api_port: getApiPort(updated.id) ?? updated.api_port });
  } catch (e) {
    res.status(500).json({ error: `update failed: ${String(e?.message || e)}` });
  }
});

app.post('/api/apps/:id/publish', requireAuth, async (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  const mode = 'llm_provider';
  const publishRoute = (() => {
    const state = appRow?.release_state || deriveReleaseState(appRow);
    if (state === 'failed') return 'failed_to_candidate';
    if (state === 'rollback') return 'rollback_to_candidate';
    if (state === 'live') return 'live_to_candidate';
    return 'draft_to_candidate';
  })();
  if (!appRow) return res.status(404).json({ error: 'app not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '編集権限がありません' });
  if (isWorkspaceDraft(appRow) && !appRow.release_app_id) return res.status(400).json({ error: 'release link missing for workspace draft' });
  if (deriveReleaseState(appRow) === 'candidate' || publishJobsInFlight.has(appId)) return res.status(409).json({ error: 'このアプリは現在公開処理中です' });

  db.prepare("UPDATE apps SET publish_status='publishing', app_stage='frontend_ready', release_state='candidate', stage_reason='publish requested; waiting for release pipeline', updated_at=datetime('now') WHERE id = ?").run(appId);
  startPublishJobRecord(appId);
  savePublishJob(appId, { meta: { publishMode: mode, publish_route: publishRoute } });
  processPublishJob(appId, appRow.name, { mode, modelKey: appRow.ai_model_key || null }).catch((e) => {
    console.warn('publish background job failed:', e?.message || e);
  });

  return res.status(202).json(buildPublishStatusResponse(appId));
});

app.get('/api/apps/:id/publish-status', requireAuth, (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'app not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '編集権限がありません' });
  return res.json(buildPublishStatusResponse(appId));
});

app.post('/api/apps/:id/publish-cancel', requireAuth, (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'app not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '編集権限がありません' });

  const status = buildPublishStatusResponse(appId);
  const currentJob = getPublishJob(appId);
  const isPublishing = deriveReleaseState(appRow) === 'candidate' || publishJobsInFlight.has(appId) || currentJob?.status === 'publishing';
  if (!isPublishing) {
    db.prepare("UPDATE apps SET publish_status='idle', app_stage='frontend_ready', stage_reason=NULL, updated_at=datetime('now') WHERE id = ?").run(appId);
    savePublishJob(appId, {
      status: 'cancelled',
      current_step: currentJob?.current_step || 'cancelled',
      current_phase: currentJob?.current_phase || 'cancelled',
      failure_type: 'PUBLISH_CANCELLED',
      retryable: false,
      error_message: '发布已取消',
      completed_at: new Date().toISOString(),
      meta: {
        cancel_requested: false,
        cancel_completed: true,
      },
    });
    clearPublishCancel(appId);
    return res.json(buildPublishStatusResponse(appId));
  }

  requestPublishCancel(appId);
  db.prepare("UPDATE apps SET stage_reason='取消发布中…', updated_at=datetime('now') WHERE id = ?").run(appId);
  return res.status(202).json(buildPublishStatusResponse(appId));
});

app.post('/api/apps/:id/reset-failed-publish', requireAuth, (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'app not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '編集権限がありません' });
  if (deriveReleaseState(appRow) === 'candidate' || publishJobsInFlight.has(appId)) {
    return res.status(409).json({ error: 'このアプリは現在公開処理中です' });
  }

  db.prepare("UPDATE apps SET publish_status='idle', app_stage='frontend_ready', release_state='draft', candidate_version_id=NULL, stage_reason='failed candidate state cleared for retry', updated_at=datetime('now') WHERE id = ?").run(appId);
  clearPublishCancel(appId);
  savePublishJob(appId, {
    status: 'idle',
    current_step: null,
    current_phase: 'reset',
    failure_type: null,
    retryable: true,
    error_message: null,
    completed_at: new Date().toISOString(),
    steps: [],
    meta: {
      reset_failed_publish: true,
      previous_publish_status: appRow.publish_status || 'idle',
      previous_app_stage: appRow.app_stage || null,
    },
  });
  const updated = withPreviewLink(db.prepare('SELECT * FROM apps WHERE id = ?').get(appId));
  return res.json({ ...updated, preview_port: getPreviewPort(appId), api_port: getApiPort(appId) ?? updated.api_port, publish_progress: getPublishJob(appId) || null });
});

app.post('/api/apps/:id/submit-review', requireAuth, (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'app not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '編集権限がありません' });
  if (!['live', 'rollback'].includes(deriveReleaseState(appRow))) return res.status(400).json({ error: '提審は Live / Rollback app のみ可能です' });
  if (appRow.review_status === 'pending') return res.status(400).json({ error: 'このアプリはすでに提審中です' });

  db.prepare("UPDATE apps SET review_status='pending', updated_at=datetime('now') WHERE id = ?").run(appId);
  const updated = withPreviewLink(db.prepare('SELECT * FROM apps WHERE id = ?').get(appId));
  res.json({ ...updated, release_state: deriveReleaseState(updated), preview_port: getPreviewPort(appId), api_port: null });
});

app.get('/api/apps/:id/clone-ready', requireAuth, (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'app not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '編集権限がありません' });
  const currentVersion = Number(appRow.current_version || 1);
  try {
    validateClonedAppFiles(appId, currentVersion);
    return res.json({ ok: true, ready: true });
  } catch (e) {
    return res.json({ ok: true, ready: false, reason: String(e?.message || e) });
  }
});

app.get('/api/apps/:id/files', requireAuth, (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'app not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '編集権限がありません' });

  const rootDir = getAppDir(appId);
  const maxDepth = 4;
  const skipNames = new Set(['node_modules', '.git']);
  function walk(dir, depth = 0, root = rootDir) {
    const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
    return entries
      .filter((entry) => !skipNames.has(entry.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map((entry) => {
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: rel,
            type: 'dir',
            children: depth >= maxDepth ? [] : walk(full, depth + 1, root),
          };
        }
        const stat = fs.statSync(full);
        return { name: entry.name, path: rel, type: 'file', size: stat.size };
      });
  }

  return res.json({ root: rootDir, tree: walk(rootDir) });
});

app.get('/api/apps/:id/files/content', requireAuth, (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'app not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '編集権限がありません' });

  const rel = String(req.query.path || '').replace(/^\/+/, '');
  if (!rel) return res.status(400).json({ error: 'path required' });
  const rootDir = getAppDir(appId);
  const full = path.resolve(rootDir, rel);
  if (!full.startsWith(path.resolve(rootDir) + path.sep) && full !== path.resolve(rootDir)) {
    return res.status(400).json({ error: 'invalid path' });
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return res.status(404).json({ error: 'file not found' });
  const stat = fs.statSync(full);
  if (stat.size > 512000) return res.status(400).json({ error: 'file too large' });
  const content = fs.readFileSync(full, 'utf8');
  return res.json({ path: rel, content, size: stat.size });
});

app.post('/api/apps/:id/save-draft', requireAuth, (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'app not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '編集権限がありません' });
  if (!isWorkspaceDraft(appRow) || !appRow.release_app_id) {
    return res.status(400).json({ error: 'linked workspace draft only' });
  }

  db.prepare("UPDATE apps SET status='draft', publish_status='idle', review_status='none', runtime_mode='local', app_stage='prototype', stage_reason='saved back to workspace draft', updated_at=datetime('now') WHERE id = ?").run(appId);
  const updated = withPreviewLink(db.prepare('SELECT * FROM apps WHERE id = ?').get(appId));
  return res.json({ ...updated, preview_port: getPreviewPort(appId), api_port: getApiPort(appId) ?? updated.api_port });
});

app.post('/api/apps/:id/runtime-mode', requireAuth, async (req, res) => {
  const appId = Number(req.params.id);
  const { mode } = req.body || {};
  if (!['local', 'server'].includes(mode)) return res.status(400).json({ error: 'invalid mode' });

  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'app not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '編集権限がありません' });

  db.prepare("UPDATE apps SET runtime_mode = ?, app_stage = ?, stage_reason = ?, updated_at = datetime('now') WHERE id = ?")
    .run(mode, mode === 'server' ? 'backend_verified' : 'frontend_ready', mode === 'server' ? 'runtime manually switched to server mode' : 'runtime manually switched to local mode', appId);

  if (mode === 'local') {
    stopAppBackend(appId);
  } else {
    await wakeAppRuntime(appId);
  }

  const updated = withPreviewLink(db.prepare('SELECT * FROM apps WHERE id = ?').get(appId));
  res.json({ ...updated, preview_port: getPreviewPort(appId), api_port: getApiPort(appId) ?? updated.api_port });
});

app.delete('/api/apps/:id', requireAuth, (req, res) => {
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!appRow) return res.status(404).json({ error: 'Not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '削除権限がありません' });

  stopPreview(req.params.id);
  stopAppBackend(req.params.id);
  db.prepare('DELETE FROM apps WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/apps/:id/favorite', requireAuth, (req, res) => {
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!appRow || deriveReleaseState(appRow) !== 'live') return res.status(404).json({ error: 'Live アプリが見つかりません' });
  db.prepare('INSERT OR IGNORE INTO app_favorites (app_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.get('/api/apps/:id/backend-status', async (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'App not found' });
  if (!canAccessApp(appRow, req)) return res.status(403).json({ error: '編集権限がありません' });

  const runtime = getContainerRuntime(appId);
  const running = !!runtime?.running;
  const reachable = running ? await waitRuntimeReady({ appId, runtime }, 2, 250) : false;
  res.json({ ok: true, running, reachable, apiPort: null, runtime });
});

app.post('/api/apps/:id/backend-restart', async (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'App not found' });
  if (!canAccessApp(appRow, req)) return res.status(403).json({ error: '編集権限がありません' });

  const latestRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appId);
  const latest = hydrateVersionRow(appId, latestRaw);
  if (!latest) return res.status(400).json({ error: 'No app version to restart' });

  let apiPort = null;
  const contract = injectMissingApiStubs(latest.code || '', latest.server_code || '');
  const normalizedServer = normalizeBackendSqlStrings(contract.code || '');
  const serverToUse = normalizedServer.code || contract.code;
  const previewSlug = ensurePreviewSlug(appId);
  if (serverToUse && serverToUse.trim()) {
    await deployAppBackend(appId, serverToUse, latest.sql_code || '', previewSlug, { frontendCode: latest.code || '', dbMode: appRow.runtime_mode === 'server' ? 'prod' : 'dev' });
    db.prepare('UPDATE app_versions SET server_code = ? WHERE id = ?').run(serverToUse, latest.id);
  } else {
    stopAppBackend(appId);
    db.prepare('UPDATE apps SET api_port = NULL WHERE id = ?').run(appId);
  }

  let previewPort = null;
  if (appRow.runtime_mode !== 'server') {
    previewPort = startPreview(appId, latest.code || '', '', previewSlug);
  }

  res.json({ ok: true, apiPort: null, previewPort: previewPort ?? null, previewSlug, previewPath: buildWorkspacePreviewPath(ensureWorkspaceSlug(appId)) });
});

app.get('/api/apps/:id/db-check', async (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'App not found' });
  if (!canAccessApp(appRow, req)) return res.status(403).json({ error: '編集権限がありません' });

  const appDir = path.join(__dirname, 'apps', String(appId));
  const dbPath = path.join(appDir, 'data_prod.sqlite');
  const schemaPath = path.join(appDir, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    return res.status(400).json({ error: 'schema not found for this app' });
  }

  const schemaText = fs.readFileSync(schemaPath, 'utf8');
  try {
    const result = applySchemaToDbFile(dbPath, schemaText);
    res.json({ ok: true, dbPath, ...result });
  } catch (e) {
    res.status(500).json({ error: `db-check failed: ${e.message}` });
  }
});

app.get('/api/apps/:id/infrastructure/database', requireAuth, (req, res) => {
  const appId = Number(req.params.id);
  const access = requireAppOwner(appId, req.user.id);
  if (access.error) return res.status(access.status).json({ error: access.error });
  ensureAppFilesMaterializedFromDb(appId);
  try {
    return res.json(listAppDatabaseTables(appId));
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/apps/:id/infrastructure/database/table/:table', requireAuth, (req, res) => {
  const appId = Number(req.params.id);
  const access = requireAppOwner(appId, req.user.id);
  if (access.error) return res.status(access.status).json({ error: access.error });
  const table = String(req.params.table || '');
  const dbPath = getAppDbPath(appId);
  if (!fs.existsSync(dbPath)) return res.json({ table, columns: [], rows: [], limit: 20, offset: 0, total: 0 });
  const sqlite = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const safeTable = quoteSqliteIdentifier(table);
    const columns = sqlite.prepare(`PRAGMA table_info(${safeTable})`).all().map(c => c.name);
    const rows = sqlite.prepare(`SELECT * FROM ${safeTable} LIMIT ? OFFSET ?`).all(limit, offset);
    let total = null;
    try { total = Number(sqlite.prepare(`SELECT COUNT(*) as c FROM ${safeTable}`).get().c || 0); } catch {}
    return res.json({ table, columns, rows, limit, offset, total });
  } catch (e) {
    return res.status(400).json({ error: String(e?.message || e) });
  } finally {
    try { sqlite.close(); } catch {}
  }
});

app.post('/api/apps/:id/infrastructure/database/query', requireAuth, (req, res) => {
  const appId = Number(req.params.id);
  const access = requireAppOwner(appId, req.user.id);
  if (access.error) return res.status(access.status).json({ error: access.error });
  const sql = String(req.body?.sql || '').trim();
  if (!sql) return res.status(400).json({ error: 'sql is required' });
  const dbPath = getAppDbPath(appId);
  const schemaPath = getAppSchemaPath(appId);
  if (!fs.existsSync(dbPath) && fs.existsSync(schemaPath)) {
    try {
      applySchemaToDbFile(dbPath, fs.readFileSync(schemaPath, 'utf8'));
    } catch {}
  }
  const sqlite = new BetterSqlite3(dbPath);
  try {
    const lower = sql.toLowerCase();
    const isRead = /^(select|pragma|with|explain)/.test(lower);
    if (isRead) {
      const stmt = sqlite.prepare(sql);
      const rows = stmt.all();
      const columns = rows[0] ? Object.keys(rows[0]) : (typeof stmt.columns === 'function' ? stmt.columns().map(c => c.name) : []);
      return res.json({ mode: 'read', columns, rows, rowCount: rows.length, message: `已返回 ${rows.length} 行` });
    }
    const result = sqlite.prepare(sql).run();
    return res.json({ mode: 'write', changes: result.changes || 0, message: 'SQL 执行完成' });
  } catch (e) {
    return res.status(400).json({ error: String(e?.message || e) });
  } finally {
    try { sqlite.close(); } catch {}
  }
});

app.get('/api/apps/:id/infrastructure/analytics', requireAuth, (req, res) => {
  const appId = Number(req.params.id);
  const access = requireAppOwner(appId, req.user.id);
  if (access.error) return res.status(access.status).json({ error: access.error });
  const range = ['day', 'week', 'month'].includes(String(req.query.range || 'day')) ? String(req.query.range) : 'day';
  return res.json(getAppAnalytics(appId, range));
});

app.delete('/api/apps/:id/favorite', requireAuth, (req, res) => {
  db.prepare('DELETE FROM app_favorites WHERE app_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.get('/api/apps/:id/contract-shape-check', async (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'App not found' });
  if (!canAccessApp(appRow, req)) return res.status(403).json({ error: '編集権限がありません' });

  const latestRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appId);
  const latest = hydrateVersionRow(appId, latestRaw);
  const contracts = extractFrontendApiContracts(latest?.code || '');
  const checks = contracts.map(c => ({ method: c.method, path: c.path, expect: c.expect, ok: true }));
  const missing = checks.filter(c => !extractBackendApiContracts(latest?.server_code || '').has(`${c.method} ${c.path}`));
  for (const m of missing) m.ok = false;
  const passed = checks.every(c => c.ok);
  res.json({ ok: true, passed, checks, missingCount: missing.length });
});

app.get('/api/apps/:id/verifier-report', async (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'App not found' });
  if (!canAccessApp(appRow, req)) return res.status(403).json({ error: '編集権限がありません' });

  const latestRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appId);
  const report = await verifyAppRelease(appId, latestRaw, {
    expectedDbMode: (appRow.release_state || deriveReleaseState(appRow)) === 'live' || appRow.runtime_mode === 'server' ? 'prod' : 'prod',
  });
  res.json({ ok: true, report });
});

app.post('/api/apps/:id/release-repair', requireAuth, async (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'App not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '編集権限がありません' });
  const selectedModelKey = await resolveSelectedModelKey(appRow.ai_model_key || null);
  const callLlmForApp = (messages) => callLlmOnce(messages, { modelKey: selectedModelKey });

  const latestRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appId);
  const latest = hydrateVersionRow(appId, latestRaw);
  if (!latest?.code) return res.status(400).json({ error: 'No release artifacts to repair' });

  const initialReport = await verifyAppRelease(appId, latest, { expectedDbMode: 'prod' });
  if (initialReport.ok) {
    setAppStage(appId, 'backend_verified', 'verifier already passes; no repair needed');
    return res.json({ ok: true, repaired: false, report: initialReport, message: 'verifier already passes' });
  }

  setAppStage(appId, 'repair_needed', initialReport.summary || 'manual failed-state repair requested');
  const findings = initialReport.blockingFailures.map(item => ({ code: item.checkId || item.type || 'UNKNOWN', message: `${item.label}: ${item.detail}` }));
  const repairPrompt = `${buildFailureContextRepairPrompt(findings)}

Release frontend JSX:
\`\`\`jsx
${latest.code}
\`\`\`

Current backend:
\`\`\`javascript server
${latest.server_code || ''}
\`\`\`

Current SQL:
\`\`\`sql
${latest.sql_code || ''}
\`\`\``;
  const repairSystemPrompt = buildRepairSystemPrompt({
    requestedMode: 'edit',
    runtimeMode: appRow.runtime_mode || 'server',
    appStatus: appRow.status,
    appRow,
    userId: req.user.id,
    appId,
  });
  const repaired = await callLlmForApp([
    { role: 'system', content: repairSystemPrompt },
    { role: 'user', content: repairPrompt },
  ]);
  const parsed = parseAIResponse(repaired);
  let serverCode = parsed.server?.trim() || latest.server_code || '';
  let sqlCode = parsed.sql?.trim() || latest.sql_code || '';
  serverCode = injectMissingApiStubs(latest.code || '', serverCode).code || serverCode;
  serverCode = normalizeBackendSqlStrings(serverCode || '').code || serverCode;

  validateServerCodeSyntax(appId, serverCode || '');
  validatePublishSchemaSafety(appId, sqlCode || '');
  const previewSlug = ensurePreviewSlug(appId);
  const apiPort = await deployAppBackend(appId, serverCode || '', sqlCode || '', previewSlug, { dbMode: 'prod' });
  if (apiPort) db.prepare('UPDATE apps SET api_port = ? WHERE id = ?').run(apiPort, appId);
  db.prepare('UPDATE app_versions SET server_code = ?, sql_code = ? WHERE id = ?').run(serverCode || null, sqlCode || null, latest.id);
  writeVersionFiles(appId, latest.version_number, latest.code || '', serverCode || '', sqlCode || '');

  const finalReport = await verifyAppRelease(appId, {
    ...latest,
    server_code: serverCode,
    sql_code: sqlCode,
  }, { expectedDbMode: 'prod' });

  if (!finalReport.ok) {
    appendAppFailures(appId, `\n## ${new Date().toISOString()} release repair failed\n- summary: ${finalReport.summary || 'failed-state repair failed'}\n- findings:\n${(finalReport.blockingFailures || []).map(item => `  - ${item.label || item.checkId || item.type || 'UNKNOWN'}: ${item.detail || ''}`).join('\n')}\n`);
    setAppStage(appId, 'release_blocked', finalReport.summary || 'manual failed-state repair failed');
    return res.status(422).json({ ok: false, repaired: false, report: finalReport, error: finalReport.summary || 'failed-state repair failed' });
  }

  setAppStage(appId, 'backend_verified', finalReport.summary || 'manual release repair succeeded');
  res.json({ ok: true, repaired: true, report: finalReport, serverCode, sqlCode });
});

app.get('/api/apps/:id/qa-check', async (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'App not found' });
  if (!canAccessApp(appRow, req)) return res.status(403).json({ error: '編集権限がありません' });

  const checks = [];
  try {
    const w = await wakeAppRuntime(appId);
    checks.push({ name: 'runtime_wake', ok: !!w.previewPort, detail: w.previewPort ? 'preview running' : 'preview missing' });

    const slug = ensurePreviewSlug(appId);
    const previewPath = buildWorkspacePreviewPath(ensureWorkspaceSlug(appId));
    const previewUrl = `http://127.0.0.1:${PORT}${previewPath}/`;
    try {
      const pr = await fetch(previewUrl);
      checks.push({ name: 'preview_page', ok: pr.ok, detail: `status=${pr.status}` });
    } catch (e) {
      checks.push({ name: 'preview_page', ok: false, detail: String(e?.message || e) });
    }

    const latestRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appId);
    const latest = hydrateVersionRow(appId, latestRaw);
    const contracts = extractFrontendApiContracts(latest?.code || '');
    const uniqueGet = [];
    const seen = new Set();
    for (const c of contracts) {
      if (c.method !== 'GET') continue;
      // Skip obviously dynamic/template-like endpoints for smoke probe.
      if (!c.path || c.path.includes(':') || c.path.includes('{') || /\/$/.test(c.path)) continue;
      const k = `${c.method} ${c.path}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniqueGet.push(c);
      if (uniqueGet.length >= 3) break;
    }

    async function fetchWithRetry(url, retries = 3) {
      let last = null;
      for (let i = 0; i < retries; i++) {
        try {
          const r = await fetch(url);
          // transient backend warming statuses
          if ((r.status === 502 || r.status === 503) && i < retries - 1) {
            await new Promise(resolve => setTimeout(resolve, 350 * (i + 1)));
            continue;
          }
          return r;
        } catch (e) {
          last = e;
          if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, 350 * (i + 1)));
        }
      }
      throw last || new Error('fetch failed');
    }

    for (const c of uniqueGet) {
      const url = `http://127.0.0.1:${PORT}/app/${slug}${c.path}`;
      try {
        const r = await fetchWithRetry(url, 3);
        checks.push({ name: `api_${c.path}`, ok: r.ok, detail: `status=${r.status}` });
      } catch (e) {
        checks.push({ name: `api_${c.path}`, ok: false, detail: String(e?.message || e) });
      }
    }

    if (uniqueGet.length === 0) {
      checks.push({ name: 'api_probe', ok: true, detail: 'no stable GET contract to probe; skipped' });
    }

    const browserSmoke = await runBrowserSmoke(previewUrl, {
      budgetMs: 9000,
      settleMs: 1000,
      actionDelayMs: 700,
    });
    const browserBlocking = Array.isArray(browserSmoke?.blockingFailures) ? browserSmoke.blockingFailures : [];
    checks.push({
      name: 'browser_smoke',
      ok: !!browserSmoke?.ok,
      detail: browserSmoke?.ok
        ? 'browser smoke passed'
        : (browserBlocking.length
            ? browserBlocking.map(item => `${item.label}: ${item.detail}`).join(' | ')
            : (browserSmoke?.summary || 'browser smoke failed')),
    });

    const required = checks.filter(c => c.name === 'runtime_wake' || c.name === 'preview_page' || c.name.startsWith('api_') || c.name === 'browser_smoke');
    const passed = required.every(c => c.ok);
    const summary = passed ? 'QA passed' : 'QA failed';
    res.json({ ok: true, passed, summary, checks, browserSmoke, previewPath, previewUrl });
  } catch (e) {
    res.status(500).json({ error: `qa-check failed: ${e.message}` });
  }
});

// ── Admin (separate auth) ──────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({ error: 'ログイン失敗' });
  }
  const token = createToken();
  adminSessions.add(token);
  res.json({ token, username: ADMIN_USER });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = getAdminToken(req);
  if (token) adminSessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/admin/ai/config', requireAdmin, async (_req, res) => {
  try {
    res.json(await getAdminAiConfig());
  } catch (e) {
    res.status(500).json({ error: `admin ai config failed: ${String(e?.message || e)}` });
  }
});

app.post('/api/admin/ai/providers/openai-codex/oauth/start', requireAdmin, async (_req, res) => {
  try {
    res.json(await startOpenAICodexOAuthSession());
  } catch (e) {
    res.status(500).json({ error: `codex oauth start failed: ${String(e?.message || e)}` });
  }
});

app.get('/api/admin/ai/providers/openai-codex/oauth/:sessionId', requireAdmin, (req, res) => {
  const session = getOpenAICodexOAuthSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'oauth session not found' });
  res.json(session);
});

app.post('/api/admin/ai/providers/openai-codex/oauth/:sessionId/manual-code', requireAdmin, (req, res) => {
  try {
    const session = submitOpenAICodexOAuthManualInput(req.params.sessionId, req.body?.input || req.body?.code || '');
    res.json(session);
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.post('/api/admin/ai/providers/anthropic', requireAdmin, async (req, res) => {
  try {
    res.json(await saveAnthropicProvider(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.post('/api/admin/ai/default-model', requireAdmin, async (req, res) => {
  try {
    res.json(await updatePlatformDefaultModel(req.body?.modelKey || ''));
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.post('/api/admin/ai/providers/:providerId/models', requireAdmin, async (req, res) => {
  try {
    res.json(await updatePlatformProviderModels(req.params.providerId, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.delete('/api/admin/ai/providers/:providerId', requireAdmin, async (req, res) => {
  try {
    res.json(await disconnectPlatformProvider(req.params.providerId));
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const apps = db.prepare('SELECT COUNT(*) as c FROM apps').get().c;
  const pending = db.prepare(`
    SELECT COUNT(*) as c
    FROM apps
    WHERE review_status = 'pending' OR release_state = 'candidate'
  `).get().c;
  res.json({ users, apps, pending });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.email, u.nickname, u.avatar_url, u.created_at,
      (SELECT COUNT(*) FROM apps a WHERE a.owner_user_id = u.id) as app_count
    FROM users u
    ORDER BY u.id DESC
  `).all();
  res.json(rows);
});

app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT id, email, nickname, avatar_url, created_at, updated_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const apps = db.prepare(`
    SELECT id, name, icon, status, current_version, updated_at
    FROM apps
    WHERE owner_user_id = ?
    ORDER BY updated_at DESC
  `).all(req.params.id);
  res.json({ ...user, apps });
});

app.get('/api/admin/apps/review', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.name, a.icon, a.description, a.status, a.review_status, a.release_state, a.updated_at,
      a.live_version_id, a.candidate_version_id, a.last_failure_reason, a.last_failure_at, a.last_promoted_at,
      (
        SELECT MAX(arb.backup_version_number)
        FROM app_release_backups arb
        WHERE arb.release_app_id = a.id
      ) as latest_backup_version,
      (
        SELECT COUNT(*)
        FROM app_release_backups arb
        WHERE arb.release_app_id = a.id
      ) as backup_count,
      u.id as owner_id, u.email as owner_email, u.nickname as owner_nickname
    FROM apps a
    LEFT JOIN users u ON a.owner_user_id = u.id
    WHERE a.review_status = 'pending' OR a.release_state IN ('live','rollback','candidate','failed')
    ORDER BY a.updated_at DESC
  `).all();
  res.json(rows);
});

app.get('/api/admin/apps/:id/memory', requireAdmin, (req, res) => {
  const appId = Number(req.params.id);
  const row = db.prepare('SELECT id FROM apps WHERE id = ?').get(appId);
  if (!row) return res.status(404).json({ error: 'app not found' });
  const dir = ensureAppMemoryFiles(appId);
  const read = (name) => {
    try {
      const p = path.join(dir, name);
      if (!fs.existsSync(p)) return { text: '', mtime: null };
      return { text: fs.readFileSync(p, 'utf8'), mtime: fs.statSync(p).mtime.toISOString() };
    } catch {
      return { text: '', mtime: null };
    }
  };
  const memory = read('MEMORY.md');
  const decisions = read('DECISIONS.md');
  const releaseNotes = read('RELEASE_NOTES.md');
  res.json({
    appId,
    memory: memory.text,
    decisions: decisions.text,
    releaseNotes: releaseNotes.text,
    updatedAt: {
      memory: memory.mtime,
      decisions: decisions.mtime,
      releaseNotes: releaseNotes.mtime,
    },
  });
});

function applyAdminReleaseTransition(appId, transition) {
  const mapping = {
    candidate_to_live: {
      status: 'published',
      reviewStatus: 'approved',
      publishStatus: 'idle',
      runtimeMode: 'server',
      releaseState: 'live',
      setLastPromotedAt: true,
      clearCandidateVersion: true,
      keepLiveVersion: true,
    },
    rollback_to_live: {
      status: 'published',
      reviewStatus: 'approved',
      publishStatus: 'idle',
      runtimeMode: 'server',
      releaseState: 'live',
      setLastPromotedAt: true,
      clearCandidateVersion: true,
      keepLiveVersion: true,
    },
    failed_to_draft: {
      status: 'draft',
      reviewStatus: 'none',
      publishStatus: 'idle',
      runtimeMode: 'local',
      releaseState: 'draft',
      setLastPromotedAt: false,
      clearCandidateVersion: true,
      keepLiveVersion: true,
    },
    live_to_draft: {
      status: 'draft',
      reviewStatus: 'none',
      publishStatus: 'idle',
      runtimeMode: 'local',
      releaseState: 'draft',
      setLastPromotedAt: false,
      clearCandidateVersion: true,
      keepLiveVersion: false,
    },
  };
  const next = mapping[transition];
  if (!next) throw new Error(`unknown admin release transition: ${transition}`);
  db.prepare(`
    UPDATE apps
    SET
      status = ?,
      review_status = ?,
      publish_status = ?,
      runtime_mode = ?,
      release_state = ?,
      candidate_version_id = CASE WHEN ? THEN NULL ELSE candidate_version_id END,
      live_version_id = CASE WHEN ? THEN live_version_id ELSE NULL END,
      last_promoted_at = CASE WHEN ? THEN datetime('now') ELSE last_promoted_at END,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    next.status,
    next.reviewStatus,
    next.publishStatus,
    next.runtimeMode,
    next.releaseState,
    next.clearCandidateVersion ? 1 : 0,
    next.keepLiveVersion ? 1 : 0,
    next.setLastPromotedAt ? 1 : 0,
    appId,
  );
  return db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
}

app.patch('/api/admin/apps/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['draft', 'private', 'published'].includes(status)) return res.status(400).json({ error: 'invalid status' });
  const row = db.prepare('SELECT id FROM apps WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'app not found' });
  const appRow = status === 'published'
    ? applyAdminReleaseTransition(Number(req.params.id), 'candidate_to_live')
    : applyAdminReleaseTransition(Number(req.params.id), 'live_to_draft');
  res.json(appRow);
});

app.post('/api/admin/apps/:id/action', requireAdmin, (req, res) => {
  const appId = Number(req.params.id);
  const { action } = req.body || {};
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'app not found' });

  const getBackupSummary = () => {
    const backupCount = Number(db.prepare('SELECT COUNT(*) as c FROM app_release_backups WHERE release_app_id = ?').get(appId)?.c || 0);
    return {
      backupCount,
      rollbackAvailable: backupCount > 0,
    };
  };

  const applyAdminSemanticState = ({ status, reviewStatus, publishStatus = 'idle', runtimeMode, releaseState }) => {
    db.prepare(`
      UPDATE apps
      SET status = ?, review_status = ?, publish_status = ?, runtime_mode = ?, release_state = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, reviewStatus, publishStatus, runtimeMode, releaseState, appId);
    return db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  };

  const beforeReleaseState = appRow.release_state || deriveReleaseState(appRow);
  let updated = null;
  let summary = '';
  switch (action) {
    case 'promote_candidate_to_live':
    case 'mark_live':
      updated = applyAdminReleaseTransition(appId, 'candidate_to_live');
      summary = `App #${appId} promoted candidate to live release state`;
      break;
    case 'revert_to_draft':
    case 'send_to_draft':
      updated = applyAdminReleaseTransition(appId, 'live_to_draft');
      summary = `App #${appId} reverted live release to draft workspace state`;
      break;
    case 'promote_rollback_to_live':
    case 'recover_rollback_to_live':
      updated = applyAdminReleaseTransition(appId, 'rollback_to_live');
      summary = `App #${appId} promoted rollback runtime back to live`;
      break;
    case 'clear_failed_candidate':
      updated = applyAdminReleaseTransition(appId, 'failed_to_draft');
      summary = `App #${appId} cleared failed candidate back to draft`;
      break;
    default:
      return res.status(400).json({ error: 'invalid admin action' });
  }

  const backupSummary = getBackupSummary();
  const afterReleaseState = updated?.release_state || deriveReleaseState(updated);
  res.json({
    ok: true,
    action,
    summary,
    release: {
      before_release_state: beforeReleaseState,
      after_release_state: afterReleaseState,
      live_version_id: updated?.live_version_id ?? null,
      candidate_version_id: updated?.candidate_version_id ?? null,
      backup_count: backupSummary.backupCount,
      rollback_available: backupSummary.rollbackAvailable,
      last_promoted_at: updated?.last_promoted_at || null,
    },
    app: updated,
  });
});

app.get('/api/admin/cleanup/invalid-release-drafts', requireAdmin, (_req, res) => {
  try {
    const drafts = listInvalidReleaseDrafts();
    res.json({ ok: true, drafts, count: drafts.length });
  } catch (e) {
    console.error('list invalid release drafts failed:', e?.message || e);
    res.status(500).json({ error: 'list cleanup targets failed' });
  }
});

app.post('/api/admin/cleanup/invalid-release-drafts', requireAdmin, (req, res) => {
  try {
    const result = cleanupInvalidReleaseDrafts();
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('cleanup invalid release drafts failed:', e?.message || e);
    res.status(500).json({ error: 'cleanup failed' });
  }
});

app.get('/api/admin/cleanup/orphan-app-resources', requireAdmin, (_req, res) => {
  try {
    const items = listOrphanAppResources();
    const totalBytes = items.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0);
    res.json({ ok: true, items, count: items.length, totalBytes, totalMb: Number((totalBytes / 1024 / 1024).toFixed(2)) });
  } catch (e) {
    console.error('list orphan app resources failed:', e?.message || e);
    res.status(500).json({ error: 'list orphan resources failed' });
  }
});

app.post('/api/admin/cleanup/orphan-app-resources', requireAdmin, (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const result = cleanupOrphanAppResources(ids);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('cleanup orphan app resources failed:', e?.message || e);
    res.status(500).json({ error: 'cleanup orphan resources failed' });
  }
});

app.delete('/api/admin/apps/:id', requireAdmin, (req, res) => {
  const appId = Number(req.params.id);
  const row = db.prepare('SELECT id FROM apps WHERE id = ?').get(appId);
  if (!row) return res.status(404).json({ error: 'app not found' });

  try {
    const deletedIds = deleteAppDeep(appId);
    res.json({ ok: true, deletedIds, count: deletedIds.length });
  } catch (e) {
    console.error('admin delete app failed:', e?.message || e);
    res.status(500).json({ error: 'delete app failed' });
  }
});

app.get('/api/admin/runtimes', requireAdmin, async (_req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.name, a.icon, a.status, a.runtime_mode, a.preview_slug, a.last_access_at, a.updated_at,
           u.email as owner_email
    FROM apps a
    LEFT JOIN users u ON a.owner_user_id = u.id
    ORDER BY a.updated_at DESC
  `).all();

  const out = [];
  for (const r of rows) {
    const previewPort = getPreviewPort(r.id);
    const runtime = getContainerRuntime(r.id);
    const backendRunning = !!runtime?.running;
    const previewRunning = !!previewPort;

    let healthOk = false;
    let healthFrontend = false;
    let healthDbMode = null;
    const healthPayload = backendRunning ? await fetchRuntimeHealth(runtime) : null;
    if (healthPayload) {
      healthOk = !!healthPayload.ok;
      healthFrontend = !!healthPayload.frontend;
      healthDbMode = healthPayload.dbMode || null;
    }

    const inflight = autoFixInFlight.has(r.id);
    const cooldownUntil = autoFixCooldownUntil.get(r.id) || 0;
    const cooldownSec = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));

    out.push({
      ...r,
      preview_port: previewPort || null,
      api_port: null,
      runtime_mode: r.runtime_mode || 'local',
      release_state: deriveReleaseState(r),
      live_version_id: r.live_version_id ?? null,
      candidate_version_id: r.candidate_version_id ?? null,
      last_failure_reason: r.last_failure_reason ?? null,
      last_failure_at: r.last_failure_at ?? null,
      dockerized: backendRunning,
      backend_state: backendRunning ? 'running' : 'sleeping',
      preview_state: previewRunning ? 'running' : 'sleeping',
      frontend_state: healthFrontend ? 'running' : 'sleeping',
      runtime_state: backendRunning ? 'running' : 'sleeping',
      runtime_container: runtime?.containerName || null,
      health_ok: healthOk,
      health_frontend: healthFrontend,
      health_db_mode: healthDbMode,
      autofix_inflight: inflight,
      autofix_cooldown_sec: cooldownSec,
      preview_path: buildWorkspacePreviewPath(r.workspace_slug || ensureWorkspaceSlug(r.id)),
      public_path: buildWorkspacePublicPath(r.workspace_slug || ensureWorkspaceSlug(r.id)),
    });
  }
  res.json(out);
});

app.post('/api/admin/runtimes/:id/wake', requireAdmin, async (req, res) => {
  const appId = Number(req.params.id);
  const row = db.prepare('SELECT id FROM apps WHERE id = ?').get(appId);
  if (!row) return res.status(404).json({ error: 'app not found' });
  const r = await wakeAppRuntime(appId);
  let runtime = getContainerRuntime(appId);
  for (let i = 0; i < 8 && !(runtime && runtime.running); i++) {
    await new Promise(resolve => setTimeout(resolve, 200));
    runtime = getContainerRuntime(appId);
  }
  res.json({ ok: true, appId, previewPort: r.previewPort ?? null, apiPort: null, runtimeRunning: !!runtime?.running, container: runtime?.containerName || null });
});

app.post('/api/admin/runtimes/:id/sleep', requireAdmin, async (req, res) => {
  const appId = Number(req.params.id);
  const row = db.prepare('SELECT id FROM apps WHERE id = ?').get(appId);
  if (!row) return res.status(404).json({ error: 'app not found' });
  stopPreview(appId);
  stopAppBackend(appId);
  let runtime = getContainerRuntime(appId);
  for (let i = 0; i < 6 && runtime && runtime.running; i++) {
    await new Promise(resolve => setTimeout(resolve, 150));
    runtime = getContainerRuntime(appId);
  }
  res.json({ ok: true, appId, runtimeRunning: !!runtime?.running });
});

app.post('/api/apps/:id/ensure-workspace-draft', requireAuth, async (req, res) => {
  try {
    const sourceAppId = Number(req.params.id);
    const source = db.prepare('SELECT * FROM apps WHERE id = ?').get(sourceAppId);
    if (!source) return res.status(404).json({ error: 'App not found' });

    const releaseAppId = getEffectiveReleaseAppId(source);
    const releaseRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(releaseAppId);
    if (!releaseRow || deriveReleaseState(releaseRow) !== 'live') {
      return res.status(400).json({ error: 'Live リリースからのみワークスペース下書きを作成できます' });
    }

    const result = await ensureWorkspaceDraftFromRelease(releaseAppId, req.user.id);
    const draftRow = result.app;
    return res.json({
      ...withPreviewLink(draftRow),
      clone_ready: true,
      created_workspace_draft: result.created,
      release_app_id: releaseAppId,
      preview_port: getPreviewPort(draftRow.id),
      api_port: getApiPort(draftRow.id) ?? draftRow.api_port,
    });
  } catch (e) {
    console.error('ensure workspace draft failed:', e?.message || e);
    return res.status(500).json({ error: `workspace draft failed: ${String(e?.message || e)}` });
  }
});

app.post('/api/apps/:id/clone', requireAuth, async (req, res) => {
  const source = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!source || (source.release_state || deriveReleaseState(source)) !== 'live') return res.status(404).json({ error: 'Live App が見つかりません' });

  let newAppId = null;
  let lastVersion = 1;
  try {
    const tx = db.transaction(() => {
      const r = db.prepare(
        "INSERT INTO apps (owner_user_id, name, icon, description, status, app_role, release_app_id, current_version, color, runtime_mode, ai_model_key) VALUES (?, ?, ?, ?, 'draft', 'draft', ?, ?, ?, 'local', ?)"
      ).run(req.user.id, `${source.name}（ワークスペース）`, source.icon, source.description || '', source.id, Number(source.current_version || 1), source.color || null, source.ai_model_key || null);

      newAppId = Number(r.lastInsertRowid);
      const versionsRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number ASC').all(source.id);
      const versions = hydrateVersionRows(source.id, versionsRaw);
      for (const v of versions) {
        db.prepare(
          'INSERT INTO app_versions (app_id, version_number, label, code, server_code, sql_code) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(newAppId, v.version_number, v.label, '', '', '');
      }
      const mv = db.prepare('SELECT MAX(version_number) as mv FROM app_versions WHERE app_id = ?').get(newAppId).mv || 1;
      lastVersion = Number(mv || 1);
      db.prepare("UPDATE apps SET current_version = ?, updated_at = datetime('now') WHERE id = ?").run(lastVersion, newAppId);
    });
    tx();

    // Allow a little copy time while guaranteeing file integrity.
    await new Promise(resolve => setTimeout(resolve, 250));
    cloneAppAllFiles(source.id, newAppId);

    // Hard materialization: always reconstruct files from source versions,
    // so clone does not depend on source folder state/timing.
    const sourceVersionsRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number ASC').all(source.id);
    const sourceVersions = hydrateVersionRows(source.id, sourceVersionsRaw);
    for (const v of sourceVersions) {
      const srcFiles = readVersionFiles(source.id, v.version_number);
      const codeToUse = v.code || srcFiles.code || '';
      const serverToUse = v.server_code || srcFiles.server_code || '';
      const sqlToUse = v.sql_code || srcFiles.sql_code || '';
      writeVersionFiles(newAppId, v.version_number, codeToUse, serverToUse, sqlToUse);
    }

    validateClonedAppFiles(newAppId, lastVersion);

    const latestRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(newAppId);
    const latest = hydrateVersionRow(newAppId, latestRaw);

    if (latest) {
      appendAppSpecSnapshot(newAppId, `${source.name}（コピー）`, latest.version_number || lastVersion, latest.code || '', latest.server_code || '', latest.sql_code || '');
      writeApiAndDbDocs(newAppId, `${source.name}（コピー）`, latest.version_number || lastVersion, latest.code || '', latest.server_code || '', latest.sql_code || '');
    }

    let apiPort = null;
    if (latest?.server_code) {
      apiPort = await deployAppBackend(newAppId, latest.server_code, latest.sql_code || '', ensurePreviewSlug(newAppId));
      if (apiPort) db.prepare('UPDATE apps SET api_port = ? WHERE id = ?').run(apiPort, newAppId);
    }
    const previewSlug = ensurePreviewSlug(newAppId);
    if (latest?.code) startPreview(newAppId, latest.code, '', previewSlug);

    // Final readiness check: only return success when clone files are present.
    let ready = false;
    for (let i = 0; i < 10; i++) {
      try {
        validateClonedAppFiles(newAppId, lastVersion);
        ready = true;
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 120));
      }
    }
    if (!ready) throw new Error('clone files not ready');

    ensureAppFilesMaterializedFromDb(newAppId);
    // Enforce ownership to the user who executed clone.
    db.prepare("UPDATE apps SET owner_user_id = ?, guest_key = NULL, updated_at = datetime('now') WHERE id = ?").run(req.user.id, newAppId);

    const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(newAppId);
    const withLink = withPreviewLink(appRow);
    return res.json({ ...withLink, clone_ready: true, preview_port: getPreviewPort(newAppId), api_port: getApiPort(newAppId) ?? appRow.api_port });
  } catch (e) {
    console.error('clone failed:', e?.message || e);
    if (newAppId) {
      try {
        stopPreview(newAppId);
        stopAppBackend(newAppId);
        db.prepare('DELETE FROM app_versions WHERE app_id = ?').run(newAppId);
        db.prepare('DELETE FROM messages WHERE app_id = ?').run(newAppId);
        db.prepare('DELETE FROM apps WHERE id = ?').run(newAppId);
        fs.rmSync(getAppDir(newAppId), { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn('clone rollback warning:', cleanupErr?.message || cleanupErr);
      }
    }
    return res.status(500).json({ error: `clone failed: ${String(e?.message || e)}` });
  }
});

// ── Chat SSE ──────────────────────────────────────────────────────────

app.post('/api/apps/:id/chat', async (req, res) => {
  const { message, displayMessage, mode, modelKey } = req.body;
  const appId = Number(req.params.id);

  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'App not found' });
  const user = getAuthUser(req);
  if (isReleaseEditingLocked(appRow) && user && appRow.owner_user_id === user.id) {
    const ensured = await ensureWorkspaceDraftFromRelease(getEffectiveReleaseAppId(appRow), user.id);
    return res.status(409).json(buildWorkspaceDraftRedirectPayload(appRow, ensured.app, ensured.created));
  }
  const guestKey = getGuestKey(req);
  const ownerMatch = !!(appRow.owner_user_id && user && appRow.owner_user_id === user.id);
  const guestMatch = !!(!appRow.owner_user_id && appRow.guest_key && guestKey && appRow.guest_key === guestKey);
  if (!ownerMatch && !guestMatch) {
    return res.status(403).json({ error: '編集権限がありません' });
  }
  const selectedModelKey = await resolveSelectedModelKey(typeof modelKey === 'string' ? modelKey : appRow.ai_model_key || null);
  if ((ownerMatch || guestMatch) && selectedModelKey && selectedModelKey !== appRow.ai_model_key) {
    db.prepare("UPDATE apps SET ai_model_key = ?, updated_at = datetime('now') WHERE id = ?").run(selectedModelKey, appId);
    appRow.ai_model_key = selectedModelKey;
  }
  const callLlmForApp = (messages) => callLlmOnce(messages, { modelKey: selectedModelKey });

  const userDisplay = typeof displayMessage === 'string' && displayMessage.trim() ? displayMessage : message;
  db.prepare('INSERT INTO messages (app_id, role, content) VALUES (?, ?, ?)').run(appId, 'user', userDisplay);
  ensureAppMemoryFiles(appId);
  if (user?.id) ensureUserContextDir(user.id);
  const rawHistory = db.prepare('SELECT role, content FROM messages WHERE app_id = ? ORDER BY created_at ASC').all(appId)
    .map(m => ({ ...m, content: normalizeMessageForModel(m.content) }));

  const latestVersionForIteration = hydrateVersionRow(appId, db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appId));
  const originalFrontendBase = (readLatestFrontendCodeFromFiles(appId) || latestVersionForIteration?.code || '').trim();
  const appSpec = readAppSpec(appId);
  const apiContract = readApiContract(appId);
  const dbSchemaDoc = readDbSchemaDoc(appId);
  const schemaDiffContext = buildSchemaDiffWarning(appId, dbSchemaDoc);
  const hasExistingVersion = !!originalFrontendBase;
  const requestedMode = ['create', 'edit', 'rewrite'].includes(String(mode || '').toLowerCase())
    ? String(mode).toLowerCase()
    : (hasExistingVersion ? 'edit' : 'create');

  const history = buildWorkspaceHistory({
    requestedMode,
    rawHistory,
    userDisplay,
    appRow,
    originalFrontendBase,
    appSpec,
    apiContract,
    dbSchemaDoc,
    readModeDoc,
    normalizeMessageForModel,
    schemaDiffContext,
  });

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const runtimeMode = (appRow.runtime_mode || 'local');
    const isFrontendDevMode = runtimeMode === 'local' || (appRow.release_state || deriveReleaseState(appRow)) !== 'live';
    const modePrompt = buildModePrompt({
      requestedMode,
      runtimeMode,
      appStatus: appRow.status,
      appRow,
      userId: user?.id ?? null,
      appId,
      schemaDiffContext,
    });

    const full = await streamLlmText(
      [{ role: 'system', content: modePrompt }, ...history],
      {
        modelKey: selectedModelKey,
        onTextDelta: (delta) => {
          if (delta) send({ type: 'delta', content: delta });
        },
      },
    );

    // Save assistant message
    db.prepare('INSERT INTO messages (app_id, role, content) VALUES (?, ?, ?)').run(appId, 'assistant', full);

    // Parse frontend / backend / SQL from response
    const { jsx, server, sql } = parseAIResponse(full);

    if (!jsx) {
      send({ type: 'error', message: '生成未成功：模型没有返回有效的 App JSX，所以不会进入预览。' });
      send({ type: 'done' });
      return res.end();
    }

    const previousVersionRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appId);
    const previousVersion = hydrateVersionRow(appId, previousVersionRaw);
    const previousFrontendFromFile = readLatestFrontendCodeFromFiles(appId);
    const previousFrontendBase = previousFrontendFromFile || previousVersion?.code || '';
    const maxChangeRatio = inferAllowedChangeRatio(message);
    const workspaceProfile = inferWorkspaceIterationProfile({ message, runtimeMode, appStatus: appRow.status });

    const preflight = lintAndRepairJsx(jsx);
    let safeJsx = preflight.code;

    if (requestedMode === 'edit' && workspaceProfile.preferEarlyGuard) {
      const early = validateWorkspaceIterationEarly({ frontendCode: safeJsx, previousFrontendCode: previousFrontendBase, userMessage: message });
      if (!early.ok && early.errors.some(err => err.includes('destructive rewrite'))) {
        const msg = `Workspace early validation failed: ${early.errors.join(' | ')}`;
        db.prepare('INSERT INTO messages (app_id, role, content) VALUES (?, ?, ?)').run(appId, 'assistant', `⚠️ ${msg}`);
        send({ type: 'error', message: msg });
        send({ type: 'done' });
        return res.end();
      }
    }

    if (requestedMode === 'create' || requestedMode === 'edit' || requestedMode === 'rewrite') {
      console.log(`  ⚡ Fast-path ${requestedMode} mode enabled for app ${appId} (skip sync check/enhance passes)`);
    }

    if (requestedMode !== 'create' && requestedMode !== 'edit' && requestedMode !== 'rewrite') {
      // Incremental-first best practice only for Edit mode.
      if (requestedMode === 'edit' && !isIncrementalChangePreferred(previousFrontendBase, safeJsx, maxChangeRatio)) {
        try {
          const incrementalPrompt = `You are updating an existing app. Do MINIMAL CHANGES only.
Rules:
- Keep unchanged code lines exactly as-is whenever possible
- Only edit the smallest necessary sections to satisfy the new request
- Do NOT rename unrelated variables/components
- Do NOT reorder unrelated blocks
- Return complete JSX only in a jsx code block

User request:
${message}

Current JSX (must be your base):
\`\`\`jsx
${previousFrontendBase}
\`\`\`

Last generated JSX (too large rewrite; reduce it):
\`\`\`jsx
${safeJsx}
\`\`\``;
          const minimized = await callLlmForApp([
            { role: 'system', content: modePrompt },
            { role: 'user', content: incrementalPrompt },
          ]);
          const parsedMin = parseAIResponse(minimized);
          if (parsedMin.jsx) {
            const minPre = lintAndRepairJsx(parsedMin.jsx);
            if (isIncrementalChangePreferred(previousFrontendBase, minPre.code, maxChangeRatio)) {
              safeJsx = minPre.code;
            }
          }
        } catch (e) {
          console.warn('incremental minimize retry skipped:', e?.message || e);
        }
      }

      // Enforce selected design pattern tokens from prompt (one restyle retry if missing)
      const requiredDesignTokens = extractDesignTokensFromPrompt(message);
      if (requiredDesignTokens.length && !isDesignApplied(safeJsx, requiredDesignTokens)) {
        const restylePrompt = `Restyle the following JSX to match the selected design paradigm.
Rules:
- Keep business logic and API endpoints unchanged
- Rewrite only UI structure/className to satisfy design tokens
- Must include ALL tokens: ${requiredDesignTokens.join(' | ')}
- Return complete code in \`\`\`jsx block

Current JSX:
\`\`\`jsx
${safeJsx}
\`\`\``;
        const restyled = await callLlmForApp([
          { role: 'system', content: modePrompt },
          { role: 'user', content: restylePrompt },
        ]);
        const parsedRestyle = parseAIResponse(restyled);
        if (parsedRestyle.jsx) {
          const preflight2 = lintAndRepairJsx(parsedRestyle.jsx);
          if (isDesignApplied(preflight2.code, requiredDesignTokens)) {
            safeJsx = preflight2.code;
          }
        }
      }

      try {
        const repair = await runRepairPass({
          mode: requestedMode,
          frontendCode: safeJsx,
          userMessage: message,
          appSpec,
          apiContract,
          maxRetries: 1,
          callLlmOnce: callLlmForApp,
          parseAIResponse,
          lintAndRepairJsx,
          validateFrontendOnlyArtifacts,
          extractFrontendApiContracts,
          appRow,
          userId: user?.id ?? null,
          appId,
          runtimeMode,
          appStatus: appRow.status,
          schemaDiffContext,
        });
        if (repair?.code) safeJsx = repair.code;
      } catch (e) {
        console.warn('repair pass skipped:', e?.message || e);
      }
    }

    // Two-phase generation (A: minimal runnable, B: enhanced UX). Keep user-facing as one turn.
    const phaseA = (requestedMode === 'edit' && workspaceProfile.preferEarlyGuard)
      ? validateWorkspaceIterationEarly({ frontendCode: safeJsx, previousFrontendCode: previousFrontendBase, userMessage: message })
      : validateFrontendOnlyArtifacts(safeJsx);
    if (!phaseA.ok) {
      const msg = `Phase-A validation failed: ${phaseA.errors.join(' | ')}`;
      db.prepare('INSERT INTO messages (app_id, role, content) VALUES (?, ?, ?)').run(appId, 'assistant', `⚠️ ${msg}`);
      send({ type: 'error', message: msg });
      send({ type: 'done' });
      return res.end();
    }

    if (requestedMode !== 'create' && requestedMode !== 'edit' && requestedMode !== 'rewrite' && !workspaceProfile.skipEnhancementPass) {
      try {
        const phaseBPrompt = `You are in Phase-B enhancement. Improve UI polish and interactions while preserving runtime safety.
Rules:
- Keep all existing business logic and data flow intact
- Do not add unknown custom components/imports
- Keep code runnable in current no-import sandbox
- Return full JSX only in a jsx code block

Current safe Phase-A JSX:
\`\`\`jsx
${safeJsx}
\`\`\``;
        const enhanced = await callLlmForApp([
          { role: 'system', content: modePrompt },
          { role: 'user', content: phaseBPrompt },
        ]);
        const p = parseAIResponse(enhanced);
        if (p.jsx) {
          const pre = lintAndRepairJsx(p.jsx);
          const phaseB = validateFrontendOnlyArtifacts(pre.code);
          if (phaseB.ok) safeJsx = pre.code;
        }
      } catch (e) {
        console.warn('phase-b enhance skipped:', e?.message || e);
      }
    }

    // ── Save app version (frontend + backend code together) ────────────
    const verNum = (db.prepare('SELECT COUNT(*) as c FROM app_versions WHERE app_id = ?').get(appId).c) + 1;
    const vr = db.prepare(
      'INSERT INTO app_versions (app_id, version_number, code, server_code, sql_code) VALUES (?, ?, ?, ?, ?)'
    ).run(appId, verNum, '', '', '');
    db.prepare("UPDATE apps SET current_version = ?, updated_at = datetime('now') WHERE id = ?").run(verNum, appId);
    writeVersionFiles(appId, verNum, safeJsx, isFrontendDevMode ? '' : (server ?? ''), isFrontendDevMode ? '' : (sql ?? ''));

    // Update per-app spec doc for future iteration baseline
    try {
      if (requestedMode === 'create') {
        appendAppSpecSnapshot(appId, appRow.name, verNum, safeJsx, '', '');
        writeApiAndDbDocs(appId, appRow.name, verNum, safeJsx, '', '');
        writeCreateProposalDocs(appId, {
          appName: appRow.name,
          versionNumber: verNum,
          frontendCode: safeJsx,
          serverCode: server ?? '',
          sqlCode: sql ?? '',
        });
      } else {
        appendAppSpecSnapshot(appId, appRow.name, verNum, safeJsx, server ?? '', sql ?? '');
        writeApiAndDbDocs(appId, appRow.name, verNum, safeJsx, server ?? '', sql ?? '');
      }
      updateWorkspaceModeDocs(appId, requestedMode, {
        appName: appRow.name,
        userMessage: message,
        frontendCode: safeJsx,
        serverCode: server ?? '',
        sqlCode: sql ?? '',
        versionNumber: verNum,
      });
      writeReleaseNotes(appId, {
        appName: appRow.name,
        sourceMode: requestedMode,
        releaseAppId: getEffectiveReleaseAppId(appRow),
        userMessage: message,
        versionNumber: verNum,
      });
    } catch (e) {
      console.warn('spec/api docs warning:', e.message);
    }

    // Auto-name
    if (appRow.name === '新規アプリ') {
      const nameMatch = message.match(/(.{2,20})(アプリ|ダッシュボード|システム|管理|報告|一覧|ツール)/);
      if (nameMatch) db.prepare('UPDATE apps SET name = ? WHERE id = ?').run(nameMatch[0].slice(0, 20), appId);
    }

    // ── Deploy backend ─────────────────────────────────────────────────
    // Use AI-generated server code if present, otherwise re-use the last saved version
    let apiPort = null;
    let serverToUse  = server;
    let sqlToUse     = sql;

    if (!serverToUse) {
      // Look for server_code from a previous version
      const prev = db.prepare(
        "SELECT server_code, sql_code FROM app_versions WHERE app_id = ? AND server_code IS NOT NULL ORDER BY version_number DESC LIMIT 1"
      ).get(appId);
      if (prev) {
        console.log(`  ℹ️  Re-using backend code from previous version for app ${appId}`);
        serverToUse = prev.server_code;
        sqlToUse    = prev.sql_code ?? '';
      }
    }

    if (runtimeMode === 'server') {
      const contract = injectMissingApiStubs(safeJsx, serverToUse || '');
      if (contract.missing.length > 0) {
        console.log(`  🧩 Auto-filled ${contract.missing.length} missing API route(s) for app ${appId}`);
        serverToUse = contract.code;
      }
      if (serverToUse && serverToUse.trim()) {
        const normalizedBackend = normalizeBackendSqlStrings(serverToUse || '');
        if (normalizedBackend.changed && normalizedBackend.code) {
          console.log(`  🧹 Normalized ${normalizedBackend.rewrites?.length || 0} backend SQL string(s) for app ${appId}`);
          serverToUse = normalizedBackend.code;
        }
      }

      const validation = validateGeneratedArtifacts(safeJsx, serverToUse || '', sqlToUse || '', {
        frontendCode: previousVersion?.code || '',
        serverCode: previousVersion?.server_code || '',
        sqlCode: previousVersion?.sql_code || '',
      });
      if (!validation.ok) {
        const msg = `生成物検証に失敗: ${validation.errors.join(' | ')}`;
        db.prepare('INSERT INTO messages (app_id, role, content) VALUES (?, ?, ?)').run(appId, 'assistant', `⚠️ ${msg}`);
        send({ type: 'error', message: msg });
        send({ type: 'done' });
        return res.end();
      }

      if (serverToUse && serverToUse.trim()) {
        console.log(`\n🔧 Deploying backend for app ${appId}...`);
        apiPort = await deployAppBackend(appId, serverToUse, sqlToUse || '', ensurePreviewSlug(appId));
        if (apiPort) {
          db.prepare('UPDATE apps SET api_port = ? WHERE id = ?').run(apiPort, appId);
          send({ type: 'backend', apiPort });
        }
      }

      if (serverToUse) {
        db.prepare('UPDATE app_versions SET server_code = ?, sql_code = ? WHERE id = ?')
          .run(serverToUse, sqlToUse ?? null, vr.lastInsertRowid);
        writeVersionFiles(appId, verNum, safeJsx, serverToUse || '', sqlToUse || '');
      }
    }

    // ── Start preview server ──────────────────────────────────────────
    // Use SERVER_HOST (auto-detected LAN IP) so preview iframes work
    // from any device on the LAN, not just localhost
    const previewSlug = ensurePreviewSlug(appId);
    const previewPort = startPreview(appId, safeJsx, '', previewSlug);

    const savedAppFile = path.join(getAppDir(appId), 'App.jsx');
    const currentVersionAppFile = path.join(getVersionDir(appId, verNum), 'App.jsx');
    const workspaceReady = fs.existsSync(savedAppFile) && fs.statSync(savedAppFile).size > 0 && fs.existsSync(currentVersionAppFile) && fs.statSync(currentVersionAppFile).size > 0;
    if (!workspaceReady) {
      send({ type: 'error', message: '生成未成功：前端版本文件没有正确落盘，已阻止进入预览。' });
      send({ type: 'done' });
      return res.end();
    }

    send({
      type: 'code',
      code: safeJsx,
      versionId: vr.lastInsertRowid,
      versionNumber: verNum,
      previewPort,
      previewSlug,
      previewPath: buildWorkspacePreviewPath(ensureWorkspaceSlug(appId)),
      apiPort,
      hasBackend: runtimeMode === 'server' && !!server,
      hasDb: runtimeMode === 'server' && !!sql,
    });

    send({ type: 'done' });
    res.end();

  } catch (err) {
    console.error(err);
    send({ type: 'error', message: err.message });
    res.end();
  }
});

// ── Auto-fix route ───────────────────────────────────────────────────
app.post('/api/apps/:id/auto-fix', async (req, res) => {
  try {
    const appId = Number(req.params.id);
    const now = Date.now();
    const until = autoFixCooldownUntil.get(appId) || 0;
    if (now < until) {
      const waitSec = Math.ceil((until - now) / 1000);
      return res.status(429).json({ error: `auto-fix cooldown (${waitSec}s)` });
    }
    if (autoFixInFlight.has(appId)) {
      return res.status(429).json({ error: 'auto-fix already running' });
    }
    autoFixInFlight.add(appId);

    const { error, errorType = 'RuntimeError', detail = '', url = '', retries = 0 } = req.body || {};
    if (!error) return res.status(400).json({ error: 'missing error message' });

    const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
    if (!appRow) return res.status(404).json({ error: 'App not found' });
    const user = getAuthUser(req);
    if (isReleaseEditingLocked(appRow) && user && appRow.owner_user_id === user.id) {
      const ensured = await ensureWorkspaceDraftFromRelease(getEffectiveReleaseAppId(appRow), user.id);
      return res.status(409).json(buildWorkspaceDraftRedirectPayload(appRow, ensured.app, ensured.created));
    }
    const guestKey = getGuestKey(req);
    const ownerMatch = !!(appRow.owner_user_id && user && appRow.owner_user_id === user.id);
    const guestMatch = !!(!appRow.owner_user_id && appRow.guest_key && guestKey && appRow.guest_key === guestKey);
    if (!ownerMatch && !guestMatch) {
      return res.status(403).json({ error: '編集権限がありません' });
    }
    const selectedModelKey = await resolveSelectedModelKey(appRow.ai_model_key || null);
    const callLlmForApp = (messages) => callLlmOnce(messages, { modelKey: selectedModelKey });

    const latestRaw = db.prepare(`
      SELECT * FROM app_versions
      WHERE app_id = ?
      ORDER BY version_number DESC
      LIMIT 1
    `).get(appId);
    const latest = hydrateVersionRow(appId, latestRaw);
    if (!latest?.code) return res.status(400).json({ error: 'No previous code to fix' });
    const runtimeMode = appRow.runtime_mode || 'local';
    const hasPersistedBackend = !!String(latest.server_code || '').trim()
      || runtimeMode === 'server'
      || !!(getApiPort(appId) ?? appRow.api_port);

    const looksLikeInfraError =
      ['NetworkError', 'APIError'].includes(errorType) ||
      /\b502\b|bad gateway|ECONNREFUSED|fetch failed|network/i.test(`${error}\n${detail}`);
    const shouldTryInfraRecovery = looksLikeInfraError && hasPersistedBackend;

    // Diagnose/recover infra first for common 502-class errors before asking AI to rewrite code.
    if (shouldTryInfraRecovery) {
      const recoveredContract = injectMissingApiStubs(latest.code || '', latest.server_code || '');
      const recoveredNormalization = normalizeBackendSqlStrings(recoveredContract.code || '');
      const recoveredServer = recoveredNormalization.code || recoveredContract.code;
      let recoveredApiPort = null;
      const previewSlug = ensurePreviewSlug(appId);
      if (recoveredServer && recoveredServer.trim()) {
        recoveredApiPort = await deployAppBackend(appId, recoveredServer, latest.sql_code || '', previewSlug);
        if (recoveredApiPort) {
          db.prepare('UPDATE apps SET api_port = ? WHERE id = ?').run(recoveredApiPort, appId);
        }
        db.prepare('UPDATE app_versions SET server_code = ? WHERE id = ?').run(recoveredServer, latest.id);
      }
      if (!recoveredApiPort) {
        appendAppFailures(appId, `\n## ${new Date().toISOString()} auto-fix infra recovery skipped\n- detail: backend restart was attempted but no runtime became reachable; continuing to AI repair is required.\n`);
      } else {
        const recoveredPreviewPort = startPreview(appId, latest.code, '', previewSlug);

        db.prepare('INSERT INTO messages (app_id, role, content) VALUES (?, ?, ?)')
          .run(appId, 'assistant', `🩺 まずインフラを復旧しました（backend/preview 再起動）: ${errorType}`);

        setAppStage(appId, 'backend_verified', 'infra recovered and runtime restarted');
        return res.json({
          ok: true,
          recovered: true,
          message: 'infra recovered (backend/preview restarted)',
          versionId: latest.id,
          versionNumber: latest.version_number,
          previewPort: recoveredPreviewPort,
          previewSlug: previewSlug,
          previewPath: buildWorkspacePreviewPath(ensureWorkspaceSlug(appId)),
          apiPort: recoveredApiPort,
          hasBackend: true,
          hasDb: !!(latest.sql_code || '').trim(),
          code: latest.code,
        });
      }
    }

    const currentDbSchemaDoc = readDbSchemaDoc(appId);
    const schemaDiffContext = buildSchemaDiffWarning(appId, currentDbSchemaDoc);
    const appSpec = readAppSpec(appId);
    const apiContract = readApiContract(appId);
    const buildAutoFixPrompt = ({
      frontendCode = latest.code || '',
      backendCode = latest.server_code || '',
      sqlCode = latest.sql_code || '',
      browserFailureContext = '',
    } = {}) => `You are funfo AI's auto-fixer. Repair the app based on runtime error logs.

${schemaDiffContext ? `[SCHEMA_DIFF_WARNING]\n${schemaDiffContext}\n\n` : ''}Rules:
- Return complete frontend in \`\`\`jsx block (required)
- If backend changes are needed, include \`\`\`javascript server block
- If DB changes are needed, include \`\`\`sql block
- Preserve existing features and old APIs unless explicitly requested to remove
- Preserve existing data compatibility (non-destructive DB evolution only)
- No import statements
- No TypeScript syntax
- All UI text in Japanese
- Use Tailwind className styling
- Ensure all fetch endpoints used in frontend exist in backend routes
- Respect the app runtime mode:
  - local mode -> prefer frontend-only repair; remove accidental backend/API dependencies unless the app already has a real backend
  - server mode -> preserve API-driven flows and repair backend/contracts instead of deleting them

Error Context:
- type: ${errorType}
- message: ${error}
- detail: ${detail}
- url: ${url}
- retries: ${retries}

${browserFailureContext ? `Browser verification findings from the previous repair attempt:
${browserFailureContext}

` : ''}Current frontend code:
\`\`\`jsx
${frontendCode}
\`\`\`

Current backend code:
\`\`\`javascript
${backendCode}
\`\`\`

Current SQL:
\`\`\`sql
${sqlCode}
\`\`\`
`;

    const repairSystemPrompt = buildRepairSystemPrompt({
      requestedMode: 'edit',
      runtimeMode: appRow.runtime_mode || 'server',
      appStatus: appRow.status,
      appRow,
      userId: user?.id ?? null,
      appId,
    });
    const previewSlug = ensurePreviewSlug(appId);
    const workspaceSlug = ensureWorkspaceSlug(appId);
    const previewPath = buildWorkspacePreviewPath(workspaceSlug);
    let safeJsx = '';
    let serverToUse = latest.server_code ?? null;
    let sqlToUse = latest.sql_code ?? '';
    let browserSmoke = null;
    let previewPort = null;
    let apiPort = getApiPort(appId) ?? appRow.api_port ?? null;
    let assistantReply = '';
    let browserFailureContext = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
      const full = await callLlmForApp([
        { role: 'system', content: repairSystemPrompt },
        { role: 'user', content: buildAutoFixPrompt({
          frontendCode: attempt === 1 ? (latest.code || '') : safeJsx,
          backendCode: attempt === 1 ? (latest.server_code || '') : (serverToUse || ''),
          sqlCode: attempt === 1 ? (latest.sql_code || '') : (sqlToUse || ''),
          browserFailureContext,
        }) },
      ]);
      assistantReply = full;

      const { jsx, server, sql } = parseAIResponse(full);
      if (jsx) {
        const preflight = lintAndRepairJsx(jsx);
        safeJsx = preflight.code;
      } else {
        const fallbackRepair = await runRepairPass({
          mode: 'edit',
          frontendCode: attempt === 1 ? (latest.code || '') : safeJsx,
          userMessage: `Auto-fix runtime error (${errorType}): ${error}\n${detail || ''}\n${browserFailureContext || ''}`,
          appSpec,
          apiContract,
          maxRetries: 1,
          callLlmOnce: callLlmForApp,
          parseAIResponse,
          lintAndRepairJsx,
          validateFrontendOnlyArtifacts,
          extractFrontendApiContracts,
          appRow,
          userId: user?.id ?? null,
          appId,
          runtimeMode,
          appStatus: appRow.status,
          schemaDiffContext,
        });
        if (!fallbackRepair?.code) {
          return res.status(422).json({ error: 'Model returned no jsx block' });
        }
        safeJsx = fallbackRepair.code;
      }

      serverToUse = server ?? serverToUse ?? latest.server_code ?? null;
      sqlToUse = sql ?? sqlToUse ?? latest.sql_code ?? '';

      {
        const contract = injectMissingApiStubs(safeJsx, serverToUse || '');
        if (contract.missing.length > 0) {
          console.log(`  🧩 Auto-filled ${contract.missing.length} missing API route(s) in auto-fix for app ${appId}`);
          serverToUse = contract.code;
        }
      }
      if (serverToUse && serverToUse.trim()) {
        const normalizedBackend = normalizeBackendSqlStrings(serverToUse || '');
        if (normalizedBackend.changed && normalizedBackend.code) {
          console.log(`  🧹 Normalized ${normalizedBackend.rewrites?.length || 0} backend SQL string(s) in auto-fix for app ${appId}`);
          serverToUse = normalizedBackend.code;
        }
      }

      const frontendOnlyValidation = validateFrontendOnlyArtifacts(safeJsx);
      const leakedFrontendContracts = extractFrontendApiContracts(safeJsx);
      const shouldStayFrontendOnly = runtimeMode !== 'server' && !String(serverToUse || '').trim();
      const validation = shouldStayFrontendOnly
        ? {
            ok: frontendOnlyValidation.ok && leakedFrontendContracts.length === 0,
            errors: [
              ...frontendOnlyValidation.errors,
              ...(leakedFrontendContracts.length > 0
                ? [`Frontend-only auto-fix still contains API contracts: ${leakedFrontendContracts.slice(0, 4).map(item => `${item.method} ${item.path}`).join(', ')}`]
                : []),
            ],
          }
        : validateGeneratedArtifacts(safeJsx, serverToUse || '', sqlToUse || '', {
            frontendCode: latest?.code || '',
            serverCode: latest?.server_code || '',
            sqlCode: latest?.sql_code || '',
          });
      if (!validation.ok) {
        return res.status(422).json({ error: `auto-fix validation failed: ${validation.errors.join(' | ')}` });
      }

      apiPort = getApiPort(appId) ?? appRow.api_port ?? null;
      if (serverToUse) {
        apiPort = await deployAppBackend(appId, serverToUse, sqlToUse || '', previewSlug);
        if (apiPort) db.prepare('UPDATE apps SET api_port = ? WHERE id = ?').run(apiPort, appId);
      }

      previewPort = startPreview(appId, safeJsx, '', previewSlug);
      browserSmoke = await runBrowserSmoke(`http://127.0.0.1:${PORT}${previewPath}/`, {
        budgetMs: 9000,
        settleMs: 1000,
        actionDelayMs: 700,
      });
      if (browserSmoke?.ok) break;

      if (String(latest.server_code || '').trim()) {
        await deployAppBackend(appId, latest.server_code || '', latest.sql_code || '', previewSlug);
      } else if (String(serverToUse || '').trim()) {
        stopAppBackend(appId);
      }
      startPreview(appId, latest.code || '', '', previewSlug);

      const browserDetail = Array.isArray(browserSmoke?.blockingFailures) && browserSmoke.blockingFailures.length
        ? browserSmoke.blockingFailures.map(item => `${item.label}: ${item.detail}`).join(' | ')
        : (browserSmoke?.summary || 'browser smoke failed');
      browserFailureContext = `Previous browser verification failed on attempt ${attempt}:
- ${browserDetail}

Repair this exact browser failure and keep all existing working behavior intact.`;
      if (attempt >= 2) {
        appendAppFailures(appId, `\n## ${new Date().toISOString()} auto-fix browser smoke failed\n- summary: ${browserSmoke?.summary || 'browser smoke failed'}\n- detail: ${browserDetail}\n`);
        return res.status(422).json({
          error: `auto-fix browser verification failed: ${browserDetail}`,
          browserSmoke,
          previewPath,
          previewPort,
        });
      }
    }

    const nextVersion = (latest.version_number || 0) + 1;
    const ins = db.prepare(
      'INSERT INTO app_versions (app_id, version_number, label, code, server_code, sql_code) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(appId, nextVersion, `auto-fix v${nextVersion}`, safeJsx, serverToUse ?? '', sqlToUse ?? '');
    db.prepare("UPDATE apps SET current_version = ?, updated_at = datetime('now') WHERE id = ?")
      .run(nextVersion, appId);
    writeVersionFiles(appId, nextVersion, safeJsx, serverToUse || '', sqlToUse || '');

    try {
      appendAppSpecSnapshot(appId, appRow.name, nextVersion, safeJsx, serverToUse || '', sqlToUse || '');
      writeApiAndDbDocs(appId, appRow.name, nextVersion, safeJsx, serverToUse || '', sqlToUse || '');
    } catch (e) {
      console.warn('spec/api docs warning:', e.message);
    }

    db.prepare('INSERT INTO messages (app_id, role, content) VALUES (?, ?, ?)')
      .run(
        appId,
        'assistant',
        `✅ AI 修复完成，已生成 v${nextVersion}、刷新预览，并通过浏览器验证（${errorType}: ${error.slice(0, 120)}）`
      );

    setAppStage(appId, serverToUse ? 'backend_verified' : 'frontend_ready', serverToUse ? 'auto-fix repaired app and redeployed backend' : 'auto-fix updated frontend only');
    appendAppReleaseNotes(appId, `\n## ${new Date().toISOString()} auto-fix success\n- version: v${nextVersion}\n- backend: ${serverToUse ? 'yes' : 'no'}\n- db: ${sqlToUse ? 'yes' : 'no'}\n`);
    appendAppMemory(appId, `\n- ${new Date().toISOString()}: auto-fix succeeded; created v${nextVersion}; backend=${serverToUse ? 'enabled' : 'frontend-only'}.\n`);
    res.json({
      ok: true,
      versionId: ins.lastInsertRowid,
      versionNumber: nextVersion,
      previewPort,
      previewSlug,
      previewPath,
      apiPort,
      hasBackend: !!serverToUse,
      hasDb: !!sqlToUse,
      message: 'auto-fix applied and browser-verified',
      code: safeJsx,
      assistant: assistantReply,
      browserSmoke,
    });
  } catch (err) {
    console.error('auto-fix error:', err);
    const appId = Number(req.params.id);
    const msg = String(err?.message || err || 'auto-fix failed');
    appendAppReleaseNotes(appId, `\n## ${new Date().toISOString()} auto-fix failed\n- detail: ${msg}\n`);
    appendAppMemory(appId, `\n- ${new Date().toISOString()}: auto-fix failed; detail=${msg}.\n`);
    appendAppFailures(appId, `\n## ${new Date().toISOString()} auto-fix failed\n- detail: ${msg}\n`);
    // timeout/abort/network class errors -> cooldown to prevent loop storms
    if (/aborted|timeout|timed out|fetch failed|network|5\d\d/i.test(msg)) {
      autoFixCooldownUntil.set(appId, Date.now() + 90 * 1000);
    }
    setAppStage(appId, 'repair_needed', msg);
    res.status(500).json({ error: msg });
  } finally {
    const appId = Number(req.params.id);
    autoFixInFlight.delete(appId);
  }
});

// ── Start ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅ funfo AI backend  → http://localhost:${PORT}`);
  const noSlugRows = db.prepare("SELECT id FROM apps WHERE preview_slug IS NULL OR preview_slug = ''").all();
  noSlugRows.forEach(r => ensurePreviewSlug(r.id));
  restoreFromDb(db, SERVER_HOST);
  restoreBackendsFromDb(db);
  startIdleRuntimeSweeper();
});
