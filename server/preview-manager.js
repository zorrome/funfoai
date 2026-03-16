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
    // Strip app-level API_BASE/window.__API_BASE__ declarations so the wrapper's
    // API_BASE (passed as __renderApp parameter) is not shadowed.
    .replace(/^\s*(?:var|let|const)\s+API_BASE\s*=\s*(?:window\.__API_BASE__\s*\|\|\s*)?['"`][^'"`]*['"`]\s*;?\s*$/gm, '// [API_BASE managed by runtime]')
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
function buildRuntimeGlobalsScript() {
  return String.raw`
(function () {
  if (!window.React) return;
  var React = window.React;
  var Recharts = window.Recharts || {};

  window.React = React;
  window.ReactDOM = window.ReactDOM;
  window.Fragment = React.Fragment;

  window.useState = React.useState;
  window.useEffect = React.useEffect;
  window.useMemo = React.useMemo;
  window.useCallback = React.useCallback;
  window.useRef = React.useRef;
  window.useReducer = React.useReducer;

  var chartGlobals = {
    BarChart: Recharts.BarChart,
    Bar: Recharts.Bar,
    LineChart: Recharts.LineChart,
    Line: Recharts.Line,
    AreaChart: Recharts.AreaChart,
    Area: Recharts.Area,
    PieChart: Recharts.PieChart,
    Pie: Recharts.Pie,
    Cell: Recharts.Cell,
    XAxis: Recharts.XAxis,
    YAxis: Recharts.YAxis,
    CartesianGrid: Recharts.CartesianGrid,
    Tooltip: Recharts.Tooltip,
    Legend: Recharts.Legend,
    ResponsiveContainer: Recharts.ResponsiveContainer,
    RadarChart: Recharts.RadarChart,
    Radar: Recharts.Radar,
    PolarGrid: Recharts.PolarGrid,
    PolarAngleAxis: Recharts.PolarAngleAxis,
    PolarRadiusAxis: Recharts.PolarRadiusAxis,
    ComposedChart: Recharts.ComposedChart,
    ScatterChart: Recharts.ScatterChart,
    Scatter: Recharts.Scatter,
    Treemap: Recharts.Treemap,
    RadialBarChart: Recharts.RadialBarChart,
    RadialBar: Recharts.RadialBar,
    FunnelChart: Recharts.FunnelChart,
    Funnel: Recharts.Funnel,
    Sankey: Recharts.Sankey,
    ReferenceArea: Recharts.ReferenceArea,
    ReferenceLine: Recharts.ReferenceLine,
    ReferenceDot: Recharts.ReferenceDot,
    Brush: Recharts.Brush,
    Label: Recharts.Label,
    LabelList: Recharts.LabelList
  };
  Object.keys(chartGlobals).forEach(function (key) {
    if (chartGlobals[key]) window[key] = chartGlobals[key];
  });

  window.asArray = window.asArray || function (v) {
    return Array.isArray(v) ? v : [];
  };
  window.classNames = window.classNames || function () {
    return Array.prototype.filter.call(arguments, Boolean).join(' ');
  };

  var iconEmojiMap = {
    Search: '🔍', Plus: '➕', Minus: '➖', X: '✕', Check: '✓',
    ChevronDown: '▾', ChevronUp: '▴', ChevronLeft: '◂', ChevronRight: '▸',
    ArrowLeft: '←', ArrowRight: '→', Calendar: '📅', Clock: '🕒', Bell: '🔔',
    Settings: '⚙️', User: '👤', Users: '👥', Home: '🏠', Menu: '☰', Filter: '🧪',
    Download: '⬇️', Upload: '⬆️', Trash2: '🗑️', Edit: '✏️', Eye: '👁️',
    EyeOff: '🙈', Copy: '📄', Share: '🔗', ExternalLink: '↗️', Star: '⭐',
    Heart: '❤️', AlertCircle: '⚠️', Info: 'ℹ️', HelpCircle: '❔',
    ShoppingCart: '🛒', CreditCard: '💳', DollarSign: '💲', TrendingUp: '📈',
    TrendingDown: '📉', BarChart3: '📊', PieChart: '🥧', FileText: '📄',
    Printer: '🖨️', QrCode: '▦', Utensils: '🍽️', Coffee: '☕', Wine: '🍷',
    Store: '🏪', Package: '📦', Phone: '📞', Mail: '✉️', MapPin: '📍',
    Navigation: '🧭', Sun: '☀️', Moon: '🌙', Loader2: '⏳', RefreshCw: '🔄',
    MoreHorizontal: '⋯', MoreVertical: '⋮', GripVertical: '⋮', LogOut: '↩️',
    Save: '💾', Send: '📨'
  };

  window.Icon = window.Icon || function Icon(props) {
    var name = props && props.name ? props.name : 'Icon';
    var size = props && props.size ? props.size : 18;
    var className = props && props.className ? props.className : '';
    var style = props && props.style ? props.style : {};
    var title = props && props.title ? props.title : name;
    var rest = Object.assign({}, props || {});
    delete rest.name;
    delete rest.size;
    delete rest.className;
    delete rest.style;
    delete rest.title;
    return React.createElement('span', Object.assign({}, rest, {
      title: title,
      className: className,
      style: Object.assign({
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        lineHeight: 1,
        fontSize: Math.max(12, Math.round(size * 0.9))
      }, style)
    }), iconEmojiMap[name] || '◻︎');
  };

  ['Search','Plus','Minus','X','Check','ChevronDown','ChevronUp','ChevronLeft','ChevronRight','ArrowLeft','ArrowRight','Calendar','Clock','Bell','Settings','User','Users','Home','Menu','Filter','Download','Upload','Trash2','Edit','Eye','EyeOff','Copy','Share','ExternalLink','Star','Heart','AlertCircle','Info','HelpCircle','ShoppingCart','CreditCard','DollarSign','TrendingUp','TrendingDown','BarChart3','PieChart','FileText','Printer','QrCode','Utensils','Coffee','Wine','Store','Package','Phone','Mail','MapPin','Navigation','Sun','Moon','Loader2','RefreshCw','MoreHorizontal','MoreVertical','GripVertical','LogOut','Save','Send'].forEach(function (name) {
    window[name + 'Icon'] = function ShortcutIcon(props) {
      return React.createElement(window.Icon, Object.assign({ name: name }, props || {}));
    };
  });

  window.Dialog = window.Dialog || function Dialog(props) {
    var open = !!(props && props.open);
    if (!open) return null;
    var onClose = props && props.onClose;
    return React.createElement('div', {
      className: 'fixed inset-0 z-50 flex items-center justify-center',
      onClick: function (e) { if (e.target === e.currentTarget && onClose) onClose(); }
    },
      React.createElement('div', { className: 'fixed inset-0 bg-black/40' }),
      React.createElement('div', { className: 'relative z-10 w-full max-w-lg mx-4 max-h-[85vh] overflow-auto rounded-xl bg-white p-6 shadow-2xl' },
        props && props.title ? React.createElement('h2', { className: 'text-lg font-semibold mb-4' }, props.title) : null,
        React.createElement('button', { className: 'absolute right-3 top-3 text-xl leading-none text-gray-400 hover:text-gray-600', onClick: onClose }, '×'),
        props && props.children
      )
    );
  };

  window.Tabs = window.Tabs || function Tabs(props) {
    var tabs = window.asArray(props && props.tabs);
    var active = props && props.active;
    var onChange = props && props.onChange;
    return React.createElement('div', { className: 'flex gap-1 border-b border-slate-200' },
      tabs.map(function (tab) {
        var isActive = tab.key === active;
        return React.createElement('button', {
          key: tab.key,
          className: 'px-4 py-2 text-sm font-medium border-b-2 transition-colors ' + (isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'),
          onClick: function () { if (onChange) onChange(tab.key); }
        }, tab.label);
      })
    );
  };

  window.Badge = window.Badge || function Badge(props) {
    var colorMap = {
      gray: 'bg-gray-100 text-gray-700', blue: 'bg-blue-100 text-blue-700', green: 'bg-green-100 text-green-700',
      red: 'bg-red-100 text-red-700', yellow: 'bg-yellow-100 text-yellow-700', purple: 'bg-purple-100 text-purple-700'
    };
    var color = props && props.color ? props.color : 'gray';
    return React.createElement('span', { className: 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' + (colorMap[color] || colorMap.gray) }, props && props.children);
  };

  window.Spinner = window.Spinner || function Spinner(props) {
    var size = props && props.size ? props.size : 20;
    var className = props && props.className ? props.className : '';
    return React.createElement('svg', { className: 'animate-spin text-blue-600 ' + className, width: size, height: size, viewBox: '0 0 24 24', fill: 'none' },
      React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: 'currentColor', strokeWidth: 3, opacity: 0.25 }),
      React.createElement('path', { d: 'M4 12a8 8 0 018-8', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' })
    );
  };

  window.EmptyState = window.EmptyState || function EmptyState(props) {
    return React.createElement('div', { className: 'flex flex-col items-center justify-center py-12 text-gray-400' },
      React.createElement('span', { className: 'mb-3 text-4xl' }, (props && props.icon) || '📭'),
      React.createElement('p', { className: 'text-sm' }, (props && props.message) || 'データがありません')
    );
  };

  window.Toggle = window.Toggle || function Toggle(props) {
    var checked = !!(props && props.checked);
    var onChange = props && props.onChange;
    return React.createElement('label', { className: 'inline-flex cursor-pointer items-center gap-2' },
      React.createElement('div', {
        className: 'relative h-5 w-10 rounded-full transition-colors ' + (checked ? 'bg-blue-600' : 'bg-gray-300'),
        onClick: function () { if (onChange) onChange(!checked); }
      }, React.createElement('div', { className: 'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ' + (checked ? 'translate-x-5' : 'translate-x-0.5') })),
      props && props.label ? React.createElement('span', { className: 'text-sm text-gray-700' }, props.label) : null
    );
  };

  window.DatePicker = window.DatePicker || function DatePicker(props) {
    return React.createElement('input', {
      type: 'date', value: (props && props.value) || '', min: props && props.min, max: props && props.max,
      onChange: function (e) { if (props && props.onChange) props.onChange(e.target.value); },
      className: 'border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ' + ((props && props.className) || '')
    });
  };

  window.TimePicker = window.TimePicker || function TimePicker(props) {
    return React.createElement('input', {
      type: 'time', value: (props && props.value) || '',
      onChange: function (e) { if (props && props.onChange) props.onChange(e.target.value); },
      className: 'border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ' + ((props && props.className) || '')
    });
  };

  window.DateRangePicker = window.DateRangePicker || function DateRangePicker(props) {
    return React.createElement('div', { className: 'inline-flex items-center gap-2' },
      React.createElement(window.DatePicker, { value: props && props.startDate, onChange: props && props.onStartChange, max: props && props.endDate }),
      React.createElement('span', { className: 'text-sm text-gray-400' }, '〜'),
      React.createElement(window.DatePicker, { value: props && props.endDate, onChange: props && props.onEndChange, min: props && props.startDate })
    );
  };
})();`;
}

function buildHtml(rawCode, apiBaseUrl = '') {
  const sanitized = sanitizeCode(rawCode);

  const appJsx = `
function __renderApp(API_BASE) {
  var React = window.React;
  var ReactDOM = window.ReactDOM;
  var Fragment = window.Fragment || (React && React.Fragment);
  var useState = window.useState || React.useState;
  var useEffect = window.useEffect || React.useEffect;
  var useMemo = window.useMemo || React.useMemo;
  var useCallback = window.useCallback || React.useCallback;
  var useRef = window.useRef || React.useRef;
  var useReducer = window.useReducer || React.useReducer;

  var BarChart = window.BarChart;
  var Bar = window.Bar;
  var LineChart = window.LineChart;
  var Line = window.Line;
  var AreaChart = window.AreaChart;
  var Area = window.Area;
  var PieChart = window.PieChart;
  var Pie = window.Pie;
  var Cell = window.Cell;
  var RadarChart = window.RadarChart;
  var Radar = window.Radar;
  var PolarGrid = window.PolarGrid;
  var PolarAngleAxis = window.PolarAngleAxis;
  var PolarRadiusAxis = window.PolarRadiusAxis;
  var ComposedChart = window.ComposedChart;
  var ScatterChart = window.ScatterChart;
  var Scatter = window.Scatter;
  var Treemap = window.Treemap;
  var RadialBarChart = window.RadialBarChart;
  var RadialBar = window.RadialBar;
  var FunnelChart = window.FunnelChart;
  var Funnel = window.Funnel;
  var Sankey = window.Sankey;
  var ReferenceArea = window.ReferenceArea;
  var ReferenceLine = window.ReferenceLine;
  var ReferenceDot = window.ReferenceDot;
  var Brush = window.Brush;
  var Label = window.Label;
  var LabelList = window.LabelList;
  var XAxis = window.XAxis;
  var YAxis = window.YAxis;
  var CartesianGrid = window.CartesianGrid;
  var Tooltip = window.Tooltip;
  var Legend = window.Legend;
  var ResponsiveContainer = window.ResponsiveContainer;

  var Icon = window.Icon;
  var Dialog = window.Dialog;
  var Tabs = window.Tabs;
  var Badge = window.Badge;
  var Spinner = window.Spinner;
  var EmptyState = window.EmptyState;
  var Toggle = window.Toggle;
  var DatePicker = window.DatePicker;
  var TimePicker = window.TimePicker;
  var DateRangePicker = window.DateRangePicker;
  var classNames = window.classNames;
  var asArray = window.asArray;

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
  <script>${buildRuntimeGlobalsScript()}<\/script>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f8fafc}
    #funfo-powered{display:none;height:28px;border-bottom:1px solid #e5e7eb;background:#fafafa;color:#52525b;font-size:12px;
      align-items:center;justify-content:center;gap:6px}
    #funfo-powered a{color:#18181b;text-decoration:none}
    #funfo-powered a:hover{text-decoration:underline;color:#000}
    #err{color:#ef4444;background:#1e1e1e;padding:16px;font-size:12px;white-space:pre-wrap;
         font-family:monospace;margin:16px;border-radius:8px;display:none}
  </style>
</head>
<body>
<div id="funfo-powered">powered by
  <span style="display:inline-flex;align-items:center;gap:4px;font-weight:600;color:#27272a;">
    <span style="width:14px;height:14px;border-radius:4px;background:#18181b;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:10px;">✦</span>
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
function postRouteChange() {
  try {
    window.parent.postMessage({
      __funfoRouteChange: true,
      path: location.pathname,
      search: location.search || '',
      hash: location.hash || '',
      href: location.href,
    }, '*');
  } catch(_) {}
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
// Intercept fetch to keep /api requests inside the current app base and capture API errors
var _fetch = window.fetch;
window.fetch = function(url, opts) {
  var nextUrl = url;
  if (typeof nextUrl === 'string' && APP_BASE) {
    if (nextUrl.startsWith('/api/')) nextUrl = APP_BASE + nextUrl;
    else if (nextUrl.startsWith('api/')) nextUrl = APP_BASE.replace(/\\/$/, '/') + nextUrl;
  }
  return _fetch.call(this, nextUrl, opts).then(function(res) {
    if (!res.ok) {
      // Clone to read body without consuming it
      res.clone().text().then(function(body) {
        reportError('APIError', res.status + ' ' + res.statusText + ' — ' + nextUrl, body.slice(0, 300));
      });
    }
    return res;
  }).catch(function(err) {
    reportError('NetworkError', 'Failed to fetch: ' + nextUrl, err.message);
    throw err;
  });
};

var API_BASE = ${JSON.stringify(apiBaseUrl)};
if (!API_BASE) {
  var _w = location.pathname.match(/^\\/w\\/(w_[a-z0-9]{12}(?:_preview)?)(?:\\/|$)/);
  if (_w) API_BASE = '/w/' + _w[1];
  if (!API_BASE) {
    var _m = location.pathname.match(/^\\/app\\/([a-z0-9]{8})(?:\\/|$)/);
    if (_m) API_BASE = '/app/' + _m[1];
  }
}
var APP_BASE = API_BASE || '';
function toAppRelativeUrl(target) {
  if (!target) return target;
  if (typeof target !== 'string') target = String(target);
  if (!APP_BASE) return target;
  if (/^(https?:|data:|blob:|mailto:|tel:|javascript:)/i.test(target)) return target;
  if (target.startsWith(APP_BASE)) return target;
  if (target.startsWith('#')) return location.pathname + target;
  if (target.startsWith('/')) return APP_BASE + target;
  return APP_BASE.replace(/\\/$/, '/') + target.replace(/^\\.\\//, '');
}
(function patchClientRouting() {
  if (!APP_BASE) return;
  var _pushState = history.pushState.bind(history);
  var _replaceState = history.replaceState.bind(history);
  history.pushState = function(state, title, url) {
    var next = typeof url === 'string' ? toAppRelativeUrl(url) : url;
    var out = _pushState(state, title, next);
    postRouteChange();
    return out;
  };
  history.replaceState = function(state, title, url) {
    var next = typeof url === 'string' ? toAppRelativeUrl(url) : url;
    var out = _replaceState(state, title, next);
    postRouteChange();
    return out;
  };
  var _open = window.open ? window.open.bind(window) : null;
  if (_open) {
    window.open = function(url, target, features) {
      return _open(typeof url === 'string' ? toAppRelativeUrl(url) : url, target, features);
    };
  }
  window.addEventListener('popstate', postRouteChange);
  window.addEventListener('hashchange', postRouteChange);
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (!el) return;
    var href = el.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    var next = toAppRelativeUrl(href);
    if (next !== href) el.setAttribute('href', next);
    setTimeout(postRouteChange, 0);
  }, true);
  setTimeout(postRouteChange, 0);
})();
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
function startPreview(appId, code, apiBaseUrl = '', slug = null, options = {}) {
  const numId = Number(appId);
  const explicitApiPort = Number(options?.apiPort);

  if (sessions.has(numId)) {
    const s = sessions.get(numId);
    s.currentCode = code;
    s.apiBaseUrl = apiBaseUrl;
    if (slug) s.slug = slug;
    const m = apiBaseUrl.match(/:(\d+)$/);
    s.apiPort = Number.isFinite(explicitApiPort) && explicitApiPort > 0 ? explicitApiPort : (m ? Number(m[1]) : null);
    return s.port;
  }

  const port = getNextPort();
  if (!port) { console.error('No preview ports left'); return null; }

  // Extract apiPort from apiBaseUrl (e.g. "http://192.168.68.117:11002" → 11002)
  const apiPortMatch = apiBaseUrl.match(/:(\d+)$/);
  const apiPort = Number.isFinite(explicitApiPort) && explicitApiPort > 0 ? explicitApiPort : (apiPortMatch ? Number(apiPortMatch[1]) : null);
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
    // Prefer explicit API base, otherwise infer from current pathname at runtime.
    const effectiveApiBase = session.apiBaseUrl || '';
    res.end(buildHtml(session.currentCode, effectiveApiBase));
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
    WHERE ifnull(a.runtime_mode, 'local') != 'server'
  `).all();

  for (const r of rows) {
    if (!r.code) continue;
    // Use serverHost (LAN IP) so preview iframes work from other devices
    const apiUrl = r.api_port ? `http://${serverHost}:${r.api_port}` : '';
    startPreview(r.app_id, r.code, apiUrl, r.preview_slug || null, { apiPort: r.api_port || null });
  }
  console.log(`🔄 Restored ${rows.length} preview(s)`);
}

module.exports = { startPreview, stopPreview, getPreviewPort, getPreviewSlug, getPreviewSessionBySlug, proxyPreviewRequest, restoreFromDb, buildHtml };
