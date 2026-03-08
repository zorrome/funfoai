const http = require('http');
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const BABEL_PRESET_REACT = require.resolve('@babel/preset-react');
const BABEL_PLUGIN_REACT_JSX = require.resolve('@babel/plugin-transform-react-jsx');

// Proxy helper: forward /api/* requests to the local app backend
function proxyToBackend(req, res, apiPort) {
  const options = {
    hostname: 'localhost',
    port: apiPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${apiPort}` },
  };
  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  });
  proxy.on('error', () => {
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'Backend unavailable' }));
  });
  req.pipe(proxy);
}

const ASSETS_DIR = path.join(__dirname, 'assets');

// Pre-load all UMD bundles into memory
const BUNDLES = {
  '/react.js':       { file: 'react.js',      mime: 'application/javascript' },
  '/react-is.js':    { file: 'react-is.js',   mime: 'application/javascript' },
  '/react-dom.js':   { file: 'react-dom.js',  mime: 'application/javascript' },
  '/prop-types.js':  { file: 'prop-types.js', mime: 'application/javascript' },
  '/recharts.js':    { file: 'recharts.js',   mime: 'application/javascript' },
};

const BUNDLE_CONTENT = {};
for (const [route, info] of Object.entries(BUNDLES)) {
  const fpath = path.join(ASSETS_DIR, info.file);
  if (fs.existsSync(fpath)) {
    BUNDLE_CONTENT[route] = fs.readFileSync(fpath);
  } else {
    console.warn(`⚠️  Missing asset: ${info.file}`);
  }
}

const PORT_START  = 10001;
const PORT_END    = 11000;
const sessions    = new Map(); // appId -> {port, server, currentCode, apiBaseUrl, apiPort, slug}
const usedPorts   = new Set();

function getNextPort() {
  for (let p = PORT_START; p <= PORT_END; p++) {
    if (!usedPorts.has(p)) return p;
  }
  return null;
}

// ── Sanitize: strip TypeScript / imports ─────────────────────────────
function sanitizeCode(code) {
  return code
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*/g, '')
    .replace(/^import\s+.*$/gm, '')
    .replace(/export\s+default\s+function\s+/g, 'function ')
    .replace(/export\s+default\s+class\s+/g, 'class ')
    .replace(/export\s+default\s+/g, '')
    .replace(/^export\s*\{[^}]*\};?\s*/gm, '')
    .trim();
}

// ── Compile JSX server-side ───────────────────────────────────────────
function compileJSX(jsxCode) {
  try {
    const result = babel.transformSync(jsxCode, {
      presets: [BABEL_PRESET_REACT],
      filename: 'App.jsx',
    });
    return result.code;
  } catch (e) {
    const msg = String(e?.message || e || '');
    // Fallback for environments where preset package is missing/broken
    if (msg.includes('@babel/preset-react') || msg.includes('Cannot find module')) {
      const fallback = babel.transformSync(jsxCode, {
        plugins: [BABEL_PLUGIN_REACT_JSX],
        filename: 'App.jsx',
      });
      return fallback.code;
    }
    throw e;
  }
}

// ── Build the preview HTML ────────────────────────────────────────────
function buildHtml(rawCode, apiBaseUrl = '') {
  const sanitized = sanitizeCode(rawCode);

  const appJsx = `
function __renderApp(API_BASE) {
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useCallback = React.useCallback;
  var useRef = React.useRef;
  var useReducer = React.useReducer;

  var BarChart = Recharts.BarChart;
  var Bar = Recharts.Bar;
  var LineChart = Recharts.LineChart;
  var Line = Recharts.Line;
  var AreaChart = Recharts.AreaChart;
  var Area = Recharts.Area;
  var PieChart = Recharts.PieChart;
  var Pie = Recharts.Pie;
  var Cell = Recharts.Cell;
  var RadarChart = Recharts.RadarChart;
  var Radar = Recharts.Radar;
  var PolarGrid = Recharts.PolarGrid;
  var PolarAngleAxis = Recharts.PolarAngleAxis;
  var ComposedChart = Recharts.ComposedChart;
  var XAxis = Recharts.XAxis;
  var YAxis = Recharts.YAxis;
  var CartesianGrid = Recharts.CartesianGrid;
  var Tooltip = Recharts.Tooltip;
  var Legend = Recharts.Legend;
  var ResponsiveContainer = Recharts.ResponsiveContainer;

  ${sanitized}

  return App;
}
`;

  let compiledJs;
  let compileError = null;
  try {
    compiledJs = compileJSX(appJsx);
    // Guard against any remaining syntax issues that would blank the page before runtime try/catch.
    // eslint-disable-next-line no-new-func
    new Function(compiledJs);
  } catch (e) {
    compileError = e.message;
  }

  if (compileError) {
    const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safe = esc(compileError);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <style>body{margin:0;background:#1e1e1e;color:#ef4444;font-family:monospace;font-size:13px;padding:20px}
    pre{white-space:pre-wrap;line-height:1.6}h3{color:#f97316;margin:0 0 12px;font-size:15px}</style></head><body>
    <h3>❌ コンパイルエラー</h3><pre id="err">${safe}</pre>
    <script>
      try {
        var txt = document.getElementById('err')?.textContent || 'Compile error';
        window.parent.postMessage({
          __funfoError: true,
          entry: { type: 'CompileError', message: txt.split('\n')[0], detail: txt, time: new Date().toISOString(), url: location.href }
        }, '*');
      } catch(_) {}
    <\/script>
    </body></html>`;
  }

  // Inline tailwind via CDN (CSS only, no JS execution issue)
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script src="./react.js"><\/script>
  <script src="./react-is.js"><\/script>
  <script src="./react-dom.js"><\/script>
  <script src="./prop-types.js"><\/script>
  <script src="./recharts.js"><\/script>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f8fafc}
    #funfo-powered{display:none;height:28px;border-bottom:1px solid #e5e7eb;background:#fff;color:#64748b;font-size:12px;
      align-items:center;justify-content:center;gap:6px}
    #funfo-powered a{color:#0f766e;text-decoration:none}
    #funfo-powered a:hover{text-decoration:underline}
    #err{color:#ef4444;background:#1e1e1e;padding:16px;font-size:12px;white-space:pre-wrap;
         font-family:monospace;margin:16px;border-radius:8px;display:none}
  </style>
</head>
<body>
<div id="funfo-powered">powered by
  <span style="display:inline-flex;align-items:center;gap:4px;font-weight:600;color:#334155;">
    <span style="width:14px;height:14px;border-radius:4px;background:#0f766e;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:10px;">✦</span>
    funfo AI
  </span>
  <a href="" target="_blank" rel="noopener noreferrer">公式サイト</a>
</div>
<div id="root"></div>
<div id="err"></div>
<script>
// ── Error reporting to parent frame ──────────────────────────────────
function reportError(type, message, detail) {
  var entry = { type: type, message: message, detail: detail || '', time: new Date().toISOString(), url: location.href };
  var fatal = ['CompileError','RenderError','RuntimeError','UnhandledRejection'].indexOf(type) >= 0;
  // Show inline error panel only for fatal errors
  var el = document.getElementById('err');
  if (fatal && el) { el.style.display = 'block'; el.textContent = '\\u274C ' + type + ': ' + message; }
  // Send to parent (VibeCoding workspace)
  try { window.parent.postMessage({ __funfoError: true, entry: entry }, '*'); } catch(_) {}
}
// Catch unhandled JS errors
window.onerror = function(msg, src, line, col, err) {
  reportError('RuntimeError', msg, err ? err.stack : ('line ' + line));
  return false;
};
// Catch unhandled promise rejections
window.addEventListener('unhandledrejection', function(e) {
  var msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
  var detail = e.reason instanceof Error ? e.reason.stack : '';
  reportError('UnhandledRejection', msg, detail);
});
// Intercept fetch to capture API errors
var _fetch = window.fetch;
window.fetch = function(url, opts) {
  return _fetch.apply(this, arguments).then(function(res) {
    if (!res.ok) {
      // Clone to read body without consuming it
      res.clone().text().then(function(body) {
        reportError('APIError', res.status + ' ' + res.statusText + ' — ' + url, body.slice(0, 300));
      });
    }
    return res;
  }).catch(function(err) {
    reportError('NetworkError', 'Failed to fetch: ' + url, err.message);
    throw err;
  });
};

var API_BASE = ${JSON.stringify(apiBaseUrl)};
if (!API_BASE) {
  var _m = location.pathname.match(/^\\/app\\/([a-z0-9]{8})(?:\\/|$)/);
  if (_m) API_BASE = '/app/' + _m[1];
}
if (window.self === window.top) {
  var bar = document.getElementById('funfo-powered');
  if (bar) bar.style.display = 'flex';
}
try {
  ${compiledJs}
  var App = __renderApp(API_BASE);
  ReactDOM.createRoot(document.getElementById('root'))
    .render(React.createElement(App));
} catch(e) {
  reportError('RenderError', e.message, e.stack || '');
}
<\/script>
</body>
</html>`;
}

// ── Start / update a preview server ──────────────────────────────────
function startPreview(appId, code, apiBaseUrl = '', slug = null) {
  const numId = Number(appId);

  if (sessions.has(numId)) {
    const s = sessions.get(numId);
    s.currentCode = code;
    s.apiBaseUrl = apiBaseUrl;
    if (slug) s.slug = slug;
    const m = apiBaseUrl.match(/:(\d+)$/);
    s.apiPort = m ? Number(m[1]) : null;
    return s.port;
  }

  const port = getNextPort();
  if (!port) { console.error('No preview ports left'); return null; }

  // Extract apiPort from apiBaseUrl (e.g. "http://192.168.68.117:11002" → 11002)
  const apiPortMatch = apiBaseUrl.match(/:(\d+)$/);
  const apiPort = apiPortMatch ? Number(apiPortMatch[1]) : null;
  const session = { port, server: null, currentCode: code, apiBaseUrl, apiPort, slug };

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' });
      return res.end();
    }

    // Proxy /api/* to the local app backend (keeps port 11001 localhost-only)
    if (url.startsWith('/api/') && session.apiPort) {
      return proxyToBackend(req, res, session.apiPort);
    }

    // Serve bundled JS assets
    if (BUNDLE_CONTENT[url]) {
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'public, max-age=3600',
      });
      return res.end(BUNDLE_CONTENT[url]);
    }

    // Main page
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    // API_BASE is empty — app uses relative /api/ paths, proxied above
    res.end(buildHtml(session.currentCode, ''));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️  Preview port ${port} in use — retrying on next port`);
      usedPorts.add(port);           // mark as taken
      sessions.delete(numId);        // remove stale entry
      startPreview(appId, code, apiBaseUrl); // retry
    } else {
      console.error(`Preview server error for app ${appId}:`, err.message);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`🖥  Preview app ${appId} → http://localhost:${port}`);
  });

  session.server = server;
  sessions.set(numId, session);
  usedPorts.add(port);
  return port;
}

function stopPreview(appId) {
  const numId = Number(appId);
  if (!sessions.has(numId)) return;
  const { server, port } = sessions.get(numId);
  server.close();
  usedPorts.delete(port);
  sessions.delete(numId);
}

function getPreviewPort(appId) {
  return sessions.get(Number(appId))?.port ?? null;
}

function getPreviewSlug(appId) {
  return sessions.get(Number(appId))?.slug ?? null;
}

function getPreviewSessionBySlug(slug) {
  if (!slug) return null;
  for (const s of sessions.values()) {
    if (s.slug === slug) return s;
  }
  return null;
}

function proxyPreviewRequest(req, res, slug) {
  const session = getPreviewSessionBySlug(slug);
  if (!session?.port) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'Preview not found' }));
  }

  const pathPart = req.originalUrl
    .replace(new RegExp(`^/app/${slug}`), '')
    .replace(new RegExp(`^/${slug}`), '') || '/';
  const options = {
    hostname: '127.0.0.1',
    port: session.port,
    path: pathPart,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${session.port}` },
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

function restoreFromDb(db, serverHost = 'localhost') {
  const rows = db.prepare(`
    SELECT av.app_id, av.code, a.api_port, a.preview_slug
    FROM app_versions av
    JOIN (SELECT app_id, MAX(version_number) as mv FROM app_versions GROUP BY app_id) l
      ON av.app_id = l.app_id AND av.version_number = l.mv
    JOIN apps a ON av.app_id = a.id
  `).all();

  for (const r of rows) {
    if (!r.code) continue;
    // Use serverHost (LAN IP) so preview iframes work from other devices
    const apiUrl = r.api_port ? `http://${serverHost}:${r.api_port}` : '';
    startPreview(r.app_id, r.code, apiUrl, r.preview_slug || null);
  }
  console.log(`🔄 Restored ${rows.length} preview(s)`);
}

module.exports = { startPreview, stopPreview, getPreviewPort, getPreviewSlug, getPreviewSessionBySlug, proxyPreviewRequest, restoreFromDb, buildHtml };
