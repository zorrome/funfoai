const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createDocsModule(deps) {
  const {
    db,
    getAppDir,
    extractBackendApiContracts,
    extractFrontendApiContracts,
    extractSqlTables,
    buildWorkspacePreviewPath,
    buildWorkspacePublicPath,
    writeAppContextManifest,
  } = deps;

  function getDocsDir(appId) {
    const dir = path.join(getAppDir(appId), 'docs');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function getAppSpecPath(appId) {
    return path.join(getDocsDir(appId), 'APP_SPEC.md');
  }

  function getApiContractPath(appId) {
    return path.join(getDocsDir(appId), 'API_CONTRACT.md');
  }

  function getDbSchemaPath(appId) {
    return path.join(getDocsDir(appId), 'DB_SCHEMA.md');
  }

  function getAppManifestPath(appId) {
    return path.join(getDocsDir(appId), 'APP_MANIFEST.json');
  }

  function readAppSpec(appId) {
    try {
      const p = getAppSpecPath(appId);
      if (!fs.existsSync(p)) return '';
      return fs.readFileSync(p, 'utf8');
    } catch {
      return '';
    }
  }

  function readApiContract(appId) {
    try {
      const p = getApiContractPath(appId);
      if (!fs.existsSync(p)) return '';
      return fs.readFileSync(p, 'utf8');
    } catch {
      return '';
    }
  }

  function readDbSchemaDoc(appId) {
    try {
      const p = getDbSchemaPath(appId);
      if (!fs.existsSync(p)) return '';
      return fs.readFileSync(p, 'utf8');
    } catch {
      return '';
    }
  }

  function buildAppManifest(appId, {
    appRow = null,
    appName = '',
    versionNumber = null,
    frontendCode = '',
    serverCode = '',
    sqlCode = '',
    updatedAt = null,
  } = {}) {
    const row = appRow || (db ? db.prepare('SELECT * FROM apps WHERE id = ?').get(appId) : null);
    const workspaceSlug = row?.workspace_slug || null;
    const frontendContracts = extractFrontendApiContracts(frontendCode || '').map((item) => ({
      method: item.method,
      path: item.path,
      expect: item.expect,
    }));
    const backendContracts = [...extractBackendApiContracts(serverCode || '')]
      .sort()
      .map((entry) => {
        const idx = entry.indexOf(' ');
        return idx > 0 ? { method: entry.slice(0, idx), path: entry.slice(idx + 1) } : { method: 'GET', path: entry };
      });
    return {
      appId,
      name: appName || row?.name || `App-${appId}`,
      description: row?.description || '',
      workspaceSlug,
      runtimeMode: row?.runtime_mode || 'local',
      releaseState: row?.release_state || row?.publish_status || 'draft',
      appRole: row?.app_role || 'release',
      versionNumber: versionNumber ?? row?.current_version ?? null,
      links: {
        preview: workspaceSlug ? buildWorkspacePreviewPath(workspaceSlug) : null,
        public: workspaceSlug ? buildWorkspacePublicPath(workspaceSlug) : null,
      },
      artifacts: {
        frontend: {
          file: 'App.jsx',
          sha256: sha256(frontendCode),
          bytes: Buffer.byteLength(String(frontendCode || ''), 'utf8'),
        },
        backend: {
          file: 'server.js',
          sha256: sha256(serverCode),
          bytes: Buffer.byteLength(String(serverCode || ''), 'utf8'),
        },
        schema: {
          file: 'schema.sql',
          sha256: sha256(sqlCode),
          bytes: Buffer.byteLength(String(sqlCode || ''), 'utf8'),
        },
      },
      contracts: {
        frontend: frontendContracts,
        backend: backendContracts,
      },
      schema: {
        tables: extractSqlTables(sqlCode || ''),
      },
      updatedAt: updatedAt || row?.updated_at || new Date().toISOString(),
    };
  }

  function writeAppManifest(appId, payload = {}) {
    const manifest = buildAppManifest(appId, payload);
    const p = getAppManifestPath(appId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const nextText = `${JSON.stringify(manifest, null, 2)}\n`;
    try {
      if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== nextText) {
        fs.writeFileSync(p, nextText);
      }
    } catch {
      fs.writeFileSync(p, nextText);
    }
    if (typeof writeAppContextManifest === 'function') {
      writeAppContextManifest(appId, manifest);
    }
    return manifest;
  }

  function getModeDocPath(appId, name) {
    return path.join(getDocsDir(appId), name);
  }

  function writeModeDoc(appId, name, content = '') {
    const p = getModeDocPath(appId, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(content || '').trim() + '\n');
  }

  function readModeDoc(appId, name) {
    try {
      const p = getModeDocPath(appId, name);
      if (!fs.existsSync(p)) return '';
      return fs.readFileSync(p, 'utf8');
    } catch {
      return '';
    }
  }

  function updateWorkspaceModeDocs(appId, mode, { appName = '', userMessage = '', frontendCode = '', serverCode = '', sqlCode = '', versionNumber = null } = {}) {
    const modeUpper = String(mode || '').toUpperCase();
    const lines = [
      `# ${modeUpper}_NOTES - ${appName || `App-${appId}`}`,
      `app_id: ${appId}`,
      versionNumber ? `version: ${versionNumber}` : null,
      `updated_at: ${new Date().toISOString()}`,
      '',
      '## User intent',
      userMessage ? `- ${String(userMessage).trim()}` : '- none',
      '',
      '## Current artifacts',
      `- frontend_lines: ${String(frontendCode || '').split(/\r?\n/).filter(Boolean).length}`,
      `- backend_routes: ${[...extractBackendApiContracts(serverCode || '')].length}`,
      `- db_tables: ${extractSqlTables(sqlCode || '').length}`,
      '',
    ].filter(Boolean);

    if (mode === 'create') {
      lines.push('## Create intent', '- Define the first workable version of the app.', '- Keep this as a lightweight handoff, not a hard constraint.');
      writeModeDoc(appId, 'CREATE_NOTES.md', lines.join('\n'));
    } else if (mode === 'edit') {
      lines.push('## Edit intent', '- Preserve existing behavior unless explicitly changed.', '- Prefer safe incremental evolution.');
      writeModeDoc(appId, 'EDIT_NOTES.md', lines.join('\n'));
    } else if (mode === 'rewrite') {
      lines.push('## Rewrite intent', '- Preserve business goals, but allow structural redesign.', '- Existing implementation is reference, not a line-by-line contract.');
      writeModeDoc(appId, 'REWRITE_BRIEF.md', lines.join('\n'));
    }
  }

  function writeReleaseNotes(appId, { appName = '', sourceMode = 'edit', releaseAppId = null, userMessage = '', versionNumber = null } = {}) {
    const content = [
      `# RELEASE_NOTES - ${appName || `App-${appId}`}`,
      `app_id: ${appId}`,
      releaseAppId ? `release_app_id: ${releaseAppId}` : null,
      versionNumber ? `version: ${versionNumber}` : null,
      `source_mode: ${sourceMode}`,
      `updated_at: ${new Date().toISOString()}`,
      '',
      '## Release summary',
      userMessage ? `- Latest intent: ${String(userMessage).trim()}` : '- Latest intent: not recorded',
      '- This document is the handoff from workspace modes to Release mode.',
      '- Use APP_SPEC / API_CONTRACT / DB_SCHEMA as source of truth for delivery checks.',
      ''
    ].filter(Boolean).join('\n');
    writeModeDoc(appId, 'RELEASE_NOTES.md', content);
  }

  function writeReleaseReport(appId, { appName = '', status = 'completed', releaseAppId = null, releaseVersion = null, summary = '', error = '' } = {}) {
    const content = [
      `# RELEASE_REPORT - ${appName || `App-${appId}`}`,
      `app_id: ${appId}`,
      releaseAppId ? `release_app_id: ${releaseAppId}` : null,
      releaseVersion ? `release_version: ${releaseVersion}` : null,
      `status: ${status}`,
      `updated_at: ${new Date().toISOString()}`,
      '',
      '## Result',
      summary ? `- ${summary}` : `- Release ${status}`,
      error ? `- Error: ${error}` : null,
      ''
    ].filter(Boolean).join('\n');
    writeModeDoc(appId, 'RELEASE_REPORT.md', content);
  }

  function sha256(value = '') {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
  }

  function writeReleaseManifest(appId, {
    appName = '',
    releaseAppId = null,
    releaseVersion = null,
    frontendCode = '',
    serverCode = '',
    sqlCode = '',
    verification = null,
    runtime = null,
    previewSlug = '',
    sourceAppId = null,
    backendReuseMeta = null,
  } = {}) {
    const manifest = {
      appId,
      appName: appName || `App-${appId}`,
      releaseAppId,
      sourceAppId,
      releaseVersion,
      previewSlug: previewSlug || null,
      generatedAt: new Date().toISOString(),
      artifacts: {
        frontend: { file: 'App.jsx', sha256: sha256(frontendCode), bytes: Buffer.byteLength(String(frontendCode || ''), 'utf8') },
        backend: { file: 'server.js', sha256: sha256(serverCode), bytes: Buffer.byteLength(String(serverCode || ''), 'utf8') },
        schema: { file: 'schema.sql', sha256: sha256(sqlCode), bytes: Buffer.byteLength(String(sqlCode || ''), 'utf8') },
      },
      runtime: runtime ? {
        containerName: runtime.containerName || null,
        ip: runtime.ip || null,
        labels: runtime.labels || null,
        running: !!runtime.running,
      } : null,
      verification: verification ? {
        ok: !!verification.ok,
        summary: verification.summary || '',
        primaryFailure: verification.primaryFailure || null,
        blockingFailures: Array.isArray(verification.blockingFailures) ? verification.blockingFailures.map(item => ({
          id: item.id,
          label: item.label,
          detail: item.detail,
        })) : [],
        typedBlockingFailures: Array.isArray(verification.typedBlockingFailures) ? verification.typedBlockingFailures : [],
        checks: Array.isArray(verification.checks) ? verification.checks.map(item => ({
          id: item.id,
          ok: !!item.ok,
          detail: item.detail,
        })) : [],
      } : null,
      backendReuse: backendReuseMeta || null,
    };
    writeModeDoc(appId, 'RELEASE_MANIFEST.json', JSON.stringify(manifest, null, 2));
    return manifest;
  }

  function writeCreateProposalDocs(appId, { appName = '', versionNumber = null, frontendCode = '', serverCode = '', sqlCode = '' } = {}) {
    const backendRoutes = [...extractBackendApiContracts(serverCode || '')].sort();
    const frontendApis = extractFrontendApiContracts(frontendCode || '').map(x => `${x.method} ${x.path}`).sort();
    const tables = extractSqlTables(sqlCode || '');
    const proposal = [
      `# CREATE_PROPOSAL - ${appName || `App-${appId}`}`,
      `app_id: ${appId}`,
      versionNumber ? `version: ${versionNumber}` : null,
      `updated_at: ${new Date().toISOString()}`,
      '',
      '## Important note',
      '- This file records optional backend / DB ideas produced during Create mode.',
      '- These are proposals, not guaranteed implemented runtime artifacts.',
      '',
      '## Proposed backend routes',
      ...(backendRoutes.length ? backendRoutes.map(x => `- ${x}`) : ['- none']),
      '',
      '## Frontend API usage',
      ...(frontendApis.length ? frontendApis.map(x => `- ${x}`) : ['- none']),
      '',
      '## Proposed DB tables',
      ...(tables.length ? tables.map(x => `- ${x}`) : ['- none']),
      '',
      '## Proposed schema',
      '```sql',
      String(sqlCode || '').trim() || '-- no schema proposal',
      '```',
      ''
    ].filter(Boolean).join('\n');
    writeModeDoc(appId, 'CREATE_PROPOSAL.md', proposal);
  }

  function writeApiAndDbDocs(appId, appName, versionNumber, frontendCode = '', serverCode = '', sqlCode = '') {
    const apiPath = getApiContractPath(appId);
    const dbPath = getDbSchemaPath(appId);
    const apis = [...extractBackendApiContracts(serverCode || '')].sort();
    const fetches = extractFrontendApiContracts(frontendCode || '').map(x => `${x.method} ${x.path}`).sort();
    const missing = extractFrontendApiContracts(frontendCode || '').filter(x => !extractBackendApiContracts(serverCode || '').has(`${x.method} ${x.path}`));
    const apiText = [
      `# API_CONTRACT - ${appName || `App-${appId}`}`,
      `app_id: ${appId}`,
      `version: ${versionNumber}`,
      `updated_at: ${new Date().toISOString()}`,
      '',
      '## Backend routes',
      ...(apis.length ? apis.map(x => `- ${x}`) : ['- none']),
      '',
      '## Frontend API usage',
      ...(fetches.length ? fetches.map(x => `- ${x}`) : ['- none']),
      '',
      '## Contract diff (frontend used but backend missing)',
      ...(missing.length ? missing.map(x => `- ${x.method} ${x.path}`) : ['- none']),
      ''
    ].join('\n');

    const dbText = [
      `# DB_SCHEMA - ${appName || `App-${appId}`}`,
      `app_id: ${appId}`,
      `version: ${versionNumber}`,
      `updated_at: ${new Date().toISOString()}`,
      '',
      '## SQL schema (latest)',
      '```sql',
      String(sqlCode || '').trim() || '-- no schema provided',
      '```',
      '',
      '## Tables',
      ...(extractSqlTables(sqlCode || '').map(t => `- ${t}`) || ['- none']),
      ''
    ].join('\n');

    fs.mkdirSync(path.dirname(apiPath), { recursive: true });
    fs.writeFileSync(apiPath, apiText);
    fs.writeFileSync(dbPath, dbText);
    writeAppManifest(appId, {
      appName,
      versionNumber,
      frontendCode,
      serverCode,
      sqlCode,
    });
    mirrorDocIntoDocsDir(apiPath);
    mirrorDocIntoDocsDir(dbPath);
  }

  function appendAppSpecSnapshot(appId, appName, versionNumber, frontendCode = '', serverCode = '', sqlCode = '') {
    const p = getAppSpecPath(appId);
    const now = new Date().toISOString();
    const apis = [...extractBackendApiContracts(serverCode || '')];
    const fetches = extractFrontendApiContracts(frontendCode || '').map(x => `${x.method} ${x.path}`);
    const tables = extractSqlTables(sqlCode || '');

    const section = [
      `\n## Version ${versionNumber} (${now})`,
      `- App: ${appName || `App-${appId}`}`,
      `- Functional summary: ${String(frontendCode || '').slice(0, 240).replace(/\s+/g, ' ')}`,
      `- API routes (${apis.length}): ${apis.slice(0, 20).join(', ') || 'none'}`,
      `- Frontend API usage (${fetches.length}): ${fetches.slice(0, 20).join(', ') || 'none'}`,
      `- Data tables: ${tables.join(', ') || 'none'}`,
      '- Iteration policy: keep old features/data compatible; only additive DB migration.',
      ''
    ].join('\n');

    if (!fs.existsSync(path.dirname(p))) fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p)) {
      const head = [
        `# APP_SPEC - ${appName || `App-${appId}`}`,
        `app_id: ${appId}`,
        '',
        '## Purpose',
        '- This document is the stable baseline for future iterations.',
        '- Iteration MUST read this spec before modifying code.',
        ''
      ].join('\n');
      fs.writeFileSync(p, head + section);
    } else {
      fs.appendFileSync(p, section);
    }
    mirrorDocIntoDocsDir(p);
  }

  return {
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
  };
}

module.exports = { createDocsModule };
