const fs = require('fs');
const path = require('path');
const {
  PLATFORM_KERNEL_PROMPT,
  GLOBAL_CONTEXT_PROMPT,
} = require('./prompts');
const {
  CONTEXT_ROOT,
  buildUserContextPack,
  buildAppContextPack,
} = require('./context-loader');

const ORCHESTRATION_LAYER_PROMPT = `<orchestration_layers>
Treat the prompt as a layered operating system, not a flat instruction blob.

Priority order when instructions conflict:
1. platform system rules
2. engineering and runtime rules
3. active agent role
4. app mission and app capabilities
5. app decisions and failure history
6. user preferences
7. ambient memory and historical notes

How to use the layers:
- System/dev layers define the hard boundaries. Do not violate them.
- Soul/app identity layers define the product taste and should shape default choices.
- Agent layers define the current job. Stay in role.
- Decisions are stronger than generic memory. Preserve them unless the user explicitly overrides them.
- Failures are anti-pattern memory: do not repeat them.
- Plans are directional hints, not commands. Update your approach if the user asks for something new.

As a vibe coding platform:
- compress vague intent into a clear product structure quickly
- shorten time-to-first-working-app
- keep continuity across iterations
- favor explicit entities, flows, and contracts over hidden magic
</orchestration_layers>`;

function trimText(text, limit = 12000) {
  const value = String(text || '').trim();
  return value ? value.slice(0, limit) : '';
}

function block(title, body) {
  const text = trimText(body, 20000);
  if (!text) return '';
  return `[${title}]\n${text}`;
}

function readContextFile(relPath, limit = 6000) {
  try {
    const abs = path.join(CONTEXT_ROOT, relPath);
    if (!fs.existsSync(abs)) return '';
    return trimText(fs.readFileSync(abs, 'utf8'), limit);
  } catch {
    return '';
  }
}

function normalizeExtraSection(section) {
  if (!section) return '';
  if (typeof section === 'string') return trimText(section, 12000);
  if (section && typeof section === 'object' && section.title && section.content) {
    return block(section.title, section.content);
  }
  return '';
}

function renderPackLayer(layerTitle, pack, categories = []) {
  if (!pack || !pack.categories) return '';
  const blocks = categories
    .map((category) => pack.categories[category] || '')
    .filter(Boolean);
  if (!blocks.length) return '';
  return `[${layerTitle}]\n${blocks.join('\n\n')}`;
}

function inferAgentFiles(surface, requestedMode) {
  if (surface === 'release') return ['agents/release-agent.md', 'agents/review-agent.md'];
  if (surface === 'repair' || surface === 'auto_fix') return ['agents/repair-agent.md', 'agents/review-agent.md'];
  if (surface === 'workspace' && requestedMode === 'create') return ['agents/planner-agent.md', 'agents/workspace-agent.md'];
  if (surface === 'workspace') return ['agents/workspace-agent.md'];
  return ['agents/workspace-agent.md'];
}

function buildActiveAgentLayer(surface, requestedMode) {
  const files = inferAgentFiles(surface, requestedMode);
  const blocks = files
    .map((relPath) => {
      const text = readContextFile(relPath, 5000);
      if (!text) return '';
      return `[${relPath}]\n${text}`;
    })
    .filter(Boolean);
  if (!blocks.length) return '';
  return `[ACTIVE_AGENT_LAYER]\n${blocks.join('\n\n')}`;
}

function buildObjectiveLayer(surface, requestedMode) {
  const mode = String(requestedMode || '').toLowerCase();
  if (surface === 'release') {
    return block('CURRENT_OBJECTIVE', `Current surface: RELEASE.\nGenerate internally consistent release artifacts that can survive verifier checks and preserve the app's core business loops.`);
  }
  if (surface === 'repair' || surface === 'auto_fix') {
    return block('CURRENT_OBJECTIVE', `Current surface: REPAIR.\nFix the exact problem with the smallest safe change, preserve user-visible intent, and avoid repeating known failure patterns.`);
  }
  if (mode === 'create') {
    return block('CURRENT_OBJECTIVE', `Current surface: WORKSPACE CREATE.\nTurn the user's idea into a sharp first working app with stable entities, clear flows, and a short path to success.`);
  }
  if (mode === 'rewrite') {
    return block('CURRENT_OBJECTIVE', `Current surface: WORKSPACE REWRITE.\nPreserve business intent while allowing larger structural redesign for clarity, maintainability, and stronger product coherence.`);
  }
  return block('CURRENT_OBJECTIVE', `Current surface: WORKSPACE EDIT.\nPreserve the existing app and make the smallest coherent change that satisfies the latest request without breaking prior capability.`);
}

function buildRuntimeLayer({ surface, requestedMode, runtimeMode, appStatus, appRow }) {
  const lines = [
    `surface=${String(surface || 'workspace').toUpperCase()}`,
    `requested_mode=${String(requestedMode || 'edit').toUpperCase()}`,
  ];
  if (runtimeMode) lines.push(`runtime_mode=${String(runtimeMode).toUpperCase()}`);
  if (appStatus) lines.push(`app_status=${String(appStatus).toUpperCase()}`);
  if (appRow && appRow.id != null) lines.push(`app_id=${Number(appRow.id)}`);
  if (appRow && appRow.name) lines.push(`app_name=${String(appRow.name)}`);
  if (appRow && appRow.release_state) lines.push(`release_state=${String(appRow.release_state).toUpperCase()}`);
  if (appRow && appRow.app_stage) lines.push(`app_stage=${String(appRow.app_stage).toUpperCase()}`);
  if (appRow && appRow.current_version != null) lines.push(`current_version=v${Number(appRow.current_version || 0)}`);
  return block('RUNTIME_CONTEXT', lines.join('\n'));
}

function resolvePacks({ userId, appId, userContextPack, appContextPack }) {
  return {
    userPack: userContextPack || (userId || userId === 0 ? buildUserContextPack(userId) : null),
    appPack: appContextPack || (appId || appId === 0 ? buildAppContextPack(appId) : null),
  };
}

function buildLayeredSystemPrompt(options = {}) {
  const {
    surface = 'workspace',
    requestedMode = 'edit',
    runtimeMode = 'local',
    appStatus = 'draft',
    appRow = null,
    userId = null,
    appId = null,
    userContextPack = null,
    appContextPack = null,
    schemaDiffContext = '',
    extraSections = [],
  } = options;
  const { userPack, appPack } = resolvePacks({ userId, appId, userContextPack, appContextPack });
  const sections = [
    PLATFORM_KERNEL_PROMPT,
    block('ORCHESTRATION_LAYER_RULES', ORCHESTRATION_LAYER_PROMPT),
    GLOBAL_CONTEXT_PROMPT,
    buildObjectiveLayer(surface, requestedMode),
    buildRuntimeLayer({ surface, requestedMode, runtimeMode, appStatus, appRow }),
    buildActiveAgentLayer(surface, requestedMode),
    renderPackLayer('USER_CONTEXT_LAYER', userPack, ['identity', 'preferences', 'capabilities', 'memory']),
    renderPackLayer('APP_IDENTITY_LAYER', appPack, ['identity', 'capabilities']),
    renderPackLayer('APP_MEMORY_LAYER', appPack, ['memory']),
    schemaDiffContext ? block('SCHEMA_DIFF_WARNING', trimText(schemaDiffContext, 12000)) : '',
    ...extraSections.map(normalizeExtraSection),
  ].filter(Boolean);
  return sections.join('\n\n');
}

function buildWorkspaceSystemPrompt(options = {}) {
  return buildLayeredSystemPrompt({
    ...options,
    surface: 'workspace',
  });
}

function buildReleaseSystemPrompt(options = {}) {
  return buildLayeredSystemPrompt({
    ...options,
    surface: 'release',
  });
}

function buildRepairSystemPrompt(options = {}) {
  return buildLayeredSystemPrompt({
    ...options,
    surface: options.surface === 'auto_fix' ? 'auto_fix' : 'repair',
  });
}

module.exports = {
  buildLayeredSystemPrompt,
  buildWorkspaceSystemPrompt,
  buildReleaseSystemPrompt,
  buildRepairSystemPrompt,
};
