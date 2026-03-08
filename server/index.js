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
const { startPreview, stopPreview, getPreviewPort, restoreFromDb } = require('./preview-manager');
const { deployAppBackend, stopAppBackend, getApiPort, restoreBackendsFromDb, getContainerRuntime } = require('./app-backend-manager');

const app   = express();
const PORT  = 3100;

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

const OPENCLAW_URL   = process.env.OPENCLAW_URL || 'http://127.0.0.1:18789/v1/chat/completions';
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN || '5a1192f40b1bb0cc7d2a778fff1c44a4c801ca1c242e4865';
const REQ_CARD_PREFIX = '__FUNFO_REQ__';

// Auto-fix guardrails (prevent infinite repair loops)
const autoFixInFlight = new Set(); // appId
const autoFixCooldownUntil = new Map(); // appId -> epoch ms

// ── System Prompt ─────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are "funfo AI" — a full-stack app generator for Japanese restaurant management.

When a user describes an app, generate a complete solution.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRONTEND (REQUIRED — always include)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Wrap in: \`\`\`jsx

⚠️ CRITICAL RULES:
• NO import statements
• NO TypeScript syntax (no : Type, no interface, no as Type)
• Write: function App() { ... }   (NOT "export default function")
• Use emoji instead of icons (📊 📅 👥 💰 ✅ ❌ etc.)
• All text in Japanese
• Use Tailwind CSS classes for ALL styling — no inline style={{ }} attributes
• Example: className="bg-white rounded-xl shadow p-6 border border-slate-200"
• Use API_BASE variable (injected) for backend calls: fetch(API_BASE + '/api/...')
• Avoid template literals/backticks in generated code (especially URLs); use string concatenation with + to reduce parser errors

Available globals (already injected):
  useState, useEffect, useMemo, useCallback, useRef, useReducer
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, ComposedChart

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND (include when app needs data persistence or API)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Wrap route code in: \`\`\`javascript server

Rules:
• Write only Express route handlers (app.get/post/put/delete)
• db is already defined as better-sqlite3 instance
• app and cors are already set up
• No require() statements needed
• Use db.prepare(...).all/get/run for SQLite

Example:
\`\`\`javascript server
app.get('/api/items', (req, res) => {
  const rows = db.prepare('SELECT * FROM items').all();
  res.json(rows);
});
app.post('/api/items', (req, res) => {
  const { name, price } = req.body;
  const r = db.prepare('INSERT INTO items (name, price) VALUES (?, ?)').run(name, price);
  res.json({ id: r.lastInsertRowid });
});
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE SCHEMA (include when backend is included)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Wrap in: \`\`\`sql

Rules:
• Write CREATE TABLE IF NOT EXISTS statements only
• Use INTEGER PRIMARY KEY AUTOINCREMENT for IDs
• Include sensible default values

Example:
\`\`\`sql
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGN (Tailwind CSS — all classes available via Play CDN)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Visual quality baseline: refined SaaS feel, avoid toy-like oversized UI
• Typography scale (strict): title text-2xl max, section title text-sm/ font-semibold, body text-sm, helper text-xs
• Controls density (strict): button height h-9 (primary) / h-8 (secondary), input h-9, avoid giant paddings
• Card-based layout: bg-white rounded-xl shadow-sm border border-slate-200 p-4 (default)
• Header: clean, usually white or very light surface; avoid heavy full-width color bars unless explicitly requested
• Primary button: use balanced color + subtle hover, keep visual weight moderate
• Input: border border-slate-300 rounded-lg px-3 py-2 w-full focus:ring-2 outline-none
• Table: compact and readable; th text-xs font-semibold, td text-sm, row padding py-2~2.5
• Status badges: inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium
• White/light page background: min-h-screen bg-slate-50
• Include loading states (animate-spin, animate-pulse) and empty states
• For backend apps: show actual data from API, with add/edit/delete buttons

QUALITY UPGRADE (strict)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Before coding, internally define: target users, core workflow, screens, entities, and API contract.
• Output must be feature-complete enough for real trial use (not toy demo).
• Avoid repetitive same-looking UI; reflect requested design paradigm in layout, spacing, component composition, and visual rhythm.
• Do NOT default to indigo/purple/fuchsia palette unless explicitly requested by user/pattern.
• Every frontend /api call must have backend route implementation.

After all code blocks, write 2-3 Japanese sentences explaining what was built.`;

app.use(cors());
app.use(express.json());

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

function withPreviewLink(appRow) {
  if (!appRow) return appRow;
  const slug = appRow.preview_slug || ensurePreviewSlug(appRow.id);
  return {
    ...appRow,
    preview_slug: slug,
    preview_path: slug ? `/app/${slug}/` : null,
    preview_url: slug ? `http://${SERVER_HOST}:${PORT}/app/${slug}/` : null,
  };
}

function touchAppAccess(appId) {
  if (!appId) return;
  db.prepare("UPDATE apps SET last_access_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(appId);
}

async function wakeAppRuntime(appId) {
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return { previewPort: null, apiPort: null };

  const latest = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appId);
  const previewSlug = ensurePreviewSlug(appId);

  const contract = injectMissingApiStubs(latest?.code || '', latest?.server_code || '');
  const serverToUse = contract.code;

  let runtime = getContainerRuntime(appId);
  const labelOk = !!runtime && runtime.labels?.['funfo.app_id'] === String(appId) && runtime.labels?.['funfo.slug'] === String(previewSlug);
  if ((!runtime || !runtime.running || !labelOk) && serverToUse && serverToUse.trim()) {
    await deployAppBackend(appId, serverToUse, latest?.sql_code || '', previewSlug);
    runtime = getContainerRuntime(appId);
    if (latest?.id && (!latest.server_code || !latest.server_code.trim())) {
      db.prepare('UPDATE app_versions SET server_code = ? WHERE id = ?').run(serverToUse, latest.id);
    }
  }

  const apiBaseUrl = previewSlug ? `/app/${previewSlug}` : '';
  const previewPort = startPreview(appId, latest?.code || '', apiBaseUrl, previewSlug);
  touchAppAccess(appId);
  return { previewPort, apiPort: null };
}

async function waitRuntimeReady(runtime, retries = 8, delayMs = 250) {
  if (!runtime?.running || !runtime?.ip) return false;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`http://${runtime.ip}:3001/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

function proxyToAppContainer(req, res, runtime, pathPart) {
  if (!runtime?.running || !runtime?.ip) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'App container unavailable' }));
  }

  const headers = { ...req.headers, host: `${runtime.ip}:3001` };
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
    hostname: runtime.ip,
    port: 3001,
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
  // Frontend JSX
  const jsxMatch = content.match(/```jsx\n([\s\S]*?)```/);
  // Backend server code
  const serverMatch = content.match(/```javascript server\n([\s\S]*?)```/) ||
                      content.match(/```js server\n([\s\S]*?)```/);
  // SQL schema
  const sqlMatch = content.match(/```sql\n([\s\S]*?)```/);

  return {
    jsx:    jsxMatch?.[1]?.trim()    ?? null,
    server: serverMatch?.[1]?.trim() ?? null,
    sql:    sqlMatch?.[1]?.trim()    ?? null,
  };
}

function extractFrontendApiContracts(frontendCode = '') {
  const map = new Map();
  const src = String(frontendCode || '');
  const add = (method, path) => {
    if (!path || !path.startsWith('/api/')) return;
    const clean = path.split('?')[0].split('${')[0].replace(/\/$/, '') || path;
    map.set(`${String(method).toUpperCase()} ${clean}`, { method: String(method).toUpperCase(), path: clean });
  };

  const re1 = /fetch\(\s*(?:API_BASE\s*\+\s*)?["'`]([^"'`]+)["'`]\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/g;
  let m;
  while ((m = re1.exec(src)) !== null) {
    const path = m[1] || '';
    const opts = m[2] || '';
    const mm = opts.match(/method\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/i);
    add(mm ? mm[1] : 'GET', path);
  }

  const re2 = /axios\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi;
  while ((m = re2.exec(src)) !== null) add(m[1], m[2]);

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

function injectMissingApiStubs(frontendCode = '', serverCode = '') {
  const wanted = extractFrontendApiContracts(frontendCode);
  if (!wanted.length) return { code: serverCode, missing: [] };

  const have = extractBackendApiContracts(serverCode || '');
  const missing = wanted.filter(c => !have.has(`${c.method} ${c.path}`));
  if (missing.length === 0) return { code: serverCode, missing };

  const stubs = missing.map(c => {
    const base = `\napp.${c.method.toLowerCase()}('${c.path}', (req, res) => {\n  return res.json({ ok: true, placeholder: true, route: '${c.method} ${c.path}', data: [] });\n});\n`;
    if (c.path.endsWith('/')) {
      return base + `\napp.${c.method.toLowerCase()}('${c.path}:id', (req, res) => {\n  return res.json({ ok: true, placeholder: true, route: '${c.method} ${c.path}:id', id: req.params.id, data: [] });\n});\n`;
    }
    return base;
  }).join('\n');

  return {
    code: `${serverCode || ''}\n\n// Auto-added API contract stubs to prevent runtime 404\n${stubs}`,
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

function extractDesignTokensFromPrompt(text = '') {
  const m = String(text || '').match(/- Design tokens must include:\s*(.+)/i);
  if (!m) return [];
  return String(m[1]).split('|').map(s => s.trim()).filter(Boolean);
}

function isDesignApplied(frontendCode = '', tokens = []) {
  const src = String(frontendCode || '');
  if (!tokens.length) return true;
  return tokens.every(t => src.includes(t));
}

function validateGeneratedArtifacts(frontendCode = '', serverCode = '', sqlCode = '') {
  const errors = [];

  const sqlIssues = lintSqlDialect(sqlCode);
  if (sqlIssues.length) errors.push(...sqlIssues.map(s => `SQL lint: ${s}`));

  const dry = dryRunSqlSchema(sqlCode);
  if (!dry.ok) errors.push(`SQL dry-run failed: ${dry.error}`);

  // API contract check (frontend fetches should exist in backend)
  const wanted = extractFrontendApiContracts(frontendCode);
  const have = extractBackendApiContracts(serverCode);
  const miss = wanted.filter(c => !have.has(`${c.method} ${c.path}`));
  if (miss.length) {
    errors.push(`Backend missing ${miss.length} API contract(s): ${miss.slice(0, 4).map(m => `${m.method} ${m.path}`).join(', ')}`);
  }

  return { ok: errors.length === 0, errors };
}

async function callOpenClawOnce(messages) {
  const timeoutMs = Number(process.env.OPENCLAW_TIMEOUT_MS || '140000');
  const maxAttempts = Number(process.env.OPENCLAW_MAX_RETRY || '2');

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(OPENCLAW_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENCLAW_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openclaw',
          stream: false,
          messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`OpenClaw ${response.status}: ${body.slice(0, 300)}`);
      }

      const json = await response.json();
      const content = json?.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty model response');
      return content;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e || '');
      const retryable = /aborted|timeout|timed out|fetch failed|network|5\d\d/i.test(msg);
      if (!(retryable && attempt < maxAttempts)) break;
      await new Promise(r => setTimeout(r, 800 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  const m = String(lastErr?.message || lastErr || 'OpenClaw call failed');
  if (/aborted|timeout|timed out/i.test(m)) {
    throw new Error('模型响应超时（已自动重试），请再试一次或简化一次需求');
  }
  throw new Error(m);
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

// Public preview links: http://host:3100/app/<8-char-slug>
const handleAppSlug = async (req, res, next) => {
  const slug = String(req.params.slug || '');
  if (!/^[a-z0-9]{8}$/.test(slug)) return next();
  const appRow = db.prepare('SELECT id FROM apps WHERE preview_slug = ?').get(slug);
  if (!appRow) return next();

  if (req.path === `/app/${slug}`) {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(302, `/app/${slug}/${q}`);
  }

  touchAppAccess(appRow.id);
  await wakeAppRuntime(appRow.id);

  const pathPart = req.originalUrl.replace(new RegExp(`^/app/${slug}`), '') || '/';

  const runtime = getContainerRuntime(appRow.id);
  const bound = !!runtime && runtime.labels?.['funfo.app_id'] === String(appRow.id) && runtime.labels?.['funfo.slug'] === slug;

  // /app/<slug>/api/* must be strictly bound to the app container
  if (pathPart.startsWith('/api/')) {
    if (!bound) return res.status(502).json({ error: 'Runtime binding mismatch' });
    const ready = await waitRuntimeReady(runtime);
    if (!ready) return res.status(502).json({ error: 'App backend starting, retry in 1s' });
    return proxyToAppContainer(req, res, runtime, pathPart);
  }

  const previewPort = getPreviewPort(appRow.id);
  if (!previewPort) return res.status(404).json({ error: 'Preview not running' });

  const options = {
    hostname: '127.0.0.1',
    port: previewPort,
    path: pathPart,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${previewPort}` },
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
};
app.all('/app/:slug', handleAppSlug);
app.all('/app/:slug/*rest', handleAppSlug);

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
      WHERE a.status = 'published' OR a.owner_user_id = ?
      ORDER BY a.updated_at DESC
    `).all(user.id, user.id)
    : db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM app_versions WHERE app_id = a.id) as version_count,
        0 as is_favorite
      FROM apps a
      WHERE a.status = 'published'
      ORDER BY a.updated_at DESC
    `).all();

  res.json(apps.map(a => {
    const withLink = withPreviewLink(a);
    return {
      ...withLink,
      preview_port: getPreviewPort(a.id),
      api_port:     getApiPort(a.id) ?? a.api_port,
    };
  }));
});

app.post('/api/apps', (req, res) => {
  const user = getAuthUser(req);
  const guestKey = getGuestKey(req);
  const { name = '新規アプリ', icon = '✨', description = '' } = req.body;
  const r = db.prepare('INSERT INTO apps (owner_user_id, guest_key, name, icon, description) VALUES (?, ?, ?, ?, ?)')
    .run(user?.id ?? null, user ? null : guestKey, name, icon, description);
  const row = db.prepare('SELECT * FROM apps WHERE id = ?').get(r.lastInsertRowid);
  const withLink = withPreviewLink(row);
  res.json({ ...withLink, preview_port: null, api_port: null });
});

app.get('/api/apps/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const user = getAuthUser(req);
  const guestKey = getGuestKey(req);
  if (row.status !== 'published') {
    const ownerMatch = !!(row.owner_user_id && user && row.owner_user_id === user.id);
    const guestMatch = !!(!row.owner_user_id && row.guest_key && guestKey && row.guest_key === guestKey);
    if (!ownerMatch && !guestMatch) {
      return res.status(403).json({ error: 'アクセス権限がありません' });
    }
  }
  touchAppAccess(row.id);
  const messages = db.prepare('SELECT * FROM messages WHERE app_id = ? ORDER BY created_at ASC').all(req.params.id);
  const versions = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC').all(req.params.id);
  const withLink = withPreviewLink(row);
  res.json({
    ...withLink,
    messages,
    versions,
    preview_port: getPreviewPort(row.id),
    api_port:     getApiPort(row.id) ?? row.api_port,
  });
});

app.patch('/api/apps/:id', requireAuth, (req, res) => {
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!appRow) return res.status(404).json({ error: 'Not found' });
  if (appRow.owner_user_id !== req.user.id) return res.status(403).json({ error: '編集権限がありません' });

  const { name, icon, description, status, color } = req.body;
  if (status !== undefined && !['draft', 'private', 'published'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  const fields = [], values = [];
  if (name        !== undefined) { fields.push('name = ?');        values.push(name); }
  if (icon        !== undefined) { fields.push('icon = ?');        values.push(icon); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }
  if (status      !== undefined) { fields.push('status = ?');      values.push(status); }
  if (color       !== undefined) { fields.push('color = ?');       values.push(color); }
  fields.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE apps SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  const withLink = withPreviewLink(updated);
  res.json({ ...withLink, preview_port: getPreviewPort(updated.id), api_port: getApiPort(updated.id) ?? updated.api_port });
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
  if (!appRow || appRow.status !== 'published') return res.status(404).json({ error: '公開アプリが見つかりません' });
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
  const reachable = !!runtime?.running;
  res.json({ ok: true, running, reachable, apiPort: null, runtime });
});

app.post('/api/apps/:id/backend-restart', async (req, res) => {
  const appId = Number(req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'App not found' });
  if (!canAccessApp(appRow, req)) return res.status(403).json({ error: '編集権限がありません' });

  const latest = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appId);
  if (!latest) return res.status(400).json({ error: 'No app version to restart' });

  let apiPort = null;
  const contract = injectMissingApiStubs(latest.code || '', latest.server_code || '');
  const serverToUse = contract.code;
  const previewSlug = ensurePreviewSlug(appId);
  if (serverToUse && serverToUse.trim()) {
    await deployAppBackend(appId, serverToUse, latest.sql_code || '', previewSlug);
    db.prepare('UPDATE app_versions SET server_code = ? WHERE id = ?').run(serverToUse, latest.id);
  } else {
    stopAppBackend(appId);
    db.prepare('UPDATE apps SET api_port = NULL WHERE id = ?').run(appId);
  }

  const apiBase = previewSlug ? `/app/${previewSlug}` : '';
  const previewPort = startPreview(appId, latest.code || '', apiBase, previewSlug);

  res.json({ ok: true, apiPort: null, previewPort: previewPort ?? null, previewSlug, previewPath: previewSlug ? `/app/${previewSlug}/` : null });
});

app.delete('/api/apps/:id/favorite', requireAuth, (req, res) => {
  db.prepare('DELETE FROM app_favorites WHERE app_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
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
    const previewUrl = `http://127.0.0.1:${PORT}/app/${slug}/`;
    try {
      const pr = await fetch(previewUrl);
      checks.push({ name: 'preview_page', ok: pr.ok, detail: `status=${pr.status}` });
    } catch (e) {
      checks.push({ name: 'preview_page', ok: false, detail: String(e?.message || e) });
    }

    const latest = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(appId);
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

    const required = checks.filter(c => c.name === 'runtime_wake' || c.name === 'preview_page' || c.name.startsWith('api_'));
    const passed = required.every(c => c.ok);
    const summary = passed ? 'QA passed' : 'QA failed';
    res.json({ ok: true, passed, summary, checks });
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

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const apps = db.prepare('SELECT COUNT(*) as c FROM apps').get().c;
  const pending = db.prepare("SELECT COUNT(*) as c FROM apps WHERE status = 'private'").get().c;
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
    SELECT a.id, a.name, a.icon, a.description, a.status, a.updated_at,
      u.id as owner_id, u.email as owner_email, u.nickname as owner_nickname
    FROM apps a
    LEFT JOIN users u ON a.owner_user_id = u.id
    WHERE a.status = 'private' OR a.status = 'published'
    ORDER BY a.updated_at DESC
  `).all();
  res.json(rows);
});

app.patch('/api/admin/apps/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['draft', 'private', 'published'].includes(status)) return res.status(400).json({ error: 'invalid status' });
  const row = db.prepare('SELECT id FROM apps WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'app not found' });
  db.prepare("UPDATE apps SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  res.json(appRow);
});

app.delete('/api/admin/apps/:id', requireAdmin, (req, res) => {
  const appId = Number(req.params.id);
  const row = db.prepare('SELECT id FROM apps WHERE id = ?').get(appId);
  if (!row) return res.status(404).json({ error: 'app not found' });

  stopPreview(appId);
  stopAppBackend(appId);

  db.prepare('DELETE FROM app_favorites WHERE app_id = ?').run(appId);
  db.prepare('DELETE FROM messages WHERE app_id = ?').run(appId);
  db.prepare('DELETE FROM app_versions WHERE app_id = ?').run(appId);
  db.prepare('DELETE FROM apps WHERE id = ?').run(appId);

  res.json({ ok: true });
});

app.get('/api/admin/runtimes', requireAdmin, async (_req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.name, a.icon, a.status, a.preview_slug, a.last_access_at, a.updated_at,
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
    if (backendRunning && runtime?.ip) {
      try {
        const hr = await fetch(`http://${runtime.ip}:3001/health`);
        healthOk = hr.ok;
      } catch {}
    }

    const inflight = autoFixInFlight.has(r.id);
    const cooldownUntil = autoFixCooldownUntil.get(r.id) || 0;
    const cooldownSec = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));

    out.push({
      ...r,
      preview_port: previewPort || null,
      api_port: null,
      backend_state: backendRunning ? 'running' : 'sleeping',
      preview_state: previewRunning ? 'running' : 'sleeping',
      runtime_state: backendRunning ? 'running' : 'sleeping',
      runtime_container: runtime?.containerName || null,
      health_ok: healthOk,
      autofix_inflight: inflight,
      autofix_cooldown_sec: cooldownSec,
      preview_path: r.preview_slug ? `/app/${r.preview_slug}/` : null,
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

app.post('/api/apps/plan', async (req, res) => {
  const { prompt = '' } = req.body || {};
  if (!String(prompt).trim()) return res.status(400).json({ error: 'prompt が必要です' });

  const plannerPrompt = `You are a senior product manager for AI app generation.\nReturn ONLY JSON with this schema:\n{\n  "steps": ["detailed Japanese step", ... 7-10 items],\n  "questionnaire": [\n    {"id":"layout","title":"Japanese title","options":["A","B","C"]},\n    ... 4-6 items total\n  ]\n}\nRules:\n- Japanese text only\n- Steps must be practical and specific (data model, API scope, edge cases, permission, rollout)\n- Each step should be 18-45 Japanese chars, actionable not generic\n- options must be choice-based (no free input)\n- ids use lowercase ascii\n- no markdown, no explanation`; 

  try {
    const raw = await callOpenClawOnce([
      { role: 'system', content: plannerPrompt },
      { role: 'user', content: String(prompt) },
    ]);
    let jsonText = raw.trim();
    const m = jsonText.match(/\{[\s\S]*\}/);
    if (m) jsonText = m[0];
    const data = JSON.parse(jsonText);
    const steps = Array.isArray(data?.steps) ? data.steps.map(s => String(s)).filter(Boolean).slice(0, 10) : [];
    const questionnaire = Array.isArray(data?.questionnaire)
      ? data.questionnaire
          .map(q => ({ id: String(q?.id || ''), title: String(q?.title || ''), options: Array.isArray(q?.options) ? q.options.map(o => String(o)).filter(Boolean).slice(0, 6) : [] }))
          .filter(q => q.id && q.title && q.options.length >= 2)
          .slice(0, 6)
      : [];
    res.json({ steps, questionnaire });
  } catch (e) {
    res.status(500).json({ error: `plan failed: ${e.message}` });
  }
});

app.post('/api/apps/design-brief', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  const paradigm = String(req.body?.paradigm || '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt が必要です' });

  const designPrompt = `You are a senior UI designer.
Return ONLY JSON:
{
  "concept": "short Japanese concept",
  "styleGuide": ["6-10 concrete Japanese bullets"],
  "uiChecklist": ["6-10 concrete Japanese checklist items"]
}
Rules:
- Japanese text only
- Must include explicit color strategy (primary/secondary/background/state colors)
- Must include typography hierarchy and spacing rhythm guidance
- Must include component-level guidance (card/button/table/form)
- Focus on concrete, implementable guidance for the selected paradigm
- No markdown, no explanation`;

  try {
    const raw = await callOpenClawOnce([
      { role: 'system', content: designPrompt },
      { role: 'user', content: `要件: ${prompt}\n選択范式: ${paradigm || '未指定'}` },
    ]);
    let jsonText = raw.trim();
    const m = jsonText.match(/\{[\s\S]*\}/);
    if (m) jsonText = m[0];
    const d = JSON.parse(jsonText);
    res.json({
      concept: String(d?.concept || ''),
      styleGuide: Array.isArray(d?.styleGuide) ? d.styleGuide.map(x => String(x)).filter(Boolean).slice(0, 10) : [],
      uiChecklist: Array.isArray(d?.uiChecklist) ? d.uiChecklist.map(x => String(x)).filter(Boolean).slice(0, 10) : [],
    });
  } catch (e) {
    res.status(500).json({ error: `design brief failed: ${e.message}` });
  }
});

app.post('/api/apps/:id/clone', requireAuth, async (req, res) => {
  const source = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!source || source.status !== 'published') return res.status(404).json({ error: '公開アプリが見つかりません' });

  const r = db.prepare(
    "INSERT INTO apps (owner_user_id, name, icon, description, status, current_version, color) VALUES (?, ?, ?, ?, 'draft', 1, ?)"
  ).run(req.user.id, `${source.name}（コピー）`, source.icon, source.description || '', source.color || null);

  const newAppId = r.lastInsertRowid;
  const versions = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number ASC').all(source.id);
  for (const v of versions) {
    db.prepare(
      'INSERT INTO app_versions (app_id, version_number, label, code, server_code, sql_code) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(newAppId, v.version_number, v.label, v.code, v.server_code, v.sql_code);
  }
  const lastVersion = db.prepare('SELECT MAX(version_number) as mv FROM app_versions WHERE app_id = ?').get(newAppId).mv || 1;
  db.prepare("UPDATE apps SET current_version = ?, updated_at = datetime('now') WHERE id = ?").run(lastVersion, newAppId);

  // Start sandbox preview immediately for cloned app (so user can see before editing)
  const latest = db.prepare('SELECT * FROM app_versions WHERE app_id = ? ORDER BY version_number DESC LIMIT 1').get(newAppId);
  let apiPort = null;
  if (latest?.server_code) {
    apiPort = await deployAppBackend(newAppId, latest.server_code, latest.sql_code || '', ensurePreviewSlug(newAppId));
    if (apiPort) db.prepare('UPDATE apps SET api_port = ? WHERE id = ?').run(apiPort, newAppId);
  }
  const previewSlug = ensurePreviewSlug(newAppId);
  const apiBaseUrl = previewSlug ? `/app/${previewSlug}` : '';
  if (latest?.code) startPreview(newAppId, latest.code, apiBaseUrl, previewSlug);

  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(newAppId);
  const withLink = withPreviewLink(appRow);
  res.json({ ...withLink, preview_port: getPreviewPort(newAppId), api_port: getApiPort(newAppId) ?? appRow.api_port });
});

// ── Chat SSE ──────────────────────────────────────────────────────────

app.post('/api/apps/:id/chat', async (req, res) => {
  const { message, displayMessage } = req.body;
  const appId = Number(req.params.id);

  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId);
  if (!appRow) return res.status(404).json({ error: 'App not found' });
  const user = getAuthUser(req);
  const guestKey = getGuestKey(req);
  const ownerMatch = !!(appRow.owner_user_id && user && appRow.owner_user_id === user.id);
  const guestMatch = !!(!appRow.owner_user_id && appRow.guest_key && guestKey && appRow.guest_key === guestKey);
  if (!ownerMatch && !guestMatch) {
    return res.status(403).json({ error: '編集権限がありません' });
  }

  const userDisplay = typeof displayMessage === 'string' && displayMessage.trim() ? displayMessage : message;
  db.prepare('INSERT INTO messages (app_id, role, content) VALUES (?, ?, ?)').run(appId, 'user', userDisplay);
  const history = db.prepare('SELECT role, content FROM messages WHERE app_id = ? ORDER BY created_at ASC').all(appId)
    .map(m => ({ ...m, content: normalizeMessageForModel(m.content) }));

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const response = await fetch(OPENCLAW_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENCLAW_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openclaw',
        stream: true,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
      }),
    });

    if (!response.ok) {
      send({ type: 'error', message: `OpenClaw ${response.status}` });
      return res.end();
    }

    let full = '';
    const reader = response.body.getReader();
    const dec    = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const delta = JSON.parse(raw).choices?.[0]?.delta?.content || '';
          if (delta) { full += delta; send({ type: 'delta', content: delta }); }
        } catch {}
      }
    }

    // Save assistant message
    db.prepare('INSERT INTO messages (app_id, role, content) VALUES (?, ?, ?)').run(appId, 'assistant', full);

    // Parse frontend / backend / SQL from response
    const { jsx, server, sql } = parseAIResponse(full);

    if (!jsx) {
      send({ type: 'done' });
      return res.end();
    }

    const preflight = lintAndRepairJsx(jsx);
    let safeJsx = preflight.code;

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
      const restyled = await callOpenClawOnce([
        { role: 'system', content: SYSTEM_PROMPT },
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

    // ── Save app version (frontend + backend code together) ────────────
    const verNum = (db.prepare('SELECT COUNT(*) as c FROM app_versions WHERE app_id = ?').get(appId).c) + 1;
    const vr = db.prepare(
      'INSERT INTO app_versions (app_id, version_number, code, server_code, sql_code) VALUES (?, ?, ?, ?, ?)'
    ).run(appId, verNum, safeJsx, server ?? null, sql ?? null);
    db.prepare("UPDATE apps SET current_version = ?, updated_at = datetime('now') WHERE id = ?").run(verNum, appId);

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

    {
      const contract = injectMissingApiStubs(safeJsx, serverToUse || '');
      if (contract.missing.length > 0) {
        console.log(`  🧩 Auto-filled ${contract.missing.length} missing API route(s) for app ${appId}`);
        serverToUse = contract.code;
      }

      const validation = validateGeneratedArtifacts(safeJsx, serverToUse || '', sqlToUse || '');
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
    }

    if (serverToUse) {
      db.prepare('UPDATE app_versions SET server_code = ?, sql_code = ? WHERE id = ?')
        .run(serverToUse, sqlToUse ?? null, vr.lastInsertRowid);
    }

    // ── Start preview server ──────────────────────────────────────────
    // Use SERVER_HOST (auto-detected LAN IP) so preview iframes work
    // from any device on the LAN, not just localhost
    const previewSlug = ensurePreviewSlug(appId);
    const apiBaseUrl = previewSlug ? `/app/${previewSlug}` : '';
    const previewPort = startPreview(appId, safeJsx, apiBaseUrl, previewSlug);

    send({
      type: 'code',
      code: safeJsx,
      versionId: vr.lastInsertRowid,
      versionNumber: verNum,
      previewPort,
      previewSlug,
      previewPath: previewSlug ? `/app/${previewSlug}/` : null,
      apiPort,
      hasBackend: !!server,
      hasDb: !!sql,
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
    const guestKey = getGuestKey(req);
    const ownerMatch = !!(appRow.owner_user_id && user && appRow.owner_user_id === user.id);
    const guestMatch = !!(!appRow.owner_user_id && appRow.guest_key && guestKey && appRow.guest_key === guestKey);
    if (!ownerMatch && !guestMatch) {
      return res.status(403).json({ error: '編集権限がありません' });
    }

    const latest = db.prepare(`
      SELECT * FROM app_versions
      WHERE app_id = ?
      ORDER BY version_number DESC
      LIMIT 1
    `).get(appId);
    if (!latest?.code) return res.status(400).json({ error: 'No previous code to fix' });

    const looksLikeInfraError =
      ['NetworkError', 'APIError'].includes(errorType) ||
      /\b502\b|bad gateway|ECONNREFUSED|fetch failed|network/i.test(`${error}\n${detail}`);

    // Diagnose/recover infra first for common 502-class errors before asking AI to rewrite code.
    if (looksLikeInfraError) {
      const recoveredContract = injectMissingApiStubs(latest.code || '', latest.server_code || '');
      const recoveredServer = recoveredContract.code;
      let recoveredApiPort = null;
      if (recoveredServer && recoveredServer.trim()) {
        recoveredApiPort = await deployAppBackend(appId, recoveredServer, latest.sql_code || '', ensurePreviewSlug(appId));
        if (recoveredApiPort) {
          db.prepare('UPDATE apps SET api_port = ? WHERE id = ?').run(recoveredApiPort, appId);
        }
        db.prepare('UPDATE app_versions SET server_code = ? WHERE id = ?').run(recoveredServer, latest.id);
      }
      const recoveredApiBase = recoveredApiPort ? `http://${SERVER_HOST}:${recoveredApiPort}` : '';
      const previewSlug = ensurePreviewSlug(appId);
      const recoveredPreviewPort = startPreview(appId, latest.code, recoveredApiBase, previewSlug);

      db.prepare('INSERT INTO messages (app_id, role, content) VALUES (?, ?, ?)')
        .run(appId, 'assistant', `🩺 まずインフラを復旧しました（backend/preview 再起動）: ${errorType}`);

      return res.json({
        ok: true,
        recovered: true,
        message: 'infra recovered (backend/preview restarted)',
        versionId: latest.id,
        versionNumber: latest.version_number,
        previewPort: recoveredPreviewPort,
        previewSlug: previewSlug,
        previewPath: previewSlug ? `/app/${previewSlug}/` : null,
        apiPort: recoveredApiPort,
        hasBackend: true,
        hasDb: !!(latest.sql_code || '').trim(),
        code: latest.code,
      });
    }

    const fixPrompt = `You are funfo AI's auto-fixer. Repair the app based on runtime error logs.

Rules:
- Return complete frontend in \`\`\`jsx block (required)
- If backend changes are needed, include \`\`\`javascript server block
- If DB changes are needed, include \`\`\`sql block
- No import statements
- No TypeScript syntax
- All UI text in Japanese
- Use Tailwind className styling
- Ensure all fetch endpoints used in frontend exist in backend routes

Error Context:
- type: ${errorType}
- message: ${error}
- detail: ${detail}
- url: ${url}
- retries: ${retries}

Current frontend code:
\`\`\`jsx
${latest.code}
\`\`\`

Current backend code:
\`\`\`javascript
${latest.server_code || ''}
\`\`\`

Current SQL:
\`\`\`sql
${latest.sql_code || ''}
\`\`\`
`;

    const full = await callOpenClawOnce([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: fixPrompt },
    ]);

    const { jsx, server, sql } = parseAIResponse(full);
    if (!jsx) return res.status(422).json({ error: 'Model returned no jsx block' });

    const preflight = lintAndRepairJsx(jsx);
    const safeJsx = preflight.code;

    const nextVersion = (latest.version_number || 0) + 1;
    const ins = db.prepare(
      'INSERT INTO app_versions (app_id, version_number, label, code, server_code, sql_code) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(appId, nextVersion, `auto-fix v${nextVersion}`, safeJsx, server ?? latest.server_code ?? null, sql ?? latest.sql_code ?? null);

    db.prepare("UPDATE apps SET current_version = ?, updated_at = datetime('now') WHERE id = ?")
      .run(nextVersion, appId);

    let serverToUse = server ?? latest.server_code ?? null;
    const sqlToUse = sql ?? latest.sql_code ?? '';

    {
      const contract = injectMissingApiStubs(safeJsx, serverToUse || '');
      if (contract.missing.length > 0) {
        console.log(`  🧩 Auto-filled ${contract.missing.length} missing API route(s) in auto-fix for app ${appId}`);
        serverToUse = contract.code;
      }
    }

    const validation = validateGeneratedArtifacts(safeJsx, serverToUse || '', sqlToUse || '');
    if (!validation.ok) {
      return res.status(422).json({ error: `auto-fix validation failed: ${validation.errors.join(' | ')}` });
    }

    let apiPort = getApiPort(appId) ?? appRow.api_port ?? null;
    if (serverToUse) {
      apiPort = await deployAppBackend(appId, serverToUse, sqlToUse || '', ensurePreviewSlug(appId));
      if (apiPort) db.prepare('UPDATE apps SET api_port = ? WHERE id = ?').run(apiPort, appId);
    }

    db.prepare('UPDATE app_versions SET server_code = ?, sql_code = ? WHERE id = ?')
      .run(serverToUse ?? null, sqlToUse ?? null, ins.lastInsertRowid);

    const previewSlug = ensurePreviewSlug(appId);
    const apiBaseUrl = previewSlug ? `/app/${previewSlug}` : '';
    const previewPort = startPreview(appId, safeJsx, apiBaseUrl, previewSlug);

    db.prepare('INSERT INTO messages (app_id, role, content) VALUES (?, ?, ?)')
      .run(appId, 'assistant', `🔧 自動修正を実行しました（${errorType}: ${error.slice(0, 120)}）`);

    res.json({
      ok: true,
      versionId: ins.lastInsertRowid,
      versionNumber: nextVersion,
      previewPort,
      previewSlug,
      previewPath: previewSlug ? `/app/${previewSlug}/` : null,
      apiPort,
      hasBackend: !!serverToUse,
      hasDb: !!sqlToUse,
      message: 'auto-fix applied',
      code: safeJsx,
      assistant: full,
    });
  } catch (err) {
    console.error('auto-fix error:', err);
    const appId = Number(req.params.id);
    const msg = String(err?.message || err || 'auto-fix failed');
    // timeout/abort/network class errors -> cooldown to prevent loop storms
    if (/aborted|timeout|timed out|fetch failed|network|OpenClaw 5\d\d/i.test(msg)) {
      autoFixCooldownUntil.set(appId, Date.now() + 90 * 1000);
    }
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
