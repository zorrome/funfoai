const fs = require('fs');
const path = require('path');
const {
  RELEASE_ROLE_PROMPT,
  RELEASE_FRONTEND_CONVERSION_PROMPT,
  RELEASE_BACKEND_GENERATION_PROMPT,
} = require('../prompts');
const {
  ensureAppMemoryFiles,
  buildAppMemoryContext,
  appendAppMemory,
  appendAppDecisions,
  appendAppFailures,
  appendAppReleaseNotes,
  writeAppPlan,
} = require('../context-loader');
const {
  buildReleaseSystemPrompt,
} = require('../prompt-orchestrator');


const PUBLISH_LOG_DIR = path.join(__dirname, '..', 'logs', 'publish');

function toContractKeys(contracts = []) {
  return (contracts || []).map((item) => `${String(item?.method || '').toUpperCase()} ${String(item?.path || '').trim()}`).filter(Boolean);
}

function sanitizePublishLogValue(value, depth = 0) {
  if (depth > 4) return '[max-depth]';
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 4000 ? `${value.slice(0, 4000)}…[truncated]` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizePublishLogValue(item, depth + 1));
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? String(value.stack).split('\n').slice(0, 20).join('\n') : null,
      publishFailure: sanitizePublishLogValue(value.publishFailure, depth + 1),
    };
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 50)) out[k] = sanitizePublishLogValue(v, depth + 1);
    return out;
  }
  return String(value);
}

function appendPublishLog(appId, event, payload = {}) {
  try {
    fs.mkdirSync(PUBLISH_LOG_DIR, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      appId: Number(appId),
      event,
      ...sanitizePublishLogValue(payload),
    });
    fs.appendFileSync(path.join(PUBLISH_LOG_DIR, `app-${Number(appId)}.jsonl`), `${line}\n`);
  } catch (err) {
    console.warn('publish log write failed:', err?.message || err);
  }
}

function archivePublishLogToAppDir(appId) {
  try {
    const source = path.join(PUBLISH_LOG_DIR, `app-${Number(appId)}.jsonl`);
    if (!fs.existsSync(source)) return null;
    const appLogDir = path.join(__dirname, '..', 'apps', String(Number(appId)), 'log');
    fs.mkdirSync(appLogDir, { recursive: true });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${pad(d.getMonth()+1)}${pad(d.getDate())}${String(d.getFullYear()).slice(-2)}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const target = path.join(appLogDir, `error_log_publish${stamp}.jsonl`);
    fs.copyFileSync(source, target);
    return target;
  } catch (err) {
    console.warn('publish log archive failed:', err?.message || err);
    return null;
  }
}

function analyzeReleaseFrontend(frontendCode = '') {
  const code = String(frontendCode || '');
  const usesApiBase = /\bAPI_BASE\b/.test(code);
  const usesFetch = /\bfetch\s*\(/.test(code);
  const usesApiHelpers = /\bapi(?:Get|Send|Delete)\s*\(/.test(code);
  const usesApiPath = /['"`]\/api\//.test(code)
    || /API_BASE\s*\+\s*['"`]\/api\//.test(code)
    || /\bapi(?:Get|Delete)\(\s*(?:[^)]*?['"`])?\/api\//.test(code)
    || /\bapiSend\(\s*(?:[^,]*?['"`])?\/api\//.test(code);
  const usesLocalStorage = /\blocalStorage\b/.test(code);
  const usesSessionStorage = /\bsessionStorage\b/.test(code);
  const usesMockData = /\b(mock|sampleData|demoData|seedData|STORAGE_KEY)\b/.test(code);
  const serverDriven = (usesFetch && usesApiBase)
    || ((usesApiBase || usesFetch || usesApiHelpers) && usesApiPath)
    || (usesApiHelpers && usesApiPath);
  const localFirstSignals = usesLocalStorage || usesSessionStorage || usesMockData || !serverDriven;
  return {
    usesApiBase,
    usesFetch,
    usesApiHelpers,
    usesApiPath,
    usesLocalStorage,
    usesSessionStorage,
    usesMockData,
    serverDriven,
    localFirstSignals,
  };
}

function uniqStrings(values = [], limit = 20) {
  const out = [];
  const seen = new Set();
  for (const raw of values || []) {
    const value = String(raw || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function buildReleasePlanDoc(appName, releaseManifest, publishMode) {
  const manifest = releaseManifest || {};
  const entityLines = (manifest.entities || []).slice(0, 12).map((entity) => {
    const fields = Array.isArray(entity.fields) && entity.fields.length ? ` (${entity.fields.join(', ')})` : '';
    return `- ${entity.name}${fields}`;
  }).join('\n');
  const routeLines = (manifest.routes || []).slice(0, 20).map((route) => {
    return `- ${String(route.method || 'GET').toUpperCase()} ${route.route} — ${route.purpose || 'core route'}`;
  }).join('\n');
  const tableLines = (manifest.tables || []).slice(0, 12).map((table) => {
    const cols = Array.isArray(table.columns) && table.columns.length ? ` (${table.columns.join(', ')})` : '';
    return `- ${table.name}${cols}`;
  }).join('\n');
  const noteLines = (manifest.notes || []).slice(0, 12).map((note) => `- ${note}`).join('\n');
  return [
    `# ${appName || 'App'} Plan`,
    '',
    `- Publish mode: ${publishMode || 'llm_provider'}`,
    `- Release strategy: ${manifest.releaseStrategy || 'stabilize core business loop and publish with explicit contracts'}`,
    '',
    '## Entities',
    entityLines || '- none yet',
    '',
    '## Routes',
    routeLines || '- none yet',
    '',
    '## Tables',
    tableLines || '- none yet',
    '',
    '## Notes',
    noteLines || '- none yet',
    '',
  ].join('\n');
}

function extractFrontendReleaseSummary(frontendCode = '') {
  const code = String(frontendCode || '');
  const entityHints = uniqStrings((code.match(/\b(?:reservations?|customers?|users?|tables?|orders?|items?|payments?|schedules?|events?)\b/gi) || []).map(s => s.toLowerCase()), 16);
  const apiRoutes = uniqStrings(Array.from(code.matchAll(/\/api\/([a-zA-Z0-9_\-\/]+)/g)).map(m => `/api/${m[1]}`), 24);
  const stateVars = uniqStrings(Array.from(code.matchAll(/const\s*\[\s*([A-Za-z0-9_]+)\s*,\s*set[A-Za-z0-9_]+\s*\]\s*=\s*useState/g)).map(m => m[1]), 30);
  const localStorageKeys = uniqStrings(Array.from(code.matchAll(/localStorage\.(?:getItem|setItem)\(\s*['"`]([^'"`]+)['"`]/g)).map(m => m[1]), 10);
  const functionNames = uniqStrings(Array.from(code.matchAll(/function\s+([A-Za-z0-9_]+)/g)).map(m => m[1]), 40);
  const fetchCalls = uniqStrings(Array.from(code.matchAll(/fetch\(([^\n\r]{1,160})\)/g)).map(m => m[1]), 20);
  const jsxSections = uniqStrings(Array.from(code.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)).map(m => m[1]), 20);
  const lineCount = code ? code.split(/\r?\n/).length : 0;
  return {
    bytes: Buffer.byteLength(code, 'utf8'),
    lineCount,
    entityHints,
    apiRoutes,
    stateVars,
    localStorageKeys,
    functionNames,
    fetchCalls,
    jsxSections,
    analysis: analyzeReleaseFrontend(code),
  };
}

function buildFrontendCodeExcerpt(frontendCode = '', maxChars = 12000) {
  const code = String(frontendCode || '');
  if (!code) return '';
  if (code.length <= maxChars) return code;

  // Priority 1: Extract ALL API-related code blocks (fetch, apiGet, apiSend, etc.)
  // These are critical for backend generation and must not be lost to truncation
  const apiBlocks = [];
  const apiPatterns = [
    /(?:function\s+(?:api(?:Get|Send|Delete|Post|Put)|load\w+|fetch\w+|refresh\w+|handle\w+)\s*\([^)]*\)\s*\{[\s\S]*?\n\})/g,
    /fetch\([^)]*\)[\s\S]{0,300}?(?:\.then|\.json|await)/g,
    /api(?:Get|Send|Delete)\([^)]*\)/g,
  ];
  const apiBlockSet = new Set();
  for (const pattern of apiPatterns) {
    const matches = code.match(pattern) || [];
    for (const match of matches) {
      const trimmed = match.slice(0, 2000);
      if (!apiBlockSet.has(trimmed)) {
        apiBlockSet.add(trimmed);
        apiBlocks.push(trimmed);
      }
    }
  }
  const apiSection = apiBlocks.join('\n\n');
  const apiBudget = Math.min(apiSection.length, Math.floor(maxChars * 0.4));

  const headChars = Math.floor(maxChars * 0.35);
  const tailChars = Math.floor(maxChars * 0.15);
  const middleBudget = Math.max(0, maxChars - headChars - tailChars - apiBudget - 300);

  const interesting = [];
  const patterns = [
    /function\s+App\s*\([\s\S]{0,4000}?\n\}/g,
    /localStorage\.[\s\S]{0,400}?;/g,
    /const\s+\[[\s\S]{0,180}?useState\([\s\S]{0,220}?\);/g,
  ];
  for (const pattern of patterns) {
    const matches = code.match(pattern) || [];
    for (const match of matches) {
      interesting.push(match.slice(0, 1200));
      if (interesting.join('\n\n').length >= middleBudget) break;
    }
    if (interesting.join('\n\n').length >= middleBudget) break;
  }
  const middle = interesting.join('\n\n').slice(0, middleBudget);

  return [
    code.slice(0, headChars),
    '\n\n/* === API/fetch functions (preserved for backend generation) === */\n\n',
    apiSection.slice(0, apiBudget),
    '\n\n/* ... truncated for release generation ... */\n\n',
    middle,
    '\n\n/* ... tail excerpt ... */\n\n',
    code.slice(-tailChars),
  ].join('');
}

function buildReleaseGenerationContext(frontendCode = '', options = {}) {
  const summary = extractFrontendReleaseSummary(frontendCode);
  const excerpt = buildFrontendCodeExcerpt(frontendCode, options.maxExcerptChars || 12000);
  return {
    summary,
    excerpt,
    promptText: `Frontend summary (derived, compact):\n${JSON.stringify(summary, null, 2)}\n\nFrontend JSX excerpt (truncated):\n\`\`\`jsx\n${excerpt}\n\`\`\``,
  };
}

function buildReleaseManifestSkeleton(frontendCode = '', options = {}) {
  const compact = buildReleaseGenerationContext(frontendCode, options);
  const summary = compact.summary || {};
  const apiRoutes = (summary.apiRoutes || []).map(route => ({
    route,
    method: route.includes('/delete') ? 'DELETE' : route.includes('/update') ? 'PUT' : 'POST',
    purpose: 'derived-from-frontend',
  }));
  const entities = (summary.entityHints || []).map(name => ({
    name,
    storage: (summary.analysis?.usesLocalStorage || summary.analysis?.usesSessionStorage) ? 'persisted' : 'unknown',
  }));
  const tables = entities.map(entity => ({
    name: entity.name.replace(/s$/, '') || entity.name,
    source: 'derived-from-frontend',
  }));
  const operations = apiRoutes.map(item => ({
    route: item.route,
    method: item.method,
    entity: entities[0]?.name || null,
  }));
  return {
    mode: options.mode || 'standard',
    frontendBytes: summary.bytes || Buffer.byteLength(String(frontendCode || ''), 'utf8'),
    lineCount: summary.lineCount || 0,
    entities,
    routes: apiRoutes,
    tables,
    operations,
    localFirstSignals: summary.analysis?.localFirstSignals || false,
    notes: [
      'manifest is heuristic and should be corrected by backend/sql generation when needed',
      'prefer compatibility-safe schema and explicit CRUD routes',
    ],
  };
}

function buildDeterministicFrontendFallback(frontendCode = '', releaseManifest = null) {
  const manifest = releaseManifest || buildReleaseManifestSkeleton(frontendCode, { mode: 'fallback' });
  const routes = Array.isArray(manifest?.routes) ? manifest.routes.filter(r => r && r.route) : [];
  const getRoutes = routes.filter(r => String(r.method || 'GET').toUpperCase() === 'GET');
  const postRoutes = routes.filter(r => !['GET', 'HEAD'].includes(String(r.method || '').toUpperCase()));
  const primaryGet = getRoutes.find(r => /\/api\/(users?|items?|records?|rows?|list|data)(\/|$)/.test(r.route)) || getRoutes[0] || null;
  const statsGet = getRoutes.find(r => /stats|summary|metrics/.test(r.route)) || null;
  const sessionGet = getRoutes.find(r => /current|session|me/.test(r.route)) || null;
  const primaryPost = postRoutes.find(r => /login|create|add|users?/.test(r.route)) || postRoutes[0] || null;
  const logoutPost = postRoutes.find(r => /logout/.test(r.route)) || null;
  const entity = (manifest?.entities && manifest.entities[0]) || { name: 'record', fields: ['name'] };
  const fields = Array.isArray(entity.fields) && entity.fields.length ? entity.fields : ['name', 'gender', 'age'];
  const editableFields = fields.filter(f => !/^(id|createdAt|updatedAt|loginAt|logoutAt|loggedInAt|loggedOutAt|isActive|userId)$/i.test(String(f)));
  const normalizedFields = (editableFields.length ? editableFields : ['name', 'gender', 'age']).slice(0, 6);
  const formState = normalizedFields.map(f => `    ${JSON.stringify(f)}: '',`).join('\n');
  const formControls = normalizedFields.map((f) => {
    const label = String(f);
    return `          <label key=${JSON.stringify(f)} style={{ display: 'grid', gap: 6 }}><span style={{ fontSize: 12, color: '#475569' }}>${label}</span><input value={form.${label} || ''} onChange={(e) => setForm((s) => ({ ...s, ${JSON.stringify(label)}: e.target.value }))} style={styles.input} /></label>`;
  }).join('\n');

  return `import React, { useEffect, useMemo, useState } from 'react';

const API_BASE = window.__API_BASE__ || '/api';
const styles = {
  page: { fontFamily: 'Inter, system-ui, sans-serif', background: '#f8fafc', minHeight: '100vh', color: '#0f172a', padding: 24 },
  wrap: { maxWidth: 1080, margin: '0 auto', display: 'grid', gap: 16 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, boxShadow: '0 8px 24px rgba(15,23,42,0.06)' },
  row: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  button: { border: 'none', background: '#2563eb', color: '#fff', padding: '10px 14px', borderRadius: 10, cursor: 'pointer', fontWeight: 600 },
  buttonGhost: { border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', padding: '10px 14px', borderRadius: 10, cursor: 'pointer' },
  input: { border: '1px solid #cbd5e1', borderRadius: 10, padding: '10px 12px', fontSize: 14 },
  pre: { background: '#0f172a', color: '#e2e8f0', padding: 12, borderRadius: 12, overflow: 'auto', fontSize: 12 },
  badge: { display: 'inline-flex', alignItems: 'center', padding: '4px 8px', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', fontSize: 12, fontWeight: 700 },
};

async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + (path.startsWith('/api/') ? path.slice(4) : path), {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data && data.error) || text || ('HTTP ' + res.status));
  return data;
}

export default function App() {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [status, setStatus] = useState('Initializing...');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
${formState}
  });

  const endpoints = useMemo(() => (${JSON.stringify({ primaryGet: primaryGet?.route || null, statsGet: statsGet?.route || null, sessionGet: sessionGet?.route || null, primaryPost: primaryPost?.route || null, logoutPost: logoutPost?.route || null, allRoutes: routes.map(r => ({ method: r.method, route: r.route })) }, null, 2)}), []);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const tasks = [];
      if (endpoints.primaryGet) tasks.push(apiFetch(endpoints.primaryGet).then((data) => setItems(Array.isArray(data) ? data : (data?.items || data?.rows || data?.data || []))));
      if (endpoints.statsGet) tasks.push(apiFetch(endpoints.statsGet).then(setStats));
      if (endpoints.sessionGet) tasks.push(apiFetch(endpoints.sessionGet).then(setCurrentUser));
      await Promise.all(tasks);
      setStatus('Connected to server API');
    } catch (e) {
      setError(String(e?.message || e));
      setStatus('API request failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handlePrimarySubmit() {
    if (!endpoints.primaryPost) return;
    setLoading(true);
    setError('');
    try {
      await apiFetch(endpoints.primaryPost, { method: 'POST', body: JSON.stringify(form) });
      setStatus('Mutation succeeded');
      await refresh();
    } catch (e) {
      setError(String(e?.message || e));
      setStatus('Mutation failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    if (!endpoints.logoutPost) return;
    setLoading(true);
    setError('');
    try {
      await apiFetch(endpoints.logoutPost, { method: 'POST' });
      setStatus('Logout succeeded');
      await refresh();
    } catch (e) {
      setError(String(e?.message || e));
      setStatus('Logout failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={styles.badge}>Server-driven release fallback</div>
              <h1 style={{ margin: '10px 0 4px', fontSize: 28 }}>Published API App</h1>
              <p style={{ margin: 0, color: '#475569' }}>This UI was generated by the publish pipeline fallback so release can proceed without local-first state.</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={refresh} style={styles.buttonGhost} disabled={loading}>Refresh</button>
              {endpoints.logoutPost ? <button onClick={handleLogout} style={styles.buttonGhost} disabled={loading}>Logout</button> : null}
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: 14, color: '#334155' }}>Status: <strong>{status}</strong>{loading ? ' · Loading...' : ''}</div>
          {error ? <div style={{ marginTop: 8, color: '#b91c1c' }}>{error}</div> : null}
        </div>

        <div style={styles.row}>
          <div style={styles.card}>
            <h2 style={{ marginTop: 0 }}>Primary form</h2>
            <div style={{ display: 'grid', gap: 12 }}>
${formControls}
              {endpoints.primaryPost ? <button onClick={handlePrimarySubmit} style={styles.button} disabled={loading}>Submit</button> : <div style={{ color: '#64748b' }}>No write endpoint in manifest.</div>}
            </div>
          </div>
          <div style={styles.card}>
            <h2 style={{ marginTop: 0 }}>Current session</h2>
            <pre style={styles.pre}>{JSON.stringify(currentUser, null, 2)}</pre>
          </div>
        </div>

        <div style={styles.row}>
          <div style={styles.card}>
            <h2 style={{ marginTop: 0 }}>Stats</h2>
            <pre style={styles.pre}>{JSON.stringify(stats, null, 2)}</pre>
          </div>
          <div style={styles.card}>
            <h2 style={{ marginTop: 0 }}>Routes</h2>
            <pre style={styles.pre}>{JSON.stringify(endpoints.allRoutes, null, 2)}</pre>
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={{ marginTop: 0 }}>Records</h2>
          <pre style={styles.pre}>{JSON.stringify(items, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}
`;
}

async function fetchRuntimeHealth(runtime, options = {}) {
  if (!runtime?.running || (!runtime?.ip && !runtime?.hostPort)) return null;
  const timeoutMs = Math.max(200, Number(options.timeoutMs || 1500));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const runtimeBaseUrl = runtime.hostPort ? `http://127.0.0.1:${runtime.hostPort}` : `http://${runtime.ip}:3001`;
  try {
    const res = await fetch(`${runtimeBaseUrl}/health`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function createPublishFailure(type, phase, message, options = {}) {
  const error = new Error(message || 'publish failed');
  error.publishFailure = {
    type: type || 'PUBLISH_UNKNOWN',
    phase: phase || null,
    retryable: options.retryable == null ? false : !!options.retryable,
    blockingFailures: Array.isArray(options.blockingFailures) ? options.blockingFailures : [],
    meta: options.meta || {},
  };
  return error;
}

function inferPublishFailure(error, currentPhase = null) {
  if (error?.publishFailure) {
    return {
      type: error.publishFailure.type || 'PUBLISH_UNKNOWN',
      phase: error.publishFailure.phase || currentPhase,
      retryable: !!error.publishFailure.retryable,
      blockingFailures: error.publishFailure.blockingFailures || [],
      meta: error.publishFailure.meta || {},
    };
  }
  const message = String(error?.message || error || 'publish failed');
  const mapping = [
    [/frontend.*local-first|not API-driven/i, 'FRONTEND_LOCAL_FIRST', 'frontend_analyze', false],
    [/バックエンドを生成できませんでした|backend is still empty/i, 'BACKEND_ARTIFACT_EMPTY', 'backend_sql_generate', true],
    [/runtime health check failed after deploy/i, 'RUNTIME_HEALTH_FAILED', 'candidate_runtime', true],
    [/runtime health payload missing/i, 'RUNTIME_HEALTH_PAYLOAD_INVALID', 'candidate_runtime', true],
    [/behavior smoke|get .* probe failed/i, 'BEHAVIOR_SMOKE_FAILED', 'verifier', true],
    [/expected prod db mode/i, 'RUNTIME_DBMODE_MISMATCH', 'candidate_runtime', false],
    [/release verifier failed after repair/i, 'VERIFIER_FAILED_AFTER_REPAIR', 'verifier', false],
    [/release persistence verification failed/i, 'POST_PERSIST_VERIFY_FAILED', 'verifier', false],
    [/artifact persistence failed/i, 'ARTIFACT_PERSIST_FAILED', 'verifier', true],
    [/app not found|release app not found/i, 'RELEASE_TARGET_MISSING', currentPhase || 'backend_generation', false],
  ];
  for (const [pattern, type, phase, retryable] of mapping) {
    if (pattern.test(message)) return { type, phase, retryable, blockingFailures: [], meta: {} };
  }
  return { type: 'PUBLISH_UNKNOWN', phase: currentPhase, retryable: false, blockingFailures: [], meta: {} };
}

function createPublishPipeline(deps) {
  const {
    db,
    publishJobsInFlight,
    getEffectiveReleaseAppId,
    hydrateVersionRow,
    readLatestFrontendCodeFromFiles,
    isReusablePublishBackend,
    readVersionFiles,
    setPublishStep,
    callLlmOnce,
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
    finishPublishJobRecord,
    startPublishJobRecord,
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
    platformBaseUrl,
  } = deps;

  async function readCandidatePage(baseUrl, appId, options = {}) {
    const timeoutMs = Math.max(200, Number(options.timeoutMs || 2500));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const pageRes = await fetch(`${String(baseUrl || '').replace(/\/$/, '')}/__candidate/app/${appId}/`, {
        signal: controller.signal,
        headers: { 'x-funfo-publish-probe': '1' },
      });
      const pageText = await pageRes.text();
      return {
        ok: pageRes.ok && /<!DOCTYPE html>/i.test(pageText),
        status: pageRes.status,
        snippet: pageText.slice(0, 240),
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        snippet: '',
        error: String(error?.name === 'AbortError' ? `candidate page timeout after ${timeoutMs}ms` : (error?.message || error)),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function summarizeRuntimeProbe(readiness, runtimeLogs) {
    const parts = [];
    if (readiness?.error) parts.push(`readiness=${readiness.error}`);
    if (readiness?.status) parts.push(`health_status=${readiness.status}`);
    if (readiness?.runtime?.running === false) parts.push('container_state=stopped');
    if (readiness?.runtime?.running && !readiness?.runtime?.ip) parts.push('container_ip=missing');
    const logText = String(runtimeLogs?.text || '').trim();
    if (logText) {
      parts.push(`container_logs_tail=${logText.slice(-500)}`);
    }
    return parts.join(' | ') || 'runtime health check failed after deploy';
  }

  function pickPrimaryVerifierFailure(verification, fallbackPhase = 'verifier') {
    const typed = Array.isArray(verification?.typedBlockingFailures) ? verification.typedBlockingFailures : [];
    if (typed.length) return typed[0];
    const raw = Array.isArray(verification?.blockingFailures) ? verification.blockingFailures : [];
    if (raw.length && typeof mapVerifierCheckToFailure === 'function') {
      return mapVerifierCheckToFailure(raw[0]);
    }
    return {
      type: 'VERIFIER_FAILED',
      phase: fallbackPhase,
      retryable: false,
      strategy: 'manual-review',
      detail: verification?.summary || 'verifier failed',
      label: 'Verifier failed',
      meta: null,
    };
  }

  async function runFrontendConversion(frontendCode, releaseManifest = null, appRow = null, appMemoryContext = '', llmCall = callLlmOnce) {
    const compact = buildReleaseGenerationContext(frontendCode, { maxExcerptChars: 16000 });
    const releaseSystemPrompt = buildReleaseSystemPrompt({
      requestedMode: 'release',
      runtimeMode: appRow?.runtime_mode || 'server',
      appStatus: appRow?.status || 'private',
      appRow,
      appId: appRow?.id,
    });
    const conversionPrompt = `${RELEASE_ROLE_PROMPT}

${appMemoryContext ? `[APP_MEMORY_CONTEXT]\n${appMemoryContext}\n\n` : ''}${RELEASE_FRONTEND_CONVERSION_PROMPT}

${releaseManifest ? `Release manifest:\n${JSON.stringify(releaseManifest, null, 2)}\n\n` : ''}${compact.promptText}`;
    try {
      const converted = await llmCall([
        { role: 'system', content: releaseSystemPrompt },
        { role: 'user', content: conversionPrompt },
      ]);
      const parsedConverted = parseAIResponse(converted);
      const jsx = parsedConverted.jsx && parsedConverted.jsx.trim() ? parsedConverted.jsx.trim() : '';
      return jsx || buildDeterministicFrontendFallback(frontendCode, releaseManifest);
    } catch (_err) {
      return buildDeterministicFrontendFallback(frontendCode, releaseManifest);
    }
  }

  async function runReleaseManifest(frontendCode, mode = 'standard', appRow = null, appMemoryContext = '', llmCall = callLlmOnce) {
    const compact = buildReleaseGenerationContext(frontendCode, { maxExcerptChars: mode === 'llm_provider' ? 14000 : 10000, mode });
    const skeleton = buildReleaseManifestSkeleton(frontendCode, { mode, maxExcerptChars: mode === 'llm_provider' ? 14000 : 10000 });
    const releaseSystemPrompt = buildReleaseSystemPrompt({
      requestedMode: 'release',
      runtimeMode: appRow?.runtime_mode || 'server',
      appStatus: appRow?.status || 'private',
      appRow,
      appId: appRow?.id,
    });
    const manifestPrompt = `${RELEASE_ROLE_PROMPT}

${appMemoryContext ? `[APP_MEMORY_CONTEXT]\n${appMemoryContext}\n\n` : ''}You are preparing a release manifest before backend generation.
Return ONLY valid JSON with the shape:
{
  "entities": [{"name": string, "fields": string[]}],
  "routes": [{"method": string, "route": string, "purpose": string}],
  "tables": [{"name": string, "columns": string[]}],
  "operations": [{"name": string, "entity": string, "route": string, "method": string}],
  "releaseStrategy": string,
  "notes": string[]
}
Prefer compact, concrete output and do not include markdown.

Heuristic skeleton:
${JSON.stringify(skeleton, null, 2)}

${compact.promptText}`;
    try {
      const raw = await llmCall([
        { role: 'system', content: releaseSystemPrompt },
        { role: 'user', content: manifestPrompt },
      ]);
      const parsed = JSON.parse(String(raw || '').trim());
      return {
        ...skeleton,
        ...parsed,
        entities: Array.isArray(parsed.entities) && parsed.entities.length ? parsed.entities : skeleton.entities,
        routes: Array.isArray(parsed.routes) && parsed.routes.length ? parsed.routes : skeleton.routes,
        tables: Array.isArray(parsed.tables) && parsed.tables.length ? parsed.tables : skeleton.tables,
        operations: Array.isArray(parsed.operations) && parsed.operations.length ? parsed.operations : skeleton.operations,
      };
    } catch {
      return skeleton;
    }
  }

  async function runBackendGenerateFromManifest(frontendCode, releaseManifest, mode = 'standard', appRow = null, appMemoryContext = '', llmCall = callLlmOnce) {
    const compact = buildReleaseGenerationContext(frontendCode, { maxExcerptChars: mode === 'llm_provider' ? 14000 : 10000, mode });
    const releaseSystemPrompt = buildReleaseSystemPrompt({
      requestedMode: 'release',
      runtimeMode: appRow?.runtime_mode || 'server',
      appStatus: appRow?.status || 'private',
      appRow,
      appId: appRow?.id,
    });

    // Extract deterministic frontend contracts and build an explicit checklist for the AI
    const frontendContracts = extractFrontendApiContracts(frontendCode);
    const contractChecklist = frontendContracts.length > 0
      ? `\n\nIMPORTANT — The frontend makes these exact API calls. Every one MUST have a backend route:\n${frontendContracts.map(c => `  - ${c.method} ${c.path}`).join('\n')}\nDo NOT skip any of these routes. Cross-check your output before finishing.\n`
      : '';

    const backendPrompt = `${RELEASE_ROLE_PROMPT}

${appMemoryContext ? `[APP_MEMORY_CONTEXT]\n${appMemoryContext}\n\n` : ''}${RELEASE_BACKEND_GENERATION_PROMPT}

Generate backend/sql from this release manifest first; use the frontend excerpt only as supporting context.
Release manifest:
${JSON.stringify(releaseManifest || {}, null, 2)}
${contractChecklist}
${compact.promptText}`;
    const resp = await llmCall([
      { role: 'system', content: releaseSystemPrompt },
      { role: 'user', content: backendPrompt },
    ]);
    return parseAIResponse(resp);
  }

  async function runSystemRepair(releaseAppId, versionNumber, frontendCode, publishedServer, publishedSql) {
    if (!releaseAppId || !versionNumber) return false;
    const existing = db.prepare('SELECT id FROM app_versions WHERE app_id = ? AND version_number = ?').get(releaseAppId, versionNumber);
    if (!existing) {
      db.prepare('INSERT INTO app_versions (app_id, version_number, label, code, server_code, sql_code) VALUES (?, ?, ?, ?, ?, ?)')
        .run(releaseAppId, versionNumber, `publish v${versionNumber}`, frontendCode || '', publishedServer || '', publishedSql || '');
    } else {
      db.prepare('UPDATE app_versions SET code = ?, server_code = ?, sql_code = ? WHERE app_id = ? AND version_number = ?')
        .run(frontendCode || '', publishedServer || '', publishedSql || '', releaseAppId, versionNumber);
    }
    writeVersionFiles(releaseAppId, versionNumber, frontendCode || '', publishedServer || '', publishedSql || '');
    const versionRow = db.prepare('SELECT * FROM app_versions WHERE app_id = ? AND version_number = ?').get(releaseAppId, versionNumber)
      || {
        app_id: releaseAppId,
        version_number: versionNumber,
        code: frontendCode || '',
        server_code: publishedServer || '',
        sql_code: publishedSql || '',
      };
    const persisted = hydrateVersionRow(releaseAppId, versionRow);
    return !!(persisted?.code && persisted?.server_code);
  }

  async function runRedeploy(releaseAppId, previewSlug, frontendCode, publishedServer, publishedSql) {
    await deployAppBackend(releaseAppId, publishedServer || '', publishedSql || '', previewSlug, { dbMode: 'prod', frontendCode: frontendCode || '' });
    const readiness = typeof waitRuntimeReadyDetailed === 'function'
      ? await waitRuntimeReadyDetailed({ appId: releaseAppId }, 18, 500, { timeoutMs: 1500 })
      : { ok: await waitRuntimeReady({ appId: releaseAppId }, 18, 500), runtime: getContainerRuntime(releaseAppId), health: null, error: null };
    const runtime = readiness.runtime || getContainerRuntime(releaseAppId);
    const health = readiness.health || await fetchRuntimeHealth(runtime, { timeoutMs: 1500 });
    return {
      ok: !!health?.ok && String(health?.dbMode || '').toLowerCase() === 'prod',
      runtime,
      health,
      readiness,
      runtimeLogs: typeof getAppBackendLogs === 'function' ? getAppBackendLogs(releaseAppId, 120) : null,
    };
  }

  function shouldMarkRollbackCandidate(failure) {
    const type = String(failure?.type || '');
    return [
      'POST_PERSIST_VERIFY_FAILED',
      'ARTIFACT_CONSISTENCY_FAILED',
      'ARTIFACT_PERSIST_FAILED',
      'RUNTIME_DBMODE_MISMATCH',
      'VERIFIER_FAILED_AFTER_REPAIR',
    ].includes(type);
  }

  function shouldAutoRollback(failure) {
    const type = String(failure?.type || '');
    return [
      'POST_PERSIST_VERIFY_FAILED',
      'ARTIFACT_CONSISTENCY_FAILED',
      'ARTIFACT_PERSIST_FAILED',
    ].includes(type);
  }

  async function rollbackToLatestBackup(releaseAppId, previewSlug) {
    const backup = db.prepare(`
      SELECT * FROM app_release_backups
      WHERE release_app_id = ?
      ORDER BY backup_version_number DESC
      LIMIT 1
    `).get(releaseAppId);
    if (!backup) return { ok: false, reason: 'no_backup_snapshot' };

    writeVersionFiles(
      releaseAppId,
      Number(backup.release_version_number || 1),
      backup.code || '',
      backup.server_code || '',
      backup.sql_code || ''
    );

    db.prepare(`
      UPDATE apps
      SET name = ?, icon = ?, description = ?, color = ?, current_version = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      backup.name || '新規アプリ',
      backup.icon || '✨',
      backup.description || '',
      backup.color || null,
      Number(backup.release_version_number || 1),
      releaseAppId,
    );

    const redeploy = await runRedeploy(releaseAppId, previewSlug, backup.code || '', backup.server_code || '', backup.sql_code || '');
    if (!redeploy.ok) {
      return {
        ok: false,
        reason: 'rollback_redeploy_failed',
        backupVersionNumber: Number(backup.backup_version_number || 0),
        releaseVersionNumber: Number(backup.release_version_number || 0),
        health: redeploy.health || null,
        runtime: redeploy.runtime || null,
        verification: null,
      };
    }

    const restoredVersion = hydrateVersionRow(releaseAppId, {
      version_number: Number(backup.release_version_number || 1),
      code: backup.code || '',
      server_code: backup.server_code || '',
      sql_code: backup.sql_code || '',
    });
    const verification = await verifyAppRelease(releaseAppId, restoredVersion, { expectedDbMode: 'prod' });
    return {
      ok: !!verification.ok,
      reason: verification.ok ? null : 'rollback_verification_failed',
      backupVersionNumber: Number(backup.backup_version_number || 0),
      releaseVersionNumber: Number(backup.release_version_number || 0),
      health: redeploy.health || null,
      runtime: redeploy.runtime || null,
      verification,
    };
  }

  function ensurePublishNotCancelled(appId, currentPhase = null) {
    if (!isPublishCancelRequested || !isPublishCancelRequested(appId)) return;
    throw createPublishFailure('PUBLISH_CANCELLED', currentPhase || 'cancelled', '发布已取消', {
      retryable: false,
      meta: { cancelled: true, cancelledByOperator: true },
    });
  }

  async function processPublishJob(appId, appName, options = {}) {
    if (publishJobsInFlight.has(appId)) return;
    publishJobsInFlight.add(appId);
    const publishMode = options.mode || 'llm_provider';
    const llmCall = (messages) => callLlmOnce(messages, { modelKey: options.modelKey || null });
    let currentPhase = 'frontend_analyze';
    startPublishJobRecord(appId);
    savePublishJob(appId, { meta: { publishMode } });
    appendPublishLog(appId, 'publish_started', { appName, currentPhase, publishMode });
    try {
      const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
      if (!appRow) throw createPublishFailure('RELEASE_TARGET_MISSING', currentPhase, 'app not found', { retryable: false });

      ensurePublishNotCancelled(appId, currentPhase);
      let releaseAppId = getEffectiveReleaseAppId(appRow);
      const workspaceDraftPublish = isWorkspaceDraft(appRow);
      let runtimeAppId = workspaceDraftPublish ? appId : releaseAppId;
      appendPublishLog(appId, 'publish_context_loaded', {
        sourceAppId: appId,
        releaseAppId,
        runtimeAppId,
        workspaceDraftPublish,
        appRow: {
          id: appRow.id,
          status: appRow.status,
          publish_status: appRow.publish_status,
          app_stage: appRow.app_stage,
          runtime_mode: appRow.runtime_mode,
          app_role: appRow.app_role,
          release_app_id: appRow.release_app_id,
          current_version: appRow.current_version,
        },
      });
      let releaseTarget = db.prepare('SELECT * FROM apps WHERE id = ?').get(releaseAppId);
      if (!releaseTarget) {
        if (isWorkspaceDraft(appRow)) {
          console.warn(`publish fallback: invalid release target for draft app ${appId}, treating as first publish`);
          releaseAppId = appId;
          releaseTarget = appRow;
        } else {
          throw createPublishFailure('RELEASE_TARGET_MISSING', currentPhase, 'release app not found', { retryable: false });
        }
      }

      ensureAppMemoryFiles(appId);
      const appMemoryContext = buildAppMemoryContext(appId);
      const latestRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appId);
      const latest = hydrateVersionRow(appId, latestRaw);
      let rollbackBackupVersion = null;
      const originalFrontendCode = (latest?.code || readLatestFrontendCodeFromFiles(appId) || '').trim();
      if (!originalFrontendCode) throw createPublishFailure('FRONTEND_ARTIFACT_MISSING', currentPhase, '公開前にフロントエンドを生成してください', { retryable: false });
      setAppStage(appId, 'frontend_ready', 'frontend artifact detected; publish pipeline started', {
        publish_status: 'publishing',
      });

      let frontendCode = originalFrontendCode;
      let publishedServer = (latest?.server_code || '').trim();
      let publishedSql = (latest?.sql_code || '').trim();
      let backendReuseMeta = null;
      let releaseManifest = null;

      currentPhase = 'candidate_prepare';
      setPublishStep(appId, 'candidate_prepare', 'running', publishMode === 'llm_provider' ? '正在通过配置好的 LLM provider 生成 Candidate 所需产物（frontend / backend / sql）' : '正在生成 Candidate 所需产物（frontend / backend / sql）');
      const frontendBefore = analyzeReleaseFrontend(frontendCode);
      appendPublishLog(appId, 'frontend_analysis', {
        phase: currentPhase,
        originalFrontendBytes: Buffer.byteLength(String(originalFrontendCode || ''), 'utf8'),
        analysis: frontendBefore,
      });
      setPublishStep(appId, 'candidate_prepare', 'running', '前端分析が完了しました');

      ensurePublishNotCancelled(appId, currentPhase);
      currentPhase = 'release_manifest';
      setPublishStep(appId, 'candidate_prepare', 'running', publishMode === 'llm_provider' ? '正在通过 LLM provider 生成 release manifest' : 'release manifest を作成しています');
      releaseManifest = await runReleaseManifest(frontendCode, publishMode, appRow, appMemoryContext, llmCall);

      // Cross-validate manifest routes against deterministic frontend contract extraction
      const extractedContracts = extractFrontendApiContracts(frontendCode);
      const manifestRouteKeys = new Set(
        (releaseManifest?.routes || []).map(r => `${String(r.method || 'GET').toUpperCase()} ${r.route}`)
      );
      const missingFromManifest = extractedContracts.filter(c => {
        const key = `${c.method} ${c.path}`;
        // Check exact match and common alias (with/without :id)
        return !manifestRouteKeys.has(key)
          && !manifestRouteKeys.has(`${c.method} ${c.path}/:id`)
          && !manifestRouteKeys.has(`${c.method} ${c.path.replace(/\/:id$/, '')}`);
      });
      if (missingFromManifest.length > 0) {
        // Patch the manifest with deterministically extracted routes the AI missed
        releaseManifest.routes = [
          ...(releaseManifest.routes || []),
          ...missingFromManifest.map(c => ({
            method: c.method,
            route: c.path,
            purpose: 'auto-patched: detected in frontend code but missing from AI manifest',
          })),
        ];
        releaseManifest.notes = [
          ...(releaseManifest.notes || []),
          `${missingFromManifest.length} route(s) were auto-patched into manifest from frontend contract extraction: ${missingFromManifest.map(c => `${c.method} ${c.path}`).join(', ')}`,
        ];
      }

      appendPublishLog(appId, 'release_manifest_ready', {
        phase: currentPhase,
        publishMode,
        releaseManifest,
        manifestCrossValidation: {
          extractedContracts: extractedContracts.length,
          manifestRoutes: (releaseManifest?.routes || []).length,
          autoPatched: missingFromManifest.length,
          patchedRoutes: missingFromManifest.map(c => `${c.method} ${c.path}`),
        },
      });
      savePublishJob(appId, { meta: { releaseManifest, publishMode } });
      writeAppPlan(appId, buildReleasePlanDoc(appRow.name || appName, releaseManifest, publishMode));
      setPublishStep(appId, 'candidate_prepare', 'running', 'release manifest を作成しました');
      const looksLocalFirst = frontendBefore.localFirstSignals;
      if (looksLocalFirst) {
        currentPhase = 'frontend_analyze';
        setPublishStep(appId, 'candidate_prepare', 'running', '公開用に前端を server-driven へ変換しています');
        frontendCode = await runFrontendConversion(frontendCode, releaseManifest, appRow, appMemoryContext, llmCall);
        setPublishStep(appId, 'candidate_prepare', 'running', 'Candidate 前端已转为 server-driven，继续整理 backend / sql 产物');
      }

      let frontendAfterConversion = analyzeReleaseFrontend(frontendCode);
      if (frontendAfterConversion.localFirstSignals || !frontendAfterConversion.serverDriven) {
        frontendCode = buildDeterministicFrontendFallback(frontendCode, releaseManifest);
        frontendAfterConversion = analyzeReleaseFrontend(frontendCode);
        appendPublishLog(appId, 'frontend_conversion_fallback_applied', {
          phase: currentPhase,
          convertedFrontendBytes: Buffer.byteLength(String(frontendCode || ''), 'utf8'),
          analysis: frontendAfterConversion,
        });
      }
      appendPublishLog(appId, 'frontend_conversion_result', {
        phase: currentPhase,
        convertedFrontendBytes: Buffer.byteLength(String(frontendCode || ''), 'utf8'),
        analysis: frontendAfterConversion,
      });
      if (frontendAfterConversion.localFirstSignals || !frontendAfterConversion.serverDriven) {
        throw createPublishFailure('FRONTEND_LOCAL_FIRST', 'frontend_analyze', 'release frontend conversion failed: frontend is still local-first or not API-driven', {
          retryable: false,
          meta: frontendAfterConversion,
        });
      }

      setPublishStep(appId, 'candidate_prepare', 'running', '前回公開バックエンドを再利用できるか確認しています');
      const reuseDecision = isReusablePublishBackend(appId, releaseAppId);
      appendPublishLog(appId, 'backend_reuse_decision', {
        phase: currentPhase,
        releaseAppId,
        runtimeAppId,
        reusable: !!reuseDecision.reusable,
        reason: reuseDecision.reason || null,
        details: reuseDecision.details || null,
      });
      if (reuseDecision.reusable) {
        const releaseLatestRaw = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(releaseAppId);
        const releaseLatest = hydrateVersionRow(releaseAppId, releaseLatestRaw);
        publishedServer = (releaseLatest?.server_code || readVersionFiles(releaseAppId, releaseLatest?.version_number || 0)?.server_code || '').trim();
        publishedSql = (releaseLatest?.sql_code || readVersionFiles(releaseAppId, releaseLatest?.version_number || 0)?.sql_code || '').trim();
        backendReuseMeta = {
          reused: true,
          releaseVersion: releaseLatest?.version_number || null,
          reason: reuseDecision.reason,
        };
        if (!publishedServer) backendReuseMeta = null;
      }

      if (!backendReuseMeta?.reused) {
        ensurePublishNotCancelled(appId, currentPhase);
      currentPhase = 'backend_sql_generate';
        setAppStage(appId, 'backend_proposed', 'release pipeline is generating backend artifacts');
        setPublishStep(appId, 'candidate_prepare', 'running', publishMode === 'llm_provider' ? '正在通过 LLM provider 生成 Candidate 的 backend / sql' : '正在生成 Candidate 的 backend / sql');
        const compact = buildReleaseGenerationContext(frontendCode, { maxExcerptChars: publishMode === 'llm_provider' ? 14000 : 12000, mode: publishMode });
        appendPublishLog(appId, 'backend_generation_context', {
          phase: currentPhase,
          summary: compact.summary,
          excerptBytes: Buffer.byteLength(String(compact.excerpt || ''), 'utf8'),
          sourceBytes: Buffer.byteLength(String(frontendCode || ''), 'utf8'),
          releaseManifest,
          publishMode,
        });
        const parsed = await runBackendGenerateFromManifest(frontendCode, releaseManifest, publishMode, appRow, appMemoryContext, llmCall);
        if (parsed.server && parsed.server.trim()) publishedServer = parsed.server.trim();
        if (parsed.sql && parsed.sql.trim()) publishedSql = parsed.sql.trim();
      }

      const contract = injectMissingApiStubs(frontendCode, publishedServer || '');
      publishedServer = contract.code || publishedServer;
      if (typeof normalizeBackendSqlStrings === 'function' && publishedServer) {
        const normalizedBackend = normalizeBackendSqlStrings(publishedServer || '');
        if (normalizedBackend?.changed && normalizedBackend?.code) {
          publishedServer = normalizedBackend.code;
          appendPublishLog(appId, 'backend_sql_normalized', {
            phase: currentPhase,
            rewrites: normalizedBackend.rewrites || [],
          });
        }
      }
      appendPublishLog(appId, 'backend_artifacts_ready', {
        phase: currentPhase,
        reused: !!backendReuseMeta?.reused,
        frontendBytes: Buffer.byteLength(String(frontendCode || ''), 'utf8'),
        serverBytes: Buffer.byteLength(String(publishedServer || ''), 'utf8'),
        sqlBytes: Buffer.byteLength(String(publishedSql || ''), 'utf8'),
      });
      if (!publishedServer || !publishedServer.trim()) {
        throw createPublishFailure('BACKEND_ARTIFACT_EMPTY', 'backend_sql_generate', '公開用バックエンドを生成できませんでした', { retryable: true });
      }
      setAppStage(appId, 'backend_generated', backendReuseMeta?.reused
        ? 'reused previously published backend artifacts'
        : 'release backend artifacts generated and persisted in memory');
      if (backendReuseMeta?.reused) {
        const versionLabel = backendReuseMeta.releaseVersion ? `v${backendReuseMeta.releaseVersion}` : 'latest';
        setPublishStep(appId, 'candidate_prepare', 'completed', `Candidate 产物已准备完成：API 契约与 DB schema 无差异，复用了上一版发布后端（${versionLabel}）`);
      } else {
        setPublishStep(appId, 'candidate_prepare', 'completed', 'Candidate 产物已准备完成：frontend / backend / sql 已生成');
      }

      // Pre-deploy validation: dry-run backend SQL statements against schema
      if (typeof dryRunBackendAgainstSchema === 'function') {
        const backendDryRun = dryRunBackendAgainstSchema(publishedServer || '', publishedSql || '');
        appendPublishLog(appId, 'backend_schema_dryrun', {
          phase: 'candidate_runtime',
          ok: backendDryRun.ok,
          tested: backendDryRun.tested,
          errors: backendDryRun.errors || [],
        });
        if (!backendDryRun.ok && backendDryRun.errors.length > 0) {
          const dryRunFindings = backendDryRun.errors
            .map(e => `- SQL "${e.sql}" would fail: ${e.error}`)
            .join('\n');
          appendPublishLog(appId, 'backend_schema_dryrun_blocked', {
            phase: 'candidate_runtime',
            findings: dryRunFindings,
          });
          throw createPublishFailure('SCHEMA_DRYRUN_FAILED', 'candidate_runtime', `release dry-run blocked before deploy: ${dryRunFindings}`, {
            retryable: true,
            blockingFailures: backendDryRun.errors.map(e => ({
              checkId: 'schema_dryrun',
              label: 'Schema dry-run',
              detail: `SQL "${e.sql}" would fail: ${e.error}`,
              blocking: true,
              type: 'SCHEMA_DRYRUN_FAILED',
              phase: 'candidate_runtime',
              retryable: true,
            })),
          });
        }
      }

      ensurePublishNotCancelled(appId, currentPhase);
      currentPhase = 'candidate_runtime';
      setPublishStep(appId, 'candidate_runtime', 'running', isWorkspaceDraft(appRow) ? '正在启动并检查 Candidate 环境（包含数据库兼容性校验）' : '正在启动并检查 Candidate 环境');
      validateServerCodeSyntax(releaseAppId, publishedServer || '');
      const schemaCheck = validatePublishSchemaSafety(releaseAppId, publishedSql || '');
      rollbackBackupVersion = createReleaseBackupSnapshot(releaseAppId, workspaceDraftPublish ? appId : null);
      appendPublishLog(appId, 'db_check_completed', {
        phase: currentPhase,
        releaseAppId,
        runtimeAppId,
        rollbackBackupVersion,
        schemaSummary: schemaCheck?.summary || null,
      });
      setPublishStep(appId, 'candidate_runtime', 'running', schemaCheck.summary || 'DBチェック完了');
      setAppStage(appId, 'release_ready', schemaCheck.summary || 'schema compatibility verified; waiting for runtime verification');

      const previewSlug = ensurePreviewSlug(runtimeAppId);
      let nextVersionNumber = Number((db.prepare('SELECT MAX(version_number) as mv FROM app_versions WHERE app_id = ?').get(releaseAppId)?.mv || 0) + 1);
      currentPhase = 'docker_start';
      setPublishStep(appId, 'candidate_runtime', 'running', 'Dockerランタイムを起動しています');
      await deployAppBackend(runtimeAppId, publishedServer || '', publishedSql || '', previewSlug, { dbMode: 'prod', frontendCode: frontendCode || '' });
      const runtime = getContainerRuntime(runtimeAppId);
      setPublishStep(appId, 'candidate_runtime', 'running', 'Candidate 运行环境已启动，正在检查可访问性');

      const prodDbPath = path.join(__dirname, '..', 'apps', String(runtimeAppId), 'data_prod.sqlite');
      const schemaApply = applySchemaToDbFile(prodDbPath, publishedSql || '');
      appendPublishLog(appId, 'runtime_schema_applied', {
        phase: currentPhase,
        releaseAppId,
        runtimeAppId,
        prodDbPath,
        schemaApply,
      });

      ensurePublishNotCancelled(appId, currentPhase);
      currentPhase = 'health_check';
      setPublishStep(appId, 'candidate_runtime', 'running', '最小ヘルスチェックを待機しています');
      let runtimeReadiness = typeof waitRuntimeReadyDetailed === 'function'
        ? await waitRuntimeReadyDetailed({ appId: runtimeAppId, runtime }, 18, 500, { timeoutMs: 1500 })
        : { ok: await waitRuntimeReady({ appId: runtimeAppId, runtime }, 18, 500), runtime, health: null, error: null };
      let runtimeReady = !!runtimeReadiness.ok;
      let runtimeHealth = runtimeReadiness.health || await fetchRuntimeHealth(runtimeReadiness.runtime || runtime, { timeoutMs: 1500 });
      let runtimeLogs = typeof getAppBackendLogs === 'function' ? getAppBackendLogs(runtimeAppId, 120) : null;

      if (!runtimeReady || !runtimeHealth?.ok) {
        appendPublishLog(appId, 'runtime_probe_retry', {
          phase: currentPhase,
          releaseAppId,
          runtimeAppId,
          runtimeReadiness,
          runtimeHealth,
          runtimeLogs,
        });
        setPublishStep(appId, 'candidate_runtime', 'running', 'Candidate 环境首轮预热未通过，正在自动重启一次相同产物');
        const retry = await runRedeploy(runtimeAppId, previewSlug, frontendCode, publishedServer || '', publishedSql || '');
        runtimeReadiness = retry.readiness || runtimeReadiness;
        runtimeReady = !!(retry.readiness ? retry.readiness.ok : retry.ok);
        runtimeHealth = retry.health || runtimeHealth;
        runtimeLogs = retry.runtimeLogs || runtimeLogs;
      }

      if (!runtimeReady) {
        throw createPublishFailure('RUNTIME_HEALTH_FAILED', 'candidate_runtime', summarizeRuntimeProbe(runtimeReadiness, runtimeLogs), {
          retryable: true,
          meta: {
            runtimeReadiness,
            runtimeLogs: runtimeLogs?.text || '',
          },
        });
      }

      appendPublishLog(appId, 'runtime_health_checked', {
        phase: currentPhase,
        runtime: runtimeReadiness.runtime || runtime,
        runtimeReady,
        runtimeReadiness,
        runtimeHealth,
        runtimeLogs,
      });
      if (!runtimeHealth?.ok) {
        throw createPublishFailure('RUNTIME_HEALTH_PAYLOAD_INVALID', 'candidate_runtime', summarizeRuntimeProbe(runtimeReadiness, runtimeLogs) || 'release health verification failed: runtime health payload missing', {
          retryable: true,
          meta: {
            runtimeReadiness,
            runtimeLogs: runtimeLogs?.text || '',
          },
        });
      }
      if (String(runtimeHealth.dbMode || '').toLowerCase() !== 'prod') {
        throw createPublishFailure('RUNTIME_DBMODE_MISMATCH', 'candidate_runtime', `release runtime verification failed: expected prod db mode, got ${runtimeHealth.dbMode || 'unknown'}`, {
          retryable: false,
          meta: { dbMode: runtimeHealth.dbMode || 'unknown' },
        });
      }

      const candidatePage = await readCandidatePage(platformBaseUrl, runtimeAppId, { timeoutMs: 3000 });
      const frontendReachable = !!candidatePage.ok;
      if (!frontendReachable) {
        throw createPublishFailure('RUNTIME_FRONTEND_UNREACHABLE', 'candidate_runtime', candidatePage.error || `candidate frontend route was not reachable after deploy${candidatePage.status ? ` (status ${candidatePage.status})` : ''}`, {
          retryable: true,
          meta: {
            candidatePage,
            platformBaseUrl,
            runtimeAppId,
          },
        });
      }
      setPublishStep(appId, 'candidate_runtime', 'completed', 'Candidate 环境已确认可运行、可访问，并通过基础检查');

      ensurePublishNotCancelled(appId, currentPhase);
      currentPhase = 'verify';
      setPublishStep(appId, 'verify', 'running', '正在执行发布验证，确认 Candidate 可以安全进入 Live');
      const verificationDraft = {
        version_number: nextVersionNumber,
        code: frontendCode,
        server_code: publishedServer || '',
        sql_code: publishedSql || '',
      };
      const frontendContractsBeforeVerify = toContractKeys(extractFrontendApiContracts(frontendCode || ''));
      const backendContractsBeforeVerify = Array.from(extractBackendApiContracts(publishedServer || '') || []);
      appendPublishLog(appId, 'contract_snapshot_before_verify', {
        phase: currentPhase,
        releaseAppId,
        runtimeAppId,
        frontendContracts: frontendContractsBeforeVerify,
        backendContracts: backendContractsBeforeVerify,
      });

      const verNum = nextVersionNumber;
      if (!workspaceDraftPublish) {
        db.prepare('INSERT INTO app_versions (app_id, version_number, label, code, server_code, sql_code) VALUES (?, ?, ?, ?, ?, ?)')
          .run(releaseAppId, verNum, `publish v${verNum}`, frontendCode, publishedServer || '', publishedSql || '');
        writeVersionFiles(releaseAppId, verNum, frontendCode, publishedServer || '', publishedSql || '');
        appendPublishLog(appId, 'version_artifacts_written', {
          phase: currentPhase,
          releaseAppId,
          runtimeAppId,
          releaseVersion: verNum,
          persistedTarget: 'release',
        });
      } else {
        appendPublishLog(appId, 'workspace_candidate_verified_before_promote', {
          phase: currentPhase,
          releaseAppId,
          runtimeAppId,
          releaseVersion: verNum,
          persistedTarget: 'draft-runtime-only',
        });
      }

      let verification = await verifyAppRelease(runtimeAppId, verificationDraft, { expectedDbMode: 'prod' });
      appendPublishLog(appId, 'verifier_completed', {
        phase: currentPhase,
        releaseAppId,
        runtimeAppId,
        releaseVersion: verNum,
        ok: !!verification?.ok,
        summary: verification?.summary || null,
        primaryFailure: verification?.primaryFailure || null,
        typedBlockingFailures: verification?.typedBlockingFailures || verification?.blockingFailures || [],
      });
      if (!verification?.ok) {
        const typed = verification?.typedBlockingFailures || verification?.blockingFailures || [];
        appendAppReleaseNotes(appId, `\n## ${new Date().toISOString()} verifier failed\n- summary: ${verification?.summary || 'release verifier failed'}\n- failures:\n${typed.map(item => `  - ${item.type || item.id || item.label}: ${item.detail || ''}`).join('\n')}\n`);
        appendAppDecisions(appId, `\n## ${new Date().toISOString()} verifier finding\n- summary: ${verification?.summary || 'release verifier failed'}\n${typed.map(item => `- ${item.type || item.id || item.label}: ${item.detail || ''}`).join('\n')}\n`);
        appendAppFailures(appId, `\n## ${new Date().toISOString()} verifier failed\n- summary: ${verification?.summary || 'release verifier failed'}\n${typed.map(item => `- ${item.type || item.id || item.label}: ${item.detail || ''}`).join('\n')}\n`);
      }
      if (!verification.ok) {
        const primaryFailure = pickPrimaryVerifierFailure(verification, 'verifier');
        setAppStage(appId, 'repair_needed', verification.summary || 'release verifier requested repair');
        savePublishJob(appId, {
          current_phase: primaryFailure.phase || 'verifier',
          failure_type: primaryFailure.type || 'VERIFIER_FAILED',
          retryable: !!primaryFailure.retryable,
          meta: {
            blockingFailures: verification.typedBlockingFailures || verification.blockingFailures,
            verifierSummary: verification.summary || '',
            repairStrategy: 'manual-editing-only',
          },
        });
        throw createPublishFailure(primaryFailure.type || 'VERIFIER_FAILED', primaryFailure.phase || 'verifier', `candidate verifier failed: ${verification.blockingFailures.map(item => `${item.label} (${item.detail})`).join(' | ')}`, {
          retryable: !!primaryFailure.retryable,
          blockingFailures: verification.typedBlockingFailures || verification.blockingFailures,
          meta: { repairStrategy: 'manual-editing-only' },
        });
      }
      setAppStage(appId, 'backend_verified', verification.summary || 'release verifier passed');
      setPublishStep(appId, 'verify', 'completed', verification.summary || 'release verifier passed');

      if (workspaceDraftPublish) {
        db.prepare('INSERT INTO app_versions (app_id, version_number, label, code, server_code, sql_code) VALUES (?, ?, ?, ?, ?, ?)')
          .run(releaseAppId, verNum, `publish v${verNum}`, frontendCode, publishedServer || '', publishedSql || '');
        writeVersionFiles(releaseAppId, verNum, frontendCode, publishedServer || '', publishedSql || '');
        appendPublishLog(appId, 'workspace_promote_artifacts_written', {
          phase: currentPhase,
          releaseAppId,
          runtimeAppId,
          releaseVersion: verNum,
        });
        const livePreviewSlug = ensurePreviewSlug(releaseAppId);
        await deployAppBackend(releaseAppId, publishedServer || '', publishedSql || '', livePreviewSlug, { dbMode: 'prod', frontendCode: frontendCode || '' });
        const releaseRuntime = getContainerRuntime(releaseAppId);
        const releaseReady = typeof waitRuntimeReadyDetailed === 'function'
          ? await waitRuntimeReadyDetailed({ appId: releaseAppId, runtime: releaseRuntime }, 18, 500, { timeoutMs: 1500 })
          : { ok: await waitRuntimeReady({ appId: releaseAppId, runtime: releaseRuntime }, 18, 500) };
        if (!releaseReady?.ok) {
          throw createPublishFailure('LIVE_PROMOTE_RUNTIME_FAILED', 'verify', 'live runtime failed while promoting verified draft', { retryable: true });
        }
      }

      const candidateVersionRow = db.prepare('SELECT id FROM app_versions WHERE app_id = ? AND version_number = ?').get(releaseAppId, verNum);
      const candidateVersionId = candidateVersionRow?.id || null;
      db.prepare("UPDATE apps SET release_state='candidate', candidate_version_id=?, last_failure_reason=NULL, updated_at=datetime('now') WHERE id = ?")
        .run(candidateVersionId, releaseAppId);
      db.prepare("UPDATE apps SET release_state='candidate', candidate_version_id=?, last_failure_reason=NULL, updated_at=datetime('now') WHERE id = ?")
        .run(candidateVersionId, appId);

      const persisted = hydrateVersionRow(releaseAppId, db.prepare('SELECT * FROM app_versions WHERE app_id = ? AND version_number = ?').get(releaseAppId, verNum));
      if (!persisted?.code || !persisted?.server_code) {
        throw createPublishFailure('ARTIFACT_PERSIST_FAILED', 'verifier', 'release artifact persistence failed: version row missing frontend/backend artifacts', { retryable: true });
      }

      const finalVerification = await verifyAppRelease(releaseAppId, persisted, { expectedDbMode: 'prod' });
      appendPublishLog(appId, 'post_persist_verification', {
        phase: currentPhase,
        releaseAppId,
        runtimeAppId,
        releaseVersion: verNum,
        ok: !!finalVerification?.ok,
        summary: finalVerification?.summary || null,
        primaryFailure: finalVerification?.primaryFailure || null,
        typedBlockingFailures: finalVerification?.typedBlockingFailures || finalVerification?.blockingFailures || [],
      });
      if (!finalVerification.ok) {
        const primaryPostPersistFailure = pickPrimaryVerifierFailure(finalVerification, 'verifier');
        throw createPublishFailure(primaryPostPersistFailure.type || 'POST_PERSIST_VERIFY_FAILED', primaryPostPersistFailure.phase || 'verifier', `release persistence verification failed: ${finalVerification.blockingFailures.map(item => `${item.label} (${item.detail})`).join(' | ')}`, {
          retryable: !!primaryPostPersistFailure.retryable,
          blockingFailures: finalVerification.typedBlockingFailures || finalVerification.blockingFailures,
          meta: { repairStrategy: primaryPostPersistFailure.strategy || 'manual-review' },
        });
      }

      const liveVersionRow = db.prepare('SELECT id FROM app_versions WHERE app_id = ? AND version_number = ?').get(releaseAppId, verNum);
      const liveVersionId = liveVersionRow?.id || null;
      db.prepare("UPDATE apps SET name = ?, icon = ?, description = ?, color = ?, status='private', review_status='none', publish_status='idle', runtime_mode='server', app_role='release', release_app_id=NULL, current_version = ?, app_stage='published_live', stage_reason='release verified and moved to live runtime', release_state='live', live_version_id=?, candidate_version_id=NULL, last_failure_reason=NULL, last_promoted_at=datetime('now'), updated_at=datetime('now') WHERE id = ?")
        .run(appRow.name, appRow.icon, appRow.description || '', appRow.color || null, verNum, liveVersionId, releaseAppId);
      db.prepare("UPDATE apps SET publish_status='idle', app_stage='published_live', stage_reason='candidate verified and promoted to live runtime', release_state='live', live_version_id=?, candidate_version_id=NULL, last_failure_reason=NULL, last_promoted_at=datetime('now'), updated_at=datetime('now') WHERE id = ?").run(liveVersionId, appId);

      try {
        appendAppSpecSnapshot(releaseAppId, appRow.name || appName, verNum, frontendCode, publishedServer || '', publishedSql || '');
        writeApiAndDbDocs(releaseAppId, appRow.name || appName, verNum, frontendCode, publishedServer || '', publishedSql || '');
        writeReleaseManifest(releaseAppId, {
          appName: appRow.name || appName,
          releaseAppId,
        runtimeAppId,
          sourceAppId: appId,
          releaseVersion: verNum,
          frontendCode,
          serverCode: publishedServer || '',
          sqlCode: publishedSql || '',
          verification: finalVerification,
          runtime: getContainerRuntime(releaseAppId),
          previewSlug,
          backendReuseMeta: {
            ...(backendReuseMeta || {}),
            rollbackBackupVersion,
          },
        });
        writeReleaseReport(appId, {
          appName: appRow.name || appName,
          status: 'completed',
          releaseAppId,
        runtimeAppId,
          releaseVersion: verNum,
          summary: 'Release succeeded. Frontend is server-driven, backend is deployed in prod mode, artifacts were persisted, and final post-persist verification passed.',
        });
      } catch (e) {
        console.warn('publish docs warning:', e?.message || e);
      }

      touchAppAccess(releaseAppId);
      currentPhase = 'completion';
      setPublishStep(appId, 'completion', 'running', '正在完成发布并更新公开状态', {
        current_phase: 'completion',
        failure_type: null,
        retryable: null,
      });
      appendPublishLog(appId, 'publish_completed', {
        phase: 'completion',
        releaseAppId,
        runtimeAppId,
        releaseVersion: verNum,
        previewSlug,
      });
      appendAppReleaseNotes(appId, `\n## ${new Date().toISOString()} publish success\n- releaseAppId: ${releaseAppId}\n- version: v${verNum}\n- previewSlug: ${previewSlug || '-'}\n- publishMode: ${publishMode}\n`);
      appendAppMemory(appId, `\n- ${new Date().toISOString()}: publish succeeded for release app ${releaseAppId} at v${verNum} (mode=${publishMode}).\n`);
      writeAppPlan(appId, buildReleasePlanDoc(appRow.name || appName, {
        ...releaseManifest,
        notes: [
          ...((releaseManifest && releaseManifest.notes) || []),
          `Last successful publish: v${verNum}`,
          `Preview slug: ${previewSlug || '-'}`,
        ],
      }, publishMode));
      finishPublishJobRecord(appId, 'completed', null, {
        current_phase: 'completion',
        failure_type: null,
        retryable: null,
        meta: {
          releaseAppId,
        runtimeAppId,
          releaseVersion: verNum,
          previewSlug,
          latest_log_file: `server/logs/publish/app-${Number(appId)}.jsonl`,
        },
      });
    } catch (e) {
      const message = String(e?.message || e || '公開に失敗しました');
      const failure = inferPublishFailure(e, currentPhase);
      const releaseTargetId = getEffectiveReleaseAppId(db.prepare('SELECT * FROM apps WHERE id = ?').get(appId) || { id: appId });
      const rollbackCandidate = shouldMarkRollbackCandidate(failure);
      let rollbackResult = null;
      if (rollbackCandidate && shouldAutoRollback(failure) && releaseTargetId) {
        try {
          appendPublishLog(appId, 'rollback_started', {
            phase: failure.phase,
            failureType: failure.type,
            releaseTargetId,
          });
          rollbackResult = await rollbackToLatestBackup(releaseTargetId, ensurePreviewSlug(releaseTargetId));
          appendPublishLog(appId, 'rollback_finished', {
            phase: failure.phase,
            failureType: failure.type,
            releaseTargetId,
            rollbackResult,
          });
          if (rollbackResult?.verification) {
            savePublishJob(appId, {
              meta: {
                rollbackVerification: {
                  ok: !!rollbackResult.verification.ok,
                  summary: rollbackResult.verification.summary || '',
                  primaryFailure: rollbackResult.verification.primaryFailure || null,
                },
              },
            });
          }
        } catch (rollbackErr) {
          rollbackResult = { ok: false, reason: String(rollbackErr?.message || rollbackErr || 'rollback_failed') };
        }
      }
      const cancelled = failure.type === 'PUBLISH_CANCELLED' || !!failure.meta?.cancelled;
      appendPublishLog(appId, cancelled ? 'publish_cancelled' : 'publish_failed', {
        phase: failure.phase,
        failureType: failure.type,
        retryable: failure.retryable,
        message,
        blockingFailures: failure.blockingFailures || [],
        meta: failure.meta || {},
        rollbackCandidate,
        rollbackResult,
        error: e,
      });
      const archivedLogPath = archivePublishLogToAppDir(appId);
      appendAppReleaseNotes(appId, `\n## ${new Date().toISOString()} publish ${cancelled ? 'cancelled' : 'failed'}\n- phase: ${failure.phase || '-'}\n- type: ${failure.type || 'unknown'}\n- retryable: ${failure.retryable ? 'yes' : 'no'}\n- detail: ${String(message || 'publish failed')}\n`);
      appendAppMemory(appId, `\n- ${new Date().toISOString()}: publish ${cancelled ? 'cancelled' : 'failed'} at phase ${failure.phase || '-'}; type=${failure.type || 'unknown'}; detail=${String(message || 'publish failed')}.\n`);
      appendAppFailures(appId, `\n## ${new Date().toISOString()} publish ${cancelled ? 'cancelled' : 'failed'}\n- phase: ${failure.phase || '-'}\n- type: ${failure.type || 'unknown'}\n- retryable: ${failure.retryable ? 'yes' : 'no'}\n- detail: ${String(message || 'publish failed')}\n`);
      console.warn(cancelled ? 'publish cancelled:' : 'publish failed:', message);
      writeReleaseReport(appId, {
        appName,
        status: cancelled ? 'cancelled' : 'failed',
        releaseAppId: releaseTargetId,
        summary: cancelled
          ? `Release cancelled during publish pipeline${failure.phase ? ` @ ${failure.phase}` : ''}.`
          : `Release failed during publish pipeline (${failure.type}${failure.phase ? ` @ ${failure.phase}` : ''}).${rollbackResult ? ` rollback=${rollbackResult.ok ? 'applied' : 'failed'}` : rollbackCandidate ? ' rollback=candidate' : ''}`,
        error: message,
      });
      const failureJson = JSON.stringify({ type: failure.type, phase: failure.phase, message });
      if (cancelled) {
        db.prepare("UPDATE apps SET publish_status='idle', app_stage='frontend_ready', release_state='draft', candidate_version_id=NULL, stage_reason=NULL, updated_at=datetime('now') WHERE id = ?")
          .run(appId);
        if (releaseTargetId && releaseTargetId !== appId) {
          db.prepare("UPDATE apps SET candidate_version_id=NULL, updated_at=datetime('now') WHERE id = ?")
            .run(releaseTargetId);
        }
      } else {
        db.prepare("UPDATE apps SET publish_status='failed', app_stage='release_blocked', release_state='failed', stage_reason=?, last_failure_reason=?, last_failure_at=datetime('now'), updated_at=datetime('now') WHERE id = ?")
          .run(message, failureJson, appId);
        if (releaseTargetId && releaseTargetId !== appId) {
          db.prepare(rollbackResult?.ok
            ? "UPDATE apps SET release_state='rollback', candidate_version_id=NULL, last_failure_reason=?, last_failure_at=datetime('now'), updated_at=datetime('now') WHERE id = ?"
            : "UPDATE apps SET release_state='failed', candidate_version_id=NULL, last_failure_reason=?, last_failure_at=datetime('now'), updated_at=datetime('now') WHERE id = ?")
            .run(failureJson, releaseTargetId);
        }
      }
      finishPublishJobRecord(appId, cancelled ? 'cancelled' : 'failed', message, {
        current_phase: failure.phase,
        failure_type: failure.type,
        retryable: failure.retryable,
        meta: {
          blockingFailures: failure.blockingFailures || [],
          rollbackCandidate,
          rollbackApplied: rollbackResult ? !!rollbackResult.ok : false,
          rollbackResult,
          rollbackVerification: rollbackResult?.verification ? {
            ok: !!rollbackResult.verification.ok,
            summary: rollbackResult.verification.summary || '',
            primaryFailure: rollbackResult.verification.primaryFailure || null,
          } : null,
          archivedLogPath,
          cancel_requested: false,
          cancel_completed: cancelled,
          latest_log_file: `server/logs/publish/app-${Number(appId)}.jsonl`,
          ...failure.meta,
        },
      });
    } finally {
      publishJobsInFlight.delete(appId);
      if (clearPublishCancel) clearPublishCancel(appId);
    }
  }

  return { processPublishJob };
}

module.exports = { createPublishPipeline };
