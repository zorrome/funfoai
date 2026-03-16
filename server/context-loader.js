const fs = require('fs');
const path = require('path');

const CONTEXT_ROOT = path.join(__dirname, 'context');

const USER_CONTEXT_DOCS = [
  { fileName: 'USER.md', blockTitle: 'USER_PROFILE', category: 'identity', limitKey: 'userLimit', defaultLimit: 6000 },
  { fileName: 'PREFERENCES.md', blockTitle: 'USER_PREFERENCES', category: 'preferences', limitKey: 'preferencesLimit', defaultLimit: 4000 },
  { fileName: 'CAPABILITIES.md', blockTitle: 'USER_CAPABILITIES', category: 'capabilities', limitKey: 'capabilitiesLimit', defaultLimit: 4000 },
  { fileName: 'MEMORY.md', blockTitle: 'USER_MEMORY', category: 'memory', limitKey: 'memoryLimit', defaultLimit: 8000 },
];

const APP_CONTEXT_DOCS = [
  { fileName: 'APP_MANIFEST.json', blockTitle: 'APP_MANIFEST', category: 'identity', limitKey: 'manifestLimit', defaultLimit: 8000 },
  { fileName: 'MISSION.md', blockTitle: 'APP_MISSION', category: 'identity', limitKey: 'missionLimit', defaultLimit: 5000 },
  { fileName: 'SOUL.md', blockTitle: 'APP_SOUL', category: 'identity', limitKey: 'soulLimit', defaultLimit: 5000 },
  { fileName: 'STYLE.md', blockTitle: 'APP_STYLE', category: 'identity', limitKey: 'styleLimit', defaultLimit: 4000 },
  { fileName: 'CAPABILITIES.md', blockTitle: 'APP_CAPABILITIES', category: 'capabilities', limitKey: 'capabilitiesLimit', defaultLimit: 6000 },
  { fileName: 'MEMORY.md', blockTitle: 'APP_MEMORY', category: 'memory', limitKey: 'memoryLimit', defaultLimit: 8000 },
  { fileName: 'DECISIONS.md', blockTitle: 'APP_DECISIONS', category: 'memory', limitKey: 'decisionsLimit', defaultLimit: 6000 },
  { fileName: 'FAILURES.md', blockTitle: 'APP_FAILURES', category: 'memory', limitKey: 'failuresLimit', defaultLimit: 6000 },
  { fileName: 'PLAN.md', blockTitle: 'APP_PLAN', category: 'memory', limitKey: 'planLimit', defaultLimit: 5000 },
  { fileName: 'RELEASE_NOTES.md', blockTitle: 'APP_RELEASE_NOTES', category: 'memory', limitKey: 'releaseLimit', defaultLimit: 6000 },
];

function safeRead(filePath, limit = 12000) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return '';
    const text = fs.readFileSync(filePath, 'utf8').trim();
    return text ? text.slice(0, limit) : '';
  } catch {
    return '';
  }
}

function block(title, filePath, limit) {
  const text = safeRead(filePath, limit);
  if (!text) return '';
  return `[${title}]\n${text}`;
}

function limitFor(options, doc) {
  if (!doc) return 6000;
  const raw = options && doc.limitKey ? options[doc.limitKey] : null;
  return Number.isFinite(raw) && raw > 0 ? raw : doc.defaultLimit;
}

function loadContextPack(dir, docs, options = {}) {
  if (!dir) {
    return { dir: null, documents: [], categories: {}, loaded: 0, text: '' };
  }
  const documents = [];
  const categories = {};
  for (const doc of docs || []) {
    const filePath = path.join(dir, doc.fileName);
    const text = safeRead(filePath, limitFor(options, doc));
    if (!text) continue;
    const rendered = `[${doc.blockTitle}]\n${text}`;
    documents.push({
      ...doc,
      filePath,
      text,
      rendered,
    });
    if (!categories[doc.category]) categories[doc.category] = [];
    categories[doc.category].push(rendered);
  }
  const renderedCategories = Object.fromEntries(
    Object.entries(categories).map(([key, blocks]) => [key, blocks.join('\n\n')]),
  );
  return {
    dir,
    documents,
    categories: renderedCategories,
    loaded: documents.length,
    text: documents.map((doc) => doc.rendered).join('\n\n'),
  };
}

function pickPackCategories(pack, categoryKeys = []) {
  if (!pack || !pack.categories) return '';
  return categoryKeys
    .map((key) => pack.categories[key] || '')
    .filter(Boolean)
    .join('\n\n');
}

function getUserContextDir(userId) {
  if (!userId && userId !== 0) return null;
  return path.join(CONTEXT_ROOT, 'users', String(userId));
}

function getAppContextDir(appId) {
  if (!appId && appId !== 0) return null;
  return path.join(CONTEXT_ROOT, 'apps', String(appId));
}

function ensureUserContextDir(userId) {
  const dir = getUserContextDir(userId);
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'skills'), { recursive: true });
  return dir;
}

function ensureAppContextDir(appId) {
  const dir = getAppContextDir(appId);
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'skills'), { recursive: true });
  return dir;
}

function ensureAppMemoryFiles(appId) {
  const dir = ensureAppContextDir(appId);
  if (!dir) return null;
  const defaults = {
    'APP_MANIFEST.json': JSON.stringify({
      appId,
      name: `App-${appId}`,
      runtimeMode: 'local',
      releaseState: 'draft',
      links: {
        preview: null,
        public: null,
      },
      artifacts: {
        frontend: null,
        backend: null,
        schema: null,
      },
      contracts: {
        frontend: [],
        backend: [],
      },
      schema: {
        tables: [],
      },
      updatedAt: null,
    }, null, 2),
    'MISSION.md': `# App ${appId} Mission\n\n- Primary users:\n- Core job to be done:\n- Main workflows:\n- Non-goals:\n`,
    'SOUL.md': `# App ${appId} Soul\n\n- Desired feel:\n- Product personality:\n- UX guardrails:\n`,
    'STYLE.md': `# App ${appId} Style\n\n- Visual direction:\n- Preferred interaction style:\n- Copy tone:\n`,
    'CAPABILITIES.md': `# App ${appId} Capabilities\n\n- Core entities:\n- Core actions:\n- Required integrations:\n- Release-critical flows:\n`,
    'MEMORY.md': `# App ${appId} Memory\n\n- Purpose:\n- Core entities:\n- Core routes:\n- Known pitfalls:\n`,
    'DECISIONS.md': `# App ${appId} Decisions\n\n`,
    'FAILURES.md': `# App ${appId} Failures\n\n`,
    'PLAN.md': `# App ${appId} Plan\n\n- Current focus:\n- Next release target:\n- Open risks:\n`,
    'RELEASE_NOTES.md': `# App ${appId} Release Notes\n\n`,
  };
  for (const [name, content] of Object.entries(defaults)) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) fs.writeFileSync(p, content);
  }
  return dir;
}

function buildUserMemoryContext(userId, options = {}) {
  const pack = buildUserContextPack(userId, options);
  return [
    pickPackCategories(pack, ['identity', 'preferences']),
    pickPackCategories(pack, ['memory']),
  ].filter(Boolean).join('\n\n');
}

function buildAppMemoryContext(appId, options = {}) {
  const pack = buildAppContextPack(appId, options);
  return pickPackCategories(pack, ['memory']);
}

function buildUserContextPack(userId, options = {}) {
  return loadContextPack(getUserContextDir(userId), USER_CONTEXT_DOCS, options);
}

function buildAppContextPack(appId, options = {}) {
  return loadContextPack(getAppContextDir(appId), APP_CONTEXT_DOCS, options);
}

function appendFile(filePath, text) {
  if (!filePath || !text) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, text, 'utf8');
}

function writeFile(filePath, text) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const nextText = String(text || '');
  try {
    if (fs.existsSync(filePath)) {
      const current = fs.readFileSync(filePath, 'utf8');
      if (current === nextText) return;
    }
  } catch {}
  fs.writeFileSync(filePath, nextText, 'utf8');
}

function appendAppMemory(appId, text) {
  const dir = ensureAppMemoryFiles(appId);
  if (!dir || !text) return;
  appendFile(path.join(dir, 'MEMORY.md'), text.endsWith('\n') ? text : `${text}\n`);
}

function appendAppDecisions(appId, text) {
  const dir = ensureAppMemoryFiles(appId);
  if (!dir || !text) return;
  appendFile(path.join(dir, 'DECISIONS.md'), text.endsWith('\n') ? text : `${text}\n`);
}

function appendAppFailures(appId, text) {
  const dir = ensureAppMemoryFiles(appId);
  if (!dir || !text) return;
  appendFile(path.join(dir, 'FAILURES.md'), text.endsWith('\n') ? text : `${text}\n`);
}

function appendAppReleaseNotes(appId, text) {
  const dir = ensureAppMemoryFiles(appId);
  if (!dir || !text) return;
  appendFile(path.join(dir, 'RELEASE_NOTES.md'), text.endsWith('\n') ? text : `${text}\n`);
}

function writeAppPlan(appId, text) {
  const dir = ensureAppMemoryFiles(appId);
  if (!dir) return;
  const body = String(text || '').trim();
  writeFile(path.join(dir, 'PLAN.md'), `${body ? `${body}\n` : ''}`);
}

function writeAppContextManifest(appId, manifest) {
  const dir = ensureAppMemoryFiles(appId);
  if (!dir) return;
  const payload = manifest && typeof manifest === 'object' ? manifest : {};
  writeFile(path.join(dir, 'APP_MANIFEST.json'), `${JSON.stringify(payload, null, 2)}\n`);
}

module.exports = {
  CONTEXT_ROOT,
  getUserContextDir,
  getAppContextDir,
  ensureUserContextDir,
  ensureAppContextDir,
  ensureAppMemoryFiles,
  buildUserContextPack,
  buildAppContextPack,
  buildUserMemoryContext,
  buildAppMemoryContext,
  appendAppMemory,
  appendAppDecisions,
  appendAppFailures,
  appendAppReleaseNotes,
  writeAppPlan,
  writeAppContextManifest,
};
