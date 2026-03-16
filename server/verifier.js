const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createVerifierModule(deps) {
  const {
    getAppDir,
    hydrateVersionRow,
    getContainerRuntime,
    waitRuntimeReady,
    extractFrontendApiContracts,
    extractBackendApiContracts,
    fetchRuntimeHealth,
    runBrowserSmoke,
    resolveBrowserSmokeUrl,
  } = deps;

  function normalizeContractPath(rawPath = '') {
    let normalized = String(rawPath || '').trim();
    if (!normalized) return '';
    normalized = normalized.split('?')[0].trim();
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    normalized = normalized.replace(/\/+/g, '/');
    if (normalized.length > 1) normalized = normalized.replace(/\/+$/g, '');
    return normalized;
  }

  function buildContractAliases(method, rawPath = '') {
    const cleanMethod = String(method || '').toUpperCase();
    const path = normalizeContractPath(rawPath);
    if (!cleanMethod || !path) return [];

    const aliases = new Set([`${cleanMethod} ${path}`]);
    if (path.startsWith('/api/') && !/:([A-Za-z_][A-Za-z0-9_]*)/.test(path)) {
      aliases.add(`${cleanMethod} ${path}/:id`);
      aliases.add(`${cleanMethod} ${path}/:slug`);
    }
    return Array.from(aliases);
  }

  function hasContractMatch(backendContracts, method, rawPath = '') {
    const aliases = buildContractAliases(method, rawPath);
    return aliases.some((key) => backendContracts.has(key));
  }

  function hasNonEmptyFile(filePath) {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
    } catch {
      return false;
    }
  }

  function getRuntimeBaseUrl(runtime) {
    if (!runtime?.running) return '';
    if (runtime.hostPort) return `http://127.0.0.1:${runtime.hostPort}`;
    if (runtime.ip) return `http://${runtime.ip}:3001`;
    return '';
  }

  function buildCheck(id, label, ok, detail, blocking = true, meta = null) {
    return { id, label, ok: !!ok, blocking: !!blocking, detail: detail || '', meta };
  }

  function sha256(value = '') {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
  }

  function mapVerifierCheckToFailure(check) {
    const mapping = {
      frontend_artifact: { type: 'FRONTEND_ARTIFACT_MISSING', phase: 'verifier', retryable: false, strategy: 'stop' },
      backend_artifact: { type: 'BACKEND_ARTIFACT_EMPTY', phase: 'verifier', retryable: true, strategy: 'backend-repair' },
      version_artifacts_persisted: { type: 'ARTIFACT_PERSIST_FAILED', phase: 'verifier', retryable: true, strategy: 'system-repair' },
      artifact_consistency: { type: 'ARTIFACT_CONSISTENCY_FAILED', phase: 'verifier', retryable: true, strategy: 'system-repair' },
      frontend_api_binding: { type: 'FRONTEND_LOCAL_FIRST', phase: 'backend_generation', retryable: false, strategy: 'frontend-conversion' },
      frontend_local_first_signals: { type: 'FRONTEND_LOCAL_FIRST', phase: 'backend_generation', retryable: false, strategy: 'frontend-conversion' },
      frontend_contracts_detected: { type: 'FRONTEND_CONTRACTS_MISSING', phase: 'backend_generation', retryable: false, strategy: 'frontend-conversion' },
      contract_alignment: { type: 'CONTRACT_ALIGNMENT_FAILED', phase: 'release_repair', retryable: true, strategy: 'backend-repair' },
      schema_runtime_compat: { type: 'SCHEMA_COMPAT_FAILED', phase: 'db_check', retryable: true, strategy: 'runtime-config-repair' },
      runtime_present: { type: 'RUNTIME_NOT_PRESENT', phase: 'docker_start', retryable: true, strategy: 'redeploy' },
      runtime_ready: { type: 'RUNTIME_HEALTH_FAILED', phase: 'health_check', retryable: true, strategy: 'redeploy' },
      runtime_health_payload: { type: 'RUNTIME_HEALTH_PAYLOAD_INVALID', phase: 'health_check', retryable: true, strategy: 'redeploy' },
      runtime_db_mode: { type: 'RUNTIME_DBMODE_MISMATCH', phase: 'health_check', retryable: false, strategy: 'runtime-config-repair' },
      behavior_smoke_get: { type: 'BEHAVIOR_SMOKE_FAILED', phase: 'verifier', retryable: true, strategy: 'redeploy' },
      behavior_smoke_login: { type: 'AUTH_SMOKE_FAILED', phase: 'verifier', retryable: true, strategy: 'runtime-config-repair' },
      behavior_smoke_session: { type: 'AUTH_SMOKE_FAILED', phase: 'verifier', retryable: true, strategy: 'runtime-config-repair' },
      behavior_smoke_logout: { type: 'AUTH_SMOKE_FAILED', phase: 'verifier', retryable: true, strategy: 'runtime-config-repair' },
      browser_smoke_runtime: { type: 'BROWSER_SMOKE_UNAVAILABLE', phase: 'verifier', retryable: false, strategy: 'manual-review' },
      browser_document_load: { type: 'BROWSER_PAGE_LOAD_FAILED', phase: 'verifier', retryable: true, strategy: 'frontend-repair' },
      browser_dom_render: { type: 'BROWSER_RENDER_FAILED', phase: 'verifier', retryable: true, strategy: 'frontend-repair' },
      browser_console_clean: { type: 'BROWSER_RUNTIME_ERROR', phase: 'verifier', retryable: true, strategy: 'frontend-repair' },
      browser_network_clean: { type: 'BROWSER_NETWORK_FAILED', phase: 'verifier', retryable: true, strategy: 'runtime-config-repair' },
    };
    const base = mapping[check?.id] || { type: 'VERIFIER_FAILED', phase: 'verifier', retryable: false, strategy: 'manual-review' };
    return {
      checkId: check?.id || null,
      label: check?.label || '',
      detail: check?.detail || '',
      blocking: !!check?.blocking,
      type: base.type,
      phase: base.phase,
      retryable: !!base.retryable,
      strategy: base.strategy,
      meta: check?.meta || null,
    };
  }

  function parseSqlSchema(sqlCode = '') {
    const tables = {};
    const sql = String(sqlCode || '');
    const tableBlocks = [...sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(([^]*?)\);/gi)];
    for (const match of tableBlocks) {
      const table = String(match[1] || '').trim();
      const body = String(match[2] || '');
      const cols = new Set();
      for (const raw of body.split(',')) {
        const line = raw.trim();
        if (!line || /^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK)\b/i.test(line)) continue;
        const mm = line.match(/^(\w+)\s+/);
        if (mm) cols.add(mm[1]);
      }
      tables[table] = cols;
    }
    return tables;
  }

  function inferSchemaRequirements(serverCode = '') {
    const requirements = [];
    const seen = new Set();
    const add = (table, column) => {
      const key = `${table}.${column}`;
      if (seen.has(key)) return;
      seen.add(key);
      requirements.push({ table, column });
    };
    const src = String(serverCode || '');

    // Extract only SQL string literals from the source code to avoid matching
    // JavaScript identifiers (e.g., "update\napp.put(..." being read as "UPDATE app").
    // We look for quoted strings that contain SQL keywords.
    const sqlStrings = [];
    const stringPatterns = [
      /`([^`]*)`/g,          // template literals
      /'([^'\\]*(?:\\.[^'\\]*)*)'/g,  // single-quoted strings
      /"([^"\\]*(?:\\.[^"\\]*)*)"/g,  // double-quoted strings
    ];
    for (const pattern of stringPatterns) {
      let m;
      while ((m = pattern.exec(src)) !== null) {
        const content = m[1] || '';
        // Only keep strings that look like SQL (contain SQL keywords)
        if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|FROM|INTO|JOIN|WHERE)\b/i.test(content)) {
          sqlStrings.push(content);
        }
      }
    }
    const sqlSource = sqlStrings.join('\n');

    // Generic: scan for all table references in SQL-like patterns within SQL strings only
    const tableRefs = new Set();
    const tablePatterns = [
      /\bFROM\s+(\w+)\b/gi,
      /\bINTO\s+(\w+)\b/gi,
      /\bUPDATE\s+(\w+)\b/gi,
      /\bJOIN\s+(\w+)\b/gi,
    ];
    // Known non-table identifiers: JS variables, Express/framework objects, SQL keywords
    const NON_TABLE_WORDS = new Set([
      'select', 'where', 'set', 'values', 'and', 'or', 'not', 'null', 'table', 'index',
      'app', 'express', 'db', 'router', 'req', 'res', 'next', 'err', 'error',
      'schema_migrations', 'schema_meta',
    ]);
    for (const pattern of tablePatterns) {
      let m;
      while ((m = pattern.exec(sqlSource)) !== null) {
        const table = m[1].toLowerCase();
        if (NON_TABLE_WORDS.has(table)) continue;
        tableRefs.add(table);
      }
    }

    // For each referenced table, check if backend code uses specific columns
    // We check within individual SQL strings (statement-level) to avoid cross-statement false matches
    const commonColumns = [
      'login_at', 'last_login_at', 'logged_out_at', 'logout_at',
      'session_token', 'token', 'user_id', 'created_at', 'updated_at',
      'name', 'email', 'password_hash', 'gender', 'age',
    ];
    // Build a map of table aliases per SQL string (e.g., "FROM users u" → u = users)
    function extractTableAliases(sqlStr) {
      const aliases = {};
      const aliasRe = /\b(FROM|JOIN)\s+(\w+)\s+(?:AS\s+)?(\w+)\b/gi;
      let am;
      while ((am = aliasRe.exec(sqlStr)) !== null) {
        const tbl = am[2].toLowerCase();
        const alias = am[3].toLowerCase();
        // Skip if "alias" is actually a SQL keyword
        if (['on', 'where', 'set', 'inner', 'left', 'right', 'outer', 'cross', 'natural', 'order', 'group', 'having', 'limit'].includes(alias)) continue;
        aliases[alias] = tbl;
      }
      return aliases;
    }

    for (const table of tableRefs) {
      for (const col of commonColumns) {
        // Check each SQL string individually so we don't cross-pollinate between statements
        let found = false;
        for (const sqlStr of sqlStrings) {
          if (found) break;
          // Table must be referenced in this specific SQL string
          const tableInStr = new RegExp(`(FROM|INTO|UPDATE|JOIN)\\s+${table}\\b`, 'i').test(sqlStr);
          if (!tableInStr) continue;

          // Direct table.column reference
          const directRef = new RegExp(`\\b${table}\\.${col}\\b`, 'i').test(sqlStr);
          if (directRef) { add(table, col); found = true; break; }

          // Check if column appears in this SQL string
          const colRe = new RegExp(`\\b${col}\\b`);
          if (!colRe.test(sqlStr)) continue;

          // If column is prefixed (alias.col), only count it for THIS table if the alias maps to it
          const prefixedRe = new RegExp(`\\b(\\w+)\\.${col}\\b`, 'gi');
          let pm;
          let onlyPrefixed = true;
          let prefixedForThisTable = false;
          const aliases = extractTableAliases(sqlStr);
          while ((pm = prefixedRe.exec(sqlStr)) !== null) {
            const prefix = pm[1].toLowerCase();
            const resolvedTable = aliases[prefix] || prefix;
            if (resolvedTable === table) prefixedForThisTable = true;
          }
          // Check if column appears unprefixed (not preceded by "word.")
          const unprefixedRe = new RegExp(`(?<!\\w\\.)\\b${col}\\b`);
          const hasUnprefixed = unprefixedRe.test(sqlStr);

          if (prefixedForThisTable || hasUnprefixed) {
            add(table, col);
            found = true;
          }
        }
      }
    }

    // Explicit well-known patterns (keep for backward compat, use sqlSource to avoid JS false matches)
    if (/\bFROM\s+users\b|\bINTO\s+users\b|\bUPDATE\s+users\b/i.test(sqlSource)) {
      if (/\blogin_at\b/.test(sqlSource)) add('users', 'login_at');
      if (/\blast_login_at\b/.test(sqlSource)) add('users', 'last_login_at');
    }
    if (/\bFROM\s+sessions\b|\bINTO\s+sessions\b|\bUPDATE\s+sessions\b/i.test(sqlSource)) {
      add('sessions', 'id');
      if (/\blogged_out_at\b/.test(sqlSource)) add('sessions', 'logged_out_at');
      if (/\bsession_token\b/.test(sqlSource)) add('sessions', 'session_token');
    }
    if (/\bFROM\s+user_sessions\b|\bINTO\s+user_sessions\b|\bUPDATE\s+user_sessions\b/i.test(sqlSource)) {
      add('user_sessions', 'id');
      if (/\blogin_at\b/.test(sqlSource)) add('user_sessions', 'login_at');
      if (/\blogout_at\b/.test(sqlSource)) add('user_sessions', 'logout_at');
    }
    return requirements;
  }

  async function probeGetRoute(runtime, route, cookie = '') {
    const runtimeBaseUrl = getRuntimeBaseUrl(runtime);
    if (!runtimeBaseUrl || !route) return { ok: false, status: null };
    try {
      const res = await fetch(`${runtimeBaseUrl}${route}`, {
        headers: cookie ? { cookie } : undefined,
      });
      return { ok: res.ok, status: res.status };
    } catch {
      return { ok: false, status: null };
    }
  }

  async function requestRuntime(runtime, method, route, { json, cookie } = {}) {
    const runtimeBaseUrl = getRuntimeBaseUrl(runtime);
    if (!runtimeBaseUrl || !route) return { ok: false, status: null, body: null, cookie: cookie || '' };
    try {
      const headers = {};
      if (json !== undefined) headers['content-type'] = 'application/json';
      if (cookie) headers.cookie = cookie;
      const res = await fetch(`${runtimeBaseUrl}${route}`, {
        method,
        headers,
        body: json !== undefined ? JSON.stringify(json) : undefined,
      });
      const setCookieRaw = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie().join('; ')
        : (res.headers.get('set-cookie') || '');
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { ok: res.ok, status: res.status, body, cookie: setCookieRaw || cookie || '' };
    } catch (error) {
      return { ok: false, status: null, body: { error: String(error?.message || error) }, cookie: cookie || '' };
    }
  }

  function findAuthRoute(backendContracts, method, candidates) {
    for (const candidate of candidates) {
      if (backendContracts.has(`${method} ${candidate}`)) return candidate;
    }
    return null;
  }

  async function runAuthSmoke(runtime, backendContracts) {
    // Flexible login route detection — support common patterns beyond /api/login and /api/session/login
    const loginCandidates = [
      '/api/login',
      '/api/session/login',
      '/api/users/login',
      '/api/auth/login',
      '/api/auth/signin',
    ];
    const sessionCandidates = [
      '/api/session/current',
      '/api/session',
      '/api/auth/me',
      '/api/auth/session',
      '/api/users/me',
    ];
    const logoutCandidates = [
      '/api/logout',
      '/api/session/logout',
      '/api/auth/logout',
      '/api/users/logout',
    ];

    const loginRoute = findAuthRoute(backendContracts, 'POST', loginCandidates);
    const sessionRoute = findAuthRoute(backendContracts, 'GET', sessionCandidates);
    const logoutRoute = findAuthRoute(backendContracts, 'POST', logoutCandidates);

    const hasLogin = !!loginRoute;
    const hasSession = !!sessionRoute;
    const hasLogout = !!logoutRoute;
    const authPresent = hasLogin || hasSession || hasLogout;

    if (!authPresent || !getRuntimeBaseUrl(runtime)) {
      return {
        authPresent,
        login: null,
        session: null,
        logout: null,
      };
    }

    // Try multiple gender values to handle different validation rules
    const genderCandidates = ['その他', 'other', '男性', 'male'];
    let login = null;
    if (hasLogin) {
      for (const gender of genderCandidates) {
        const payload = { name: '__publish_smoke__', gender, age: 30 };
        login = await requestRuntime(runtime, 'POST', loginRoute, { json: payload });
        if (login?.ok) break;
        // If 400 with gender validation error, try next gender
        if (login?.status === 400) {
          const errMsg = typeof login.body === 'object' ? JSON.stringify(login.body) : String(login.body || '');
          if (/性別|gender/i.test(errMsg)) continue;
        }
        break; // non-gender error, stop trying
      }
    }

    const session = (hasSession && login?.cookie) ? await requestRuntime(runtime, 'GET', sessionRoute, { cookie: login.cookie }) : null;
    const logout = (hasLogout && login?.cookie) ? await requestRuntime(runtime, 'POST', logoutRoute, { cookie: login.cookie }) : null;
    return { authPresent, login, session, logout, loginRoute, sessionRoute, logoutRoute };
  }

  async function verifyAppRelease(appId, latestRaw, options = {}) {
    const expectedDbMode = options.expectedDbMode || 'prod';
    const latest = hydrateVersionRow(appId, latestRaw);
    const appDir = getAppDir(appId);
    const runtime = getContainerRuntime(appId);

    const frontendCode = String(latest?.code || '');
    const serverCode = String(latest?.server_code || '');
    const sqlCode = String(latest?.sql_code || '');

    const frontendContracts = extractFrontendApiContracts(frontendCode);
    const backendContracts = extractBackendApiContracts(serverCode);
    const stableGetContracts = frontendContracts
      .filter(c => c.method === 'GET' && c.path && !c.path.includes(':') && !c.path.includes('{'));

    const checks = [];
    checks.push(buildCheck(
      'frontend_artifact',
      'Frontend artifact persisted',
      !!frontendCode.trim() && hasNonEmptyFile(path.join(appDir, 'App.jsx')),
      frontendCode.trim() ? 'frontend code and App.jsx present' : 'frontend code missing'
    ));
    checks.push(buildCheck(
      'backend_artifact',
      'Backend artifact persisted',
      !!serverCode.trim() && hasNonEmptyFile(path.join(appDir, 'server.js')),
      serverCode.trim() ? 'backend code and server.js present' : 'backend code missing'
    ));
    checks.push(buildCheck(
      'schema_artifact',
      'Schema artifact persisted',
      !!sqlCode.trim() && hasNonEmptyFile(path.join(appDir, 'schema.sql')),
      sqlCode.trim() ? 'schema code and schema.sql present' : 'schema missing',
      false
    ));

    const versionDir = latest?.version_number ? path.join(appDir, 'versions', `v${latest.version_number}`) : null;
    const rootHashes = { frontend: sha256(frontendCode), backend: sha256(serverCode), schema: sha256(sqlCode) };
    const versionFileInfo = versionDir ? {
      frontend: hasNonEmptyFile(path.join(versionDir, 'App.jsx')),
      backend: hasNonEmptyFile(path.join(versionDir, 'server.js')),
      schema: hasNonEmptyFile(path.join(versionDir, 'schema.sql')),
    } : null;
    checks.push(buildCheck(
      'version_artifacts_persisted',
      'Versioned artifacts persisted',
      !!versionDir && !!versionFileInfo?.frontend && !!versionFileInfo?.backend,
      versionDir
        ? `version dir ${path.basename(versionDir)} frontend=${!!versionFileInfo?.frontend} backend=${!!versionFileInfo?.backend} schema=${!!versionFileInfo?.schema}`
        : 'version number missing; cannot verify versioned artifacts',
      true,
      versionFileInfo
    ));

    if (versionDir && versionFileInfo?.frontend && versionFileInfo?.backend) {
      const readIfExists = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
      const versionHashes = {
        frontend: sha256(readIfExists(path.join(versionDir, 'App.jsx'))),
        backend: sha256(readIfExists(path.join(versionDir, 'server.js'))),
        schema: sha256(readIfExists(path.join(versionDir, 'schema.sql'))),
      };
      const consistent = rootHashes.frontend === versionHashes.frontend
        && rootHashes.backend === versionHashes.backend
        && rootHashes.schema === versionHashes.schema;
      checks.push(buildCheck(
        'artifact_consistency',
        'Root/version artifacts consistent',
        consistent,
        consistent ? 'root artifacts match versioned artifacts' : 'root artifacts differ from versioned artifacts',
        true,
        { rootHashes, versionHashes, versionDir }
      ));
    }

    const usesApiBase = /\bAPI_BASE\b/.test(frontendCode);
    const usesFetch = /\bfetch\s*\(/.test(frontendCode);
    const usesApiHelpers = /\bapi(?:Get|Send|Delete)\s*\(/.test(frontendCode);
    const usesApiPath = /['"`]\/api\//.test(frontendCode)
      || /API_BASE\s*\+\s*['"`]\/api\//.test(frontendCode)
      || /\bapi(?:Get|Delete)\(\s*(?:[^)]*?['"`])?\/api\//.test(frontendCode)
      || /\bapiSend\(\s*(?:[^,]*?['"`])?\/api\//.test(frontendCode);
    const localStorageSignals = /\blocalStorage\b|\bsessionStorage\b/.test(frontendCode);
    const mockSignals = /\b(mock|sampleData|demoData|seedData|STORAGE_KEY)\b/.test(frontendCode);
    const apiDriven = (usesFetch && usesApiBase)
      || ((usesApiBase || usesFetch || usesApiHelpers) && usesApiPath)
      || (usesApiHelpers && usesApiPath);
    checks.push(buildCheck(
      'frontend_api_binding',
      'Frontend bound to API',
      apiDriven && !localStorageSignals,
      apiDriven
        ? (localStorageSignals ? 'API binding exists but local storage fallback still present' : 'frontend is API-driven')
        : `frontend still looks local-first (usesApiBase=${usesApiBase}, usesFetch=${usesFetch}, usesApiHelpers=${usesApiHelpers}, usesApiPath=${usesApiPath})`,
      false
    ));
    checks.push(buildCheck(
      'frontend_local_first_signals',
      'Frontend local-first signals removed',
      !localStorageSignals && !mockSignals,
      (!localStorageSignals && !mockSignals)
        ? 'no local storage or obvious mock-data source-of-truth signals found'
        : `local-first signals remain (localStorage=${localStorageSignals}, mockSignals=${mockSignals})`,
      false
    ));

    const frontendContractKeys = frontendContracts.map(c => `${String(c.method || '').toUpperCase()} ${normalizeContractPath(c.path)}`);
    const missingContracts = frontendContracts
      .filter(c => !hasContractMatch(backendContracts, c.method, c.path))
      .map(c => `${String(c.method || '').toUpperCase()} ${normalizeContractPath(c.path)}`);
    const frontendNeedsBackendContracts = apiDriven || frontendContractKeys.length > 0;
    checks.push(buildCheck(
      'frontend_contracts_detected',
      'Frontend contracts detected',
      frontendContractKeys.length > 0 || !frontendNeedsBackendContracts,
      frontendContractKeys.length
        ? `${frontendContractKeys.length} frontend API contract(s) extracted`
        : (frontendNeedsBackendContracts ? 'no frontend API contracts detected' : 'no frontend API contracts required for this app')
    ));
    checks.push(buildCheck(
      'contract_alignment',
      'Frontend/backend contract alignment',
      !frontendNeedsBackendContracts || missingContracts.length === 0,
      !frontendNeedsBackendContracts
        ? 'frontend does not require backend API contract alignment'
        : (missingContracts.length ? `missing routes: ${missingContracts.slice(0, 10).join(', ')}` : `all ${frontendContracts.length} referenced frontend routes exist in backend`),
      true,
      { missingContracts, frontendNeedsBackendContracts }
    ));

    // Check Express route ordering: static segments should be before parameterized ones
    const routeOrderIssues = [];
    const routeOrderRe = /app\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]+)['"`]/gi;
    const registeredRoutes = [];
    let rom;
    while ((rom = routeOrderRe.exec(serverCode)) !== null) {
      registeredRoutes.push({ method: rom[1].toUpperCase(), path: rom[2], index: rom.index });
    }
    for (let ri = 0; ri < registeredRoutes.length; ri++) {
      const route = registeredRoutes[ri];
      if (route.path.includes(':')) continue; // skip param routes
      // Check if there's an earlier parameterized route that would shadow this static route
      const staticSegments = route.path.split('/').filter(Boolean);
      for (let rj = 0; rj < ri; rj++) {
        const earlier = registeredRoutes[rj];
        if (earlier.method !== route.method) continue;
        const earlierSegments = earlier.path.split('/').filter(Boolean);
        if (earlierSegments.length !== staticSegments.length) continue;
        // Check if the earlier route is a parameterized version that would match this static route
        let shadows = true;
        for (let sk = 0; sk < staticSegments.length; sk++) {
          const es = earlierSegments[sk] || '';
          const ss = staticSegments[sk] || '';
          if (es === ss) continue;
          if (es.startsWith(':')) continue; // param matches anything
          shadows = false;
          break;
        }
        if (shadows) {
          routeOrderIssues.push(`${earlier.method} ${earlier.path} (registered earlier) shadows ${route.method} ${route.path}`);
        }
      }
    }
    checks.push(buildCheck(
      'route_ordering',
      'Express route ordering (static before parameterized)',
      routeOrderIssues.length === 0,
      routeOrderIssues.length
        ? `route shadowing detected: ${routeOrderIssues.join('; ')}`
        : 'no route ordering issues detected',
      false, // warning, not blocking (since app-backend-manager now auto-reorders)
      { routeOrderIssues }
    ));

    const schemaTables = parseSqlSchema(sqlCode);
    const schemaRequirements = inferSchemaRequirements(serverCode);
    const missingSchemaBits = schemaRequirements.filter(req => !schemaTables[req.table] || (req.column !== 'id' && !schemaTables[req.table].has(req.column)));
    checks.push(buildCheck(
      'schema_runtime_compat',
      'Schema/runtime compatibility',
      missingSchemaBits.length === 0,
      missingSchemaBits.length
        ? `server expects missing schema parts: ${missingSchemaBits.map(x => `${x.table}.${x.column}`).join(', ')}`
        : 'server-side table/column expectations are present in schema.sql',
      true,
      { missingSchemaBits, schemaRequirements }
    ));

    const runtimeRunning = !!runtime?.running;
    checks.push(buildCheck(
      'runtime_present',
      'Docker runtime present',
      runtimeRunning,
      runtimeRunning ? `container ${runtime.containerName || 'running'}` : 'container not running'
    ));

    let ready = false;
    let runtimeHealth = null;
    if (runtimeRunning) {
      ready = await waitRuntimeReady({ appId, runtime }, 6, 250);
      runtimeHealth = ready ? await fetchRuntimeHealth(getContainerRuntime(appId) || runtime) : null;
    }

    checks.push(buildCheck(
      'runtime_ready',
      'Runtime health endpoint reachable',
      ready,
      ready ? 'health endpoint responded' : 'health endpoint not ready'
    ));

    checks.push(buildCheck(
      'runtime_health_payload',
      'Runtime health payload valid',
      !!runtimeHealth?.ok,
      runtimeHealth?.ok ? 'health payload ok=true' : 'health payload missing or invalid'
    ));

    checks.push(buildCheck(
      'runtime_db_mode',
      'Runtime DB mode verified',
      !!runtimeHealth?.ok && String(runtimeHealth?.dbMode || '').toLowerCase() === String(expectedDbMode).toLowerCase(),
      runtimeHealth?.ok ? `dbMode=${runtimeHealth?.dbMode || 'unknown'}` : 'db mode unavailable',
      true,
      runtimeHealth ? { dbMode: runtimeHealth.dbMode, dbFile: runtimeHealth.dbFile } : null
    ));

    checks.push(buildCheck(
      'smokeable_contracts',
      'Smoke-testable GET routes discovered',
      stableGetContracts.length > 0,
      stableGetContracts.length ? `${stableGetContracts.length} stable GET route(s) available for probes` : 'no stable GET routes found',
      false,
      { stableGetContracts }
    ));

    let smokeProbe = null;
    if (ready && stableGetContracts.length > 0) {
      smokeProbe = await probeGetRoute(runtime, stableGetContracts[0].path);
    }
    checks.push(buildCheck(
      'behavior_smoke_get',
      'Behavior smoke GET probe',
      !stableGetContracts.length || !!smokeProbe?.ok,
      stableGetContracts.length
        ? (smokeProbe?.ok ? `GET ${stableGetContracts[0].path} responded ${smokeProbe.status}` : `GET ${stableGetContracts[0].path} probe failed${smokeProbe?.status ? ` (${smokeProbe.status})` : ''}`)
        : 'no stable GET route available for smoke probe',
      false,
      smokeProbe ? { route: stableGetContracts[0].path, status: smokeProbe.status } : { route: null }
    ));

    const authSmoke = ready ? await runAuthSmoke(runtime, backendContracts) : { authPresent: false, login: null, session: null, logout: null };
    checks.push(buildCheck(
      'behavior_smoke_login',
      'Behavior smoke login',
      !authSmoke.authPresent || !!authSmoke.login?.ok,
      !authSmoke.authPresent
        ? 'no auth routes detected; login smoke skipped'
        : (authSmoke.login?.ok ? `${authSmoke.loginRoute} responded ${authSmoke.login.status}` : `${authSmoke.loginRoute} failed${authSmoke.login?.status ? ` (${authSmoke.login.status})` : ''}`),
      false,
      authSmoke.login || null
    ));
    checks.push(buildCheck(
      'behavior_smoke_session',
      'Behavior smoke session/current',
      !authSmoke.authPresent || !authSmoke.sessionRoute || !!authSmoke.session?.ok,
      !authSmoke.authPresent
        ? 'no auth routes detected; session smoke skipped'
        : (!authSmoke.sessionRoute ? 'session route not present; skipped' : (authSmoke.session?.ok ? `${authSmoke.sessionRoute} responded ${authSmoke.session.status}` : `${authSmoke.sessionRoute} failed${authSmoke.session?.status ? ` (${authSmoke.session.status})` : ''}`)),
      false,
      authSmoke.session || null
    ));
    checks.push(buildCheck(
      'behavior_smoke_logout',
      'Behavior smoke logout',
      !authSmoke.authPresent || !authSmoke.logoutRoute || !!authSmoke.logout?.ok,
      !authSmoke.authPresent
        ? 'no auth routes detected; logout smoke skipped'
        : (!authSmoke.logoutRoute ? 'logout route not present; skipped' : (authSmoke.logout?.ok ? `${authSmoke.logoutRoute} responded ${authSmoke.logout.status}` : `${authSmoke.logoutRoute} failed${authSmoke.logout?.status ? ` (${authSmoke.logout.status})` : ''}`)),
      false,
      authSmoke.logout || null
    ));

    let browserSmoke = null;
    let browserSmokeUrl = getRuntimeBaseUrl(runtime) ? `${getRuntimeBaseUrl(runtime)}/` : '';
    if (ready && typeof resolveBrowserSmokeUrl === 'function') {
      try {
        browserSmokeUrl = await resolveBrowserSmokeUrl(appId, latest, { runtime, expectedDbMode });
      } catch (error) {
        checks.push(buildCheck(
          'browser_smoke_runtime',
          'Browser smoke runtime available',
          false,
          `browser smoke URL resolution failed: ${String(error?.message || error)}`,
          true
        ));
      }
    }
    if (ready && browserSmokeUrl && typeof runBrowserSmoke === 'function') {
      browserSmoke = await runBrowserSmoke(browserSmokeUrl, {
        budgetMs: 9000,
        settleMs: 1000,
        actionDelayMs: 700,
      });
      if (Array.isArray(browserSmoke?.checks) && browserSmoke.checks.length) {
        checks.push(...browserSmoke.checks);
      } else {
        checks.push(buildCheck(
          'browser_smoke_runtime',
          'Browser smoke runtime available',
          false,
          browserSmoke?.summary || 'browser smoke returned no checks',
          true,
          browserSmoke?.evidence || null
        ));
      }
    } else if (ready) {
      checks.push(buildCheck(
        'browser_smoke_runtime',
        'Browser smoke runtime available',
        false,
        browserSmokeUrl ? 'browser smoke runner is not configured' : 'browser smoke URL is unavailable',
        true
      ));
    }

    const blockingFailures = checks.filter(check => check.blocking && !check.ok);
    const typedBlockingFailures = blockingFailures.map(mapVerifierCheckToFailure);
    const primaryFailure = typedBlockingFailures[0] || null;
    return {
      ok: blockingFailures.length === 0,
      appId,
      versionNumber: latest?.version_number || null,
      runtime: runtime
        ? {
            running: !!runtime.running,
            containerName: runtime.containerName || null,
            ip: runtime.ip || null,
            hostPort: runtime.hostPort || null,
            labels: runtime.labels || null,
          }
        : null,
      health: runtimeHealth || null,
      browserSmoke: browserSmoke || null,
      checks,
      blockingFailures,
      typedBlockingFailures,
      primaryFailure,
      summary: blockingFailures.length === 0
        ? 'release verifier passed'
        : `release verifier failed: ${blockingFailures.map(item => item.id).join(', ')}`,
    };
  }

  return { verifyAppRelease, mapVerifierCheckToFailure };
}

module.exports = { createVerifierModule };
