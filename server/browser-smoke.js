const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const DEFAULT_BROWSER_PATHS = [
  process.env.FUNFO_BROWSER_BIN,
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildCheck(id, label, ok, detail, blocking = true, meta = null) {
  return { id, label, ok: !!ok, blocking: !!blocking, detail: detail || '', meta };
}

function resolveBrowserExecutable() {
  for (const candidate of DEFAULT_BROWSER_PATHS) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return null;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = Number(address && address.port);
      server.close((closeErr) => {
        if (closeErr) reject(closeErr);
        else resolve(port);
      });
    });
  });
}

async function waitForJson(url, timeoutMs = 8000) {
  const started = Date.now();
  let lastError = null;
  while ((Date.now() - started) < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(120);
  }
  throw lastError || new Error(`timeout waiting for ${url}`);
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const cleanup = () => {
        ws.onopen = null;
        ws.onerror = null;
      };
      ws.onopen = () => {
        cleanup();
        resolve();
      };
      ws.onerror = (event) => {
        cleanup();
        reject(new Error(event?.message || 'cdp websocket open failed'));
      };
      ws.onmessage = (event) => {
        this.#handleMessage(event.data);
      };
      ws.onclose = () => {
        const pending = Array.from(this.pending.values());
        this.pending.clear();
        for (const item of pending) item.reject(new Error('cdp websocket closed'));
      };
    });
  }

  #handleMessage(raw) {
    let payload = null;
    try {
      payload = JSON.parse(String(raw || ''));
    } catch {
      return;
    }
    if (payload && payload.id && this.pending.has(payload.id)) {
      const pending = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      if (payload.error) {
        pending.reject(new Error(payload.error.message || 'cdp command failed'));
      } else {
        pending.resolve(payload.result || {});
      }
      return;
    }
    if (payload && payload.method) {
      const listeners = this.handlers.get(payload.method) || [];
      for (const handler of listeners) {
        try { handler(payload.params || {}); } catch {}
      }
    }
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('cdp websocket is not open'));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() {
    if (!this.ws) return;
    if (this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.close(); } catch {}
    }
    this.ws = null;
    this.pending.clear();
    this.handlers.clear();
  }
}

function truncate(text, limit = 240) {
  const str = String(text || '').replace(/\s+/g, ' ').trim();
  if (str.length <= limit) return str;
  return str.slice(0, Math.max(0, limit - 3)) + '...';
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label || 'operation'} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function normalizeNetworkIssue(issue = {}) {
  const copy = {
    type: issue.type || 'unknown',
    url: issue.url || '',
    status: Number.isFinite(issue.status) ? Number(issue.status) : null,
    statusText: issue.statusText || '',
    method: issue.method || '',
    resourceType: issue.resourceType || '',
    errorText: issue.errorText || '',
    phase: issue.phase || 'load',
  };
  return copy;
}

function isIgnorableBrowserUrl(url = '') {
  const value = String(url || '');
  return /\/favicon\.ico(?:\?|$)/i.test(value);
}

function isProbablyBlockingNetworkIssue(baseUrl, issue) {
  if (!issue?.url) return false;
  if (isIgnorableBrowserUrl(issue.url)) return false;
  let issueUrl = null;
  let base = null;
  try {
    issueUrl = new URL(issue.url, baseUrl);
    base = new URL(baseUrl);
  } catch {
    return false;
  }
  const sameOrigin = issueUrl.origin === base.origin;
  const pathname = issueUrl.pathname || '/';
  const isApi = pathname.startsWith('/api/');
  const status = Number.isFinite(issue.status) ? issue.status : null;
  if (issue.type === 'loadingFailed') return sameOrigin || isApi;
  if (status == null) return sameOrigin || isApi;
  if (status >= 500) return sameOrigin || isApi;
  if ((status === 404 || status === 0) && (sameOrigin || isApi)) return true;
  if (issue.phase === 'interaction' && status >= 400 && status < 500) return false;
  return false;
}

function countBlockingConsoleEntries(entries = []) {
  return entries.filter(item => item && item.level === 'error').length;
}

async function runBrowserSmoke(url, options = {}) {
  const browserPath = resolveBrowserExecutable();
  if (!browserPath) {
    return {
      ok: false,
      summary: 'browser smoke unavailable: no Chrome/Chromium executable found',
      checks: [
        buildCheck(
          'browser_smoke_runtime',
          'Browser smoke runtime available',
          false,
          'No Chrome/Chromium executable found for browser smoke verification',
          true
        ),
      ],
      blockingFailures: [
        buildCheck(
          'browser_smoke_runtime',
          'Browser smoke runtime available',
          false,
          'No Chrome/Chromium executable found for browser smoke verification',
          true
        ),
      ],
      evidence: {},
    };
  }

  const debugPort = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'funfo-browser-smoke-'));
  const budgetMs = Math.max(3000, Number(options.budgetMs) || 9000);
  const settleMs = Math.max(400, Number(options.settleMs) || 900);
  const actionDelayMs = Math.max(300, Number(options.actionDelayMs) || 700);
  const chromeArgs = [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ];

  const chrome = spawn(browserPath, chromeArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr = [];
  const stdout = [];
  chrome.stderr.on('data', chunk => stderr.push(String(chunk || '')));
  chrome.stdout.on('data', chunk => stdout.push(String(chunk || '')));

  let session = null;
  try {
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`, Math.min(budgetMs, 8000));
    const page = Array.isArray(targets)
      ? targets.find(item => item?.type === 'page' && item?.webSocketDebuggerUrl)
      : null;
    if (!page?.webSocketDebuggerUrl) {
      throw new Error('browser smoke could not acquire a page target');
    }

    session = new CdpSession(page.webSocketDebuggerUrl);
    await session.connect();

    const consoleEntries = [];
    const logEntries = [];
    const exceptions = [];
    const networkIssues = [];
    const dialogs = [];
    const requestMap = new Map();

    session.on('Runtime.consoleAPICalled', (params) => {
      const level = String(params?.type || '').toLowerCase();
      const args = Array.isArray(params?.args) ? params.args : [];
      const text = args.map(item => item?.value ?? item?.description ?? '').filter(Boolean).join(' ');
      consoleEntries.push({
        level,
        text: truncate(text, 400),
        url: params?.stackTrace?.callFrames?.[0]?.url || '',
      });
    });

    session.on('Runtime.exceptionThrown', (params) => {
      const details = params?.exceptionDetails || {};
      const text = details?.exception?.description || details?.text || 'Runtime exception';
      exceptions.push({
        text: truncate(text, 600),
        url: details?.url || details?.stackTrace?.callFrames?.[0]?.url || '',
        lineNumber: details?.lineNumber ?? null,
        columnNumber: details?.columnNumber ?? null,
      });
    });

    session.on('Log.entryAdded', (params) => {
      const entry = params?.entry || {};
      logEntries.push({
        level: String(entry.level || '').toLowerCase(),
        text: truncate(entry.text, 400),
        url: entry.url || '',
        source: entry.source || '',
      });
    });

    session.on('Network.requestWillBeSent', (params) => {
      requestMap.set(params.requestId, {
        url: params?.request?.url || '',
        method: params?.request?.method || '',
        resourceType: params?.type || '',
      });
    });

    session.on('Network.responseReceived', (params) => {
      const response = params?.response || {};
      const req = requestMap.get(params.requestId) || {};
      if (Number(response.status || 0) >= 400) {
        networkIssues.push(normalizeNetworkIssue({
          type: 'response',
          url: response.url || req.url || '',
          status: response.status,
          statusText: response.statusText || '',
          method: req.method || '',
          resourceType: params?.type || req.resourceType || '',
        }));
      }
    });

    session.on('Network.loadingFailed', (params) => {
      if (params?.canceled) return;
      const req = requestMap.get(params.requestId) || {};
      networkIssues.push(normalizeNetworkIssue({
        type: 'loadingFailed',
        url: req.url || '',
        method: req.method || '',
        resourceType: params?.type || req.resourceType || '',
        errorText: params?.errorText || 'network failure',
      }));
    });
    session.on('Page.javascriptDialogOpening', (params) => {
      dialogs.push({
        type: params?.type || 'dialog',
        message: truncate(params?.message || '', 240),
      });
      session.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    });

    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Network.enable');
    await session.send('Log.enable');
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__FUNFO_BROWSER_SMOKE__ = { errors: [], rejections: [] };
        window.addEventListener('error', function (event) {
          try {
            window.__FUNFO_BROWSER_SMOKE__.errors.push({
              message: String(event && event.message || ''),
              filename: String(event && event.filename || ''),
              lineno: Number(event && event.lineno || 0),
              colno: Number(event && event.colno || 0)
            });
          } catch (_) {}
        });
        window.addEventListener('unhandledrejection', function (event) {
          try {
            var reason = event && event.reason;
            window.__FUNFO_BROWSER_SMOKE__.rejections.push({
              message: reason instanceof Error ? reason.message : String(reason || ''),
              detail: reason instanceof Error ? String(reason.stack || '') : ''
            });
          } catch (_) {}
        });
      `,
    });

    let loadFired = false;
    session.on('Page.loadEventFired', () => {
      loadFired = true;
    });

    await withTimeout(session.send('Page.navigate', { url }), Math.min(budgetMs, 5000), 'Page.navigate');
    const started = Date.now();
    while (!loadFired && (Date.now() - started) < budgetMs) {
      await delay(120);
    }
    await delay(settleMs);

    const evalJson = async (expression) => {
      const result = await withTimeout(session.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }), Math.min(5000, Math.max(2200, budgetMs)), 'Runtime.evaluate');
      return result?.result?.value ?? null;
    };

    const domSummary = await evalJson(`(() => {
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const root = document.querySelector('#root') || document.body;
      const text = String((root && root.innerText) || document.body.innerText || '').replace(/\\s+/g, ' ').trim();
      const errPanel = document.querySelector('#err');
      const buttons = Array.from(document.querySelectorAll('button,[role="button"],input[type="submit"]')).filter(visible);
      const links = Array.from(document.querySelectorAll('a[href]')).filter(visible);
      const forms = Array.from(document.forms || []).filter(visible);
      const inputs = Array.from(document.querySelectorAll('input, textarea, select')).filter(visible);
      return {
        readyState: document.readyState,
        href: location.href,
        title: document.title || '',
        bodyChildren: document.body ? document.body.children.length : 0,
        rootChildren: root ? root.children.length : 0,
        textLength: text.length,
        textSample: text.slice(0, 280),
        errPanel: errPanel ? String(errPanel.textContent || '').trim().slice(0, 280) : '',
        buttons: buttons.length,
        links: links.length,
        forms: forms.length,
        inputs: inputs.length,
        hasMain: !!document.querySelector('main,[role="main"],#root'),
      };
    })()`);

    const interactions = [];
    const snapshotCounts = () => ({
      console: consoleEntries.length,
      log: logEntries.length,
      exceptions: exceptions.length,
      network: networkIssues.length,
    });
    const pushInteraction = async (id, expression) => {
      const before = snapshotCounts();
      const detail = await evalJson(expression);
      await delay(actionDelayMs);
      const after = snapshotCounts();
      interactions.push({
        id,
        detail,
        deltas: {
          console: after.console - before.console,
          log: after.log - before.log,
          exceptions: after.exceptions - before.exceptions,
          network: after.network - before.network,
        },
      });
    };

    await pushInteraction('fill_form_and_submit', `(() => {
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const candidateForm = Array.from(document.forms || []).find(visible);
      const root = candidateForm || document.body;
      const fields = Array.from(root.querySelectorAll('input, textarea, select')).filter(visible).slice(0, 6);
      const touched = [];
      const setValue = (el, value) => {
        const tag = String(el.tagName || '').toLowerCase();
        const type = String(el.type || '').toLowerCase();
        if (tag === 'select') {
          if (el.options && el.options.length) {
            el.selectedIndex = Math.min(1, el.options.length - 1);
          }
        } else if (type === 'checkbox' || type === 'radio') {
          el.checked = true;
        } else if (type !== 'hidden' && !el.readOnly && !el.disabled) {
          el.focus();
          el.value = value;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      fields.forEach((el, index) => {
        const name = String(el.name || el.id || el.placeholder || el.type || el.tagName || ('field-' + index)).slice(0, 60);
        const type = String(el.type || '').toLowerCase();
        let value = 'funfo';
        if (type === 'email') value = 'smoke@example.com';
        else if (type === 'number') value = '3';
        else if (type === 'tel') value = '09012345678';
        else if (type === 'date') value = '2026-03-16';
        else if (type === 'time') value = '09:30';
        else if (type === 'search') value = 'smoke';
        else if (type === 'password') value = 'Password123!';
        setValue(el, value);
        touched.push({ name, type: type || String(el.tagName || '').toLowerCase() });
      });
      let submitter = null;
      if (candidateForm) {
        submitter = candidateForm.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      }
      if (!submitter) {
        submitter = Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"]')).find(visible)
          || Array.from(document.querySelectorAll('button')).find(visible);
      }
      if (submitter && !submitter.disabled) {
        submitter.click();
      } else if (candidateForm) {
        candidateForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
      return {
        formFound: !!candidateForm,
        touched,
        submitted: !!submitter || !!candidateForm,
        submitter: submitter ? String((submitter.innerText || submitter.value || submitter.getAttribute('aria-label') || submitter.id || submitter.tagName || '')).slice(0, 80) : '',
      };
    })()`);

    await pushInteraction('click_primary_action', `(() => {
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const candidates = Array.from(document.querySelectorAll('button,[role="button"],a[href],input[type="button"],input[type="submit"]')).filter(visible);
      const words = /(save|submit|create|add|start|login|sign in|search|next|send|生成|保存|提交|创建|新增|开始|登录|登録|作成|追加|検索|次へ)/i;
      let best = null;
      let score = -1;
      for (const el of candidates) {
        const text = String(el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
        const href = String(el.getAttribute && el.getAttribute('href') || '');
        let nextScore = 1;
        if (words.test(text)) nextScore += 5;
        if (href && href !== '#' && !/^https?:/i.test(href)) nextScore += 2;
        if (el.tagName === 'BUTTON') nextScore += 1;
        if (nextScore > score) {
          score = nextScore;
          best = { el, text, href };
        }
      }
      if (!best || !best.el || best.el.disabled) {
        return { clicked: false, reason: 'no visible actionable control' };
      }
      best.el.click();
      return {
        clicked: true,
        text: String(best.text || '').slice(0, 80),
        href: String(best.href || '').slice(0, 160),
        tag: String(best.el.tagName || '').toLowerCase(),
      };
    })()`);

    const runtimeTrap = await evalJson(`(() => {
      const state = window.__FUNFO_BROWSER_SMOKE__ || {};
      return {
        errors: Array.isArray(state.errors) ? state.errors.slice(0, 5) : [],
        rejections: Array.isArray(state.rejections) ? state.rejections.slice(0, 5) : [],
        href: location.href,
      };
    })()`);

    const blockingConsole = [
      ...consoleEntries.filter(item => item.level === 'error'),
      ...logEntries.filter(item => item.level === 'error' && !isIgnorableBrowserUrl(item.url)),
      ...exceptions.map(item => ({ level: 'error', text: item.text, url: item.url || '' })),
      ...(runtimeTrap?.errors || []).map(item => ({ level: 'error', text: item?.message || '', url: item?.filename || '' })),
      ...(runtimeTrap?.rejections || []).map(item => ({ level: 'error', text: item?.message || '', url: '' })),
    ].filter(item => item.text);

    const blockingNetworkIssues = networkIssues.filter(item => isProbablyBlockingNetworkIssue(url, item));
    const interactionFailures = interactions.filter(item =>
      (item?.deltas?.exceptions || 0) > 0
      || (item?.deltas?.console || 0) > 0
      || (item?.deltas?.network || 0) > 0
    );

    const checks = [];
    checks.push(buildCheck(
      'browser_document_load',
      'Browser page load',
      !!loadFired && !!domSummary?.readyState,
      loadFired ? `loaded ${truncate(domSummary?.href || url, 180)}` : 'page load did not complete within browser smoke budget',
      true,
      { href: domSummary?.href || url, readyState: domSummary?.readyState || null }
    ));
    checks.push(buildCheck(
      'browser_dom_render',
      'Browser DOM render',
      !!domSummary && !domSummary?.errPanel && ((domSummary.rootChildren || 0) > 0 || (domSummary.textLength || 0) > 20),
      domSummary?.errPanel
        ? `inline error panel detected: ${truncate(domSummary.errPanel, 180)}`
        : `textLength=${domSummary?.textLength || 0}, rootChildren=${domSummary?.rootChildren || 0}`,
      true,
      domSummary || null
    ));
    checks.push(buildCheck(
      'browser_console_clean',
      'Browser console/runtime clean',
      blockingConsole.length === 0,
      blockingConsole.length === 0
        ? 'no browser console/runtime errors detected'
        : blockingConsole.slice(0, 3).map(item => truncate(item.text, 180)).join(' | '),
      true,
      { console: consoleEntries.slice(0, 8), log: logEntries.slice(0, 8), exceptions: exceptions.slice(0, 6), runtimeTrap }
    ));
    checks.push(buildCheck(
      'browser_network_clean',
      'Browser network clean',
      blockingNetworkIssues.length === 0,
      blockingNetworkIssues.length === 0
        ? 'no blocking browser network failures detected'
        : blockingNetworkIssues.slice(0, 4).map(item => `${item.status || item.errorText || 'error'} ${truncate(item.url, 140)}`).join(' | '),
      true,
      { issues: networkIssues.slice(0, 10) }
    ));
    checks.push(buildCheck(
      'browser_interaction_smoke',
      'Browser interaction smoke',
      interactionFailures.length === 0,
      interactionFailures.length === 0
        ? (interactions.some(item => item?.detail?.clicked || item?.detail?.submitted || item?.detail?.formFound)
            ? 'interaction smoke executed without new runtime/network failures'
            : 'no obvious interaction targets found; skipped safely')
        : interactionFailures.slice(0, 3).map(item => `${item.id} introduced errors (console=${item.deltas.console}, exceptions=${item.deltas.exceptions}, network=${item.deltas.network})`).join(' | '),
      false,
      { interactions, dialogs }
    ));

    const blockingFailures = checks.filter(item => item.blocking && !item.ok);
    return {
      ok: blockingFailures.length === 0,
      summary: blockingFailures.length === 0
        ? 'browser smoke passed'
        : `browser smoke failed: ${blockingFailures.map(item => item.id).join(', ')}`,
      checks,
      blockingFailures,
      evidence: {
        domSummary,
        consoleEntries: consoleEntries.slice(0, 12),
        logEntries: logEntries.slice(0, 12),
        exceptions: exceptions.slice(0, 8),
        networkIssues: networkIssues.slice(0, 12),
        dialogs,
        interactions,
        chromeStdout: truncate(stdout.join(' '), 500),
        chromeStderr: truncate(stderr.join(' '), 500),
      },
    };
  } catch (error) {
    const detail = String(error?.message || error || 'browser smoke failed');
    const failedCheck = buildCheck(
      'browser_document_load',
      'Browser page load',
      false,
      detail,
      true
    );
    return {
      ok: false,
      summary: `browser smoke failed: ${detail}`,
      checks: [failedCheck],
      blockingFailures: [failedCheck],
      evidence: {
        error: detail,
        chromeStdout: truncate(stdout.join(' '), 500),
        chromeStderr: truncate(stderr.join(' '), 500),
      },
    };
  } finally {
    if (session) {
      try { await session.close(); } catch {}
    }
    try { chrome.kill('SIGTERM'); } catch {}
    await delay(150);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = {
  runBrowserSmoke,
  buildBrowserSmokeCheck: buildCheck,
};
