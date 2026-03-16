function createValidationModule(deps) {
  const {
    babel,
    BABEL_PRESET_REACT,
    lintSqlDialect,
    dryRunSqlSchema,
    extractFrontendApiContracts,
    extractBackendApiContracts,
    evaluateStaticStringExpression: suppliedEvaluateStaticStringExpression,
    looksLikeStaticSqlText: suppliedLooksLikeStaticSqlText,
  } = deps;

  function looksLikeStaticSqlText(value = '') {
    if (typeof suppliedLooksLikeStaticSqlText === 'function') {
      return suppliedLooksLikeStaticSqlText(value);
    }
    return /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH|PRAGMA)\b/i.test(String(value || ''));
  }

  function evaluateStaticStringExpression(expr = '') {
    if (typeof suppliedEvaluateStaticStringExpression === 'function') {
      return suppliedEvaluateStaticStringExpression(expr);
    }
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
            visitor({ argExpr: src.slice(argsStart, i) });
            break;
          }
        }
      }
      cursor = i + 1;
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

  function findUndefinedJsxComponents(frontendCode = '') {
    const src = String(frontendCode || '');
    const jsxTags = new Set();
    const tagRe = /<([A-Z][A-Za-z0-9_]*)\b/g;
    let m;
    while ((m = tagRe.exec(src)) !== null) jsxTags.add(m[1]);

    const declared = new Set(['App']);
    const fnRe = /function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g;
    while ((m = fnRe.exec(src)) !== null) declared.add(m[1]);
    const constCompRe = /const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:\([^)]*\)\s*=>|function\s*\()/g;
    while ((m = constCompRe.exec(src)) !== null) declared.add(m[1]);

    const allowedGlobal = new Set([
      'BarChart', 'Bar', 'LineChart', 'Line', 'AreaChart', 'Area',
      'PieChart', 'Pie', 'Cell', 'XAxis', 'YAxis', 'CartesianGrid',
      'Tooltip', 'Legend', 'ResponsiveContainer', 'RadarChart', 'Radar',
      'PolarGrid', 'PolarAngleAxis', 'ComposedChart'
    ]);

    const unknown = [...jsxTags].filter(t => !declared.has(t) && !allowedGlobal.has(t));
    return unknown;
  }

  function validateFrontendOnlyArtifacts(frontendCode = '') {
    const errors = [];
    const src = String(frontendCode || '');
    if (/^\s*import\s/m.test(src)) errors.push('JSX must not contain import statements');
    if (/export\s+default|export\s+function|export\s*\{/.test(src)) errors.push('JSX must not contain export statements');
    if (/React\.Fragment|<\s*Fragment\b|<\s*React\.Fragment\b/.test(src)) {
      errors.push('JSX must not use React.Fragment/Fragment; use a real DOM container instead');
    }
    if (/<\s*(html|head|body)\b/i.test(src)) errors.push('JSX must not contain full-document html/head/body tags');
    if (!/function\s+App\s*\(/.test(src)) errors.push('JSX must define function App()');
    const unknownJsx = findUndefinedJsxComponents(src);
    if (unknownJsx.length) errors.push(`JSX undefined components: ${unknownJsx.slice(0, 8).join(', ')}`);
    try {
      babel.transformSync(`function __tmp(){${src}\n}`, { presets: [BABEL_PRESET_REACT], filename: 'PhaseCheck.jsx' });
    } catch (e) {
      const msg = String(e?.message || e || '');
      errors.push(`JSX compile check failed: ${msg.slice(0, 120)}`);
    }
    return { ok: errors.length === 0, errors };
  }

  function inferWorkspaceIterationProfile({ message = '', runtimeMode = 'local', appStatus = 'draft' } = {}) {
    const text = String(message || '').toLowerCase();
    const uiKeywords = ['ui', 'ux', '页面', '画面', '布局', 'レイアウト', '样式', 'スタイル', '按钮', 'ボタン', '颜色', '色', '文案', '表单', 'フォーム', '列表', 'カード', 'table', 'modal', 'dialog'];
    const backendKeywords = ['/api', 'api', 'backend', 'sql', 'database', 'db', 'schema', 'migration', 'route', 'server', 'sqlite'];
    const uiFocused = uiKeywords.some(k => text.includes(k)) && !backendKeywords.some(k => text.includes(k));
    const localWorkspace = runtimeMode === 'local' || !['live'].includes(String(appStatus || 'draft'));
    return {
      localWorkspace,
      uiFocused,
      skipEnhancementPass: localWorkspace && uiFocused,
      preferEarlyGuard: localWorkspace,
    };
  }

  function estimateLineChangeRatio(prevCode = '', nextCode = '') {
    const a = String(prevCode || '').split('\n');
    const b = String(nextCode || '').split('\n');
    const total = Math.max(a.length, b.length, 1);
    let changed = 0;
    for (let i = 0; i < total; i++) {
      if ((a[i] || '') !== (b[i] || '')) changed++;
    }
    return changed / total;
  }

  function inferAllowedChangeRatio(userMessage = '') {
    const text = String(userMessage || '').trim();
    if (!text) return 0.35;
    const simpleKeywords = [
      '增加', '加一个', '新增', '改一下', '调整', '优化', '修复', 'fix', 'bug', '文案', '颜色', '按钮', '夜间模式', '深夜模式'
    ];
    const isSimple = text.length <= 80 || simpleKeywords.some(k => text.includes(k));
    return isSimple ? 0.22 : 0.35;
  }

  function extractStableIdentifiers(code = '') {
    const src = String(code || '');
    const out = new Set();
    const re = /(?:const|let|function)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const k = m[1];
      if (!k) continue;
      if (['App', 'asArray'].includes(k)) continue;
      if (k.length < 3) continue;
      out.add(k);
    }
    return Array.from(out).slice(0, 40);
  }

  function hasStructuralOverlap(prevCode = '', nextCode = '', minKeepRatio = 0.35) {
    const ids = extractStableIdentifiers(prevCode);
    if (ids.length === 0) return true;
    const next = String(nextCode || '');
    let kept = 0;
    for (const id of ids) {
      if (new RegExp(`\\b${id}\\b`).test(next)) kept++;
    }
    return (kept / ids.length) >= minKeepRatio;
  }

  function validateWorkspaceIterationEarly({ frontendCode = '', previousFrontendCode = '', userMessage = '' } = {}) {
    const errors = [];
    const base = validateFrontendOnlyArtifacts(frontendCode);
    if (!base.ok) errors.push(...base.errors);

    const next = String(frontendCode || '');
    const prev = String(previousFrontendCode || '');
    if (prev.trim()) {
      const maxRatio = inferAllowedChangeRatio(userMessage);
      const ratio = estimateLineChangeRatio(prev, next);
      const overlapOk = hasStructuralOverlap(prev, next, 0.3);
      if (ratio > Math.max(maxRatio + 0.2, 0.55) && !overlapOk) {
        errors.push(`Workspace iteration guard: destructive rewrite detected (change ratio ${(ratio * 100).toFixed(0)}%)`);
      }
    }

    return { ok: errors.length === 0, errors };
  }

  function isIncrementalChangePreferred(prevCode = '', nextCode = '', maxRatio = 0.35) {
    if (!String(prevCode || '').trim()) return true;
    const ratio = estimateLineChangeRatio(prevCode, nextCode);
    return ratio <= maxRatio;
  }

  function findConcatenatedSqlIssues(serverCode = '') {
    const src = String(serverCode || '');
    const issues = [];
    const sqlBindings = new Map();
    const variableSqlDecl = [...src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);/g)];
    for (const [, name, expr] of variableSqlDecl) {
      const value = evaluateStaticStringExpression(expr);
      if (value != null && looksLikeStaticSqlText(value)) {
        sqlBindings.set(name, value);
      }
    }

    walkDbPrepareCalls(src, ({ argExpr }) => {
      const trimmed = String(argExpr || '').trim();
      if (!trimmed || !trimmed.includes('+')) return;
      const staticValue = evaluateStaticStringExpression(trimmed);
      if (staticValue != null && looksLikeStaticSqlText(staticValue)) return;
      issues.push('Backend SQL must not use JavaScript string concatenation inside db.prepare(); use one complete SQLite query string.');
    });

    for (const [, name, expr] of variableSqlDecl) {
      if (!expr.includes('+')) continue;
      if (!new RegExp(`db\\.prepare\\(\\s*${name}\\s*\\)`).test(src)) continue;
      if (sqlBindings.has(name)) continue;
      issues.push(`Backend SQL variable "${name}" is built by concatenation before db.prepare(); use one complete SQL string instead.`);
    }
    return [...new Set(issues)];
  }

  function validateGeneratedArtifacts(frontendCode = '', serverCode = '', sqlCode = '', prev = null) {
    const errors = [];

    const sqlIssues = lintSqlDialect(sqlCode);
    if (sqlIssues.length) errors.push(...sqlIssues.map(s => `SQL lint: ${s}`));

    const dry = dryRunSqlSchema(sqlCode);
    if (!dry.ok) errors.push(`SQL dry-run failed: ${dry.error}`);

    const backendSqlIssues = findConcatenatedSqlIssues(serverCode);
    if (backendSqlIssues.length) errors.push(...backendSqlIssues);

    const sqliteLiteralIssues = findSqliteLiteralIssues(serverCode);
    if (sqliteLiteralIssues.length) errors.push(...sqliteLiteralIssues);

    const wanted = extractFrontendApiContracts(frontendCode);
    const have = extractBackendApiContracts(serverCode);
    const miss = wanted.filter(c => !have.has(`${c.method} ${c.path}`));
    if (miss.length) {
      errors.push(`Backend missing ${miss.length} API contract(s): ${miss.slice(0, 4).map(m => `${m.method} ${m.path}`).join(', ')}`);
    }

    if (!/const\s+asArray\s*=|function\s+asArray\s*\(/.test(String(frontendCode || ''))) {
      errors.push('Dev stability gate: frontend must include asArray helper');
    }

    if (/React\.Fragment|<\s*Fragment\b|<\s*React\.Fragment\b/.test(String(frontendCode || ''))) {
      errors.push('JSX must not use React.Fragment/Fragment; use a real DOM container instead');
    }

    const unknownJsx = findUndefinedJsxComponents(frontendCode);
    if (unknownJsx.length) {
      errors.push(`JSX undefined components: ${unknownJsx.slice(0, 8).join(', ')}`);
    }

    if (prev && (prev.frontendCode || prev.serverCode || prev.sqlCode)) {
      const oldApis = extractBackendApiContracts(prev.serverCode || '');
      const newApis = extractBackendApiContracts(serverCode || '');
      const removedApis = [...oldApis].filter(k => !newApis.has(k));
      if (removedApis.length) {
        errors.push(`Iteration guard: removed existing API routes (${removedApis.slice(0, 6).join(', ')})`);
      }

      const sqlUpper = String(sqlCode || '').toUpperCase();
      if (/\bDROP\s+TABLE\b/.test(sqlUpper) || /\bDROP\s+COLUMN\b/.test(sqlUpper)) {
        errors.push('Iteration guard: destructive SQL (DROP TABLE/COLUMN) is not allowed');
      }
    }

    return { ok: errors.length === 0, errors };
  }

  return {
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
  };
}

module.exports = { createValidationModule };
