const {
  CREATE_MODE_PROMPT,
  EDIT_MODE_PROMPT,
  EDIT_FRONTEND_FIRST_PROMPT,
  REWRITE_MODE_PROMPT,
  REPAIR_ROLE_PROMPT,
} = require('../prompts');
const {
  buildWorkspaceSystemPrompt,
  buildRepairSystemPrompt,
} = require('../prompt-orchestrator');

function buildWorkspaceHistory({
  requestedMode,
  rawHistory,
  userDisplay,
  appRow,
  originalFrontendBase,
  appSpec,
  apiContract,
  dbSchemaDoc,
  readModeDoc,
  normalizeMessageForModel,
  schemaDiffContext,
}) {
  const history = (() => {
    const latestUser = { role: 'user', content: normalizeMessageForModel(userDisplay) };
    if (requestedMode === 'create') {
      const createNotes = readModeDoc(appRow.id, 'CREATE_NOTES.md');
      return [
        ...(createNotes ? [{ role: 'system', content: `[CREATE_NOTES]\n${createNotes.slice(0, 8000)}` }] : []),
        latestUser,
      ];
    }
    if (requestedMode === 'rewrite') {
      const rewriteBrief = readModeDoc(appRow.id, 'REWRITE_BRIEF.md');
      const recent = rawHistory.filter(m => m.role === 'user' || m.role === 'assistant').slice(-6);
      return [
        ...(rewriteBrief ? [{ role: 'system', content: `[REWRITE_BRIEF]\n${rewriteBrief.slice(0, 8000)}` }] : []),
        ...recent,
        latestUser,
      ];
    }
    const recent = rawHistory.filter(m => m.role === 'user' || m.role === 'assistant').slice(-12);
    return recent.length ? recent : [latestUser];
  })();

  history.unshift({
    role: 'system',
    content: `[WORKSPACE_MODE]\nCurrent workspace generation mode: ${requestedMode.toUpperCase()}. Keep this mode isolated from other roles.`,
  });

  if (requestedMode === 'edit' && String(appRow.name || '').includes('（コピー）')) {
    history.unshift({
      role: 'system',
      content: '[CLONED_APP_ITERATION_RULE]\nThis app is a cloned copy. Treat user requests as incremental edits on top of existing app. Do not replace whole app scope unless user explicitly asks for full redesign/rebuild.',
    });
  }

  if (schemaDiffContext && (requestedMode === 'edit' || requestedMode === 'rewrite')) {
    history.unshift({
      role: 'system',
      content: `[SCHEMA_DIFF_WARNING]\n${String(schemaDiffContext).slice(0, 12000)}`,
    });
  }

  if (requestedMode === 'edit') {
    if (originalFrontendBase) {
      history.unshift({
        role: 'system',
        content: `[MUST_EDIT_FROM_ORIGINAL_VERSION]\nYou MUST modify based on the original current version code below.\nDo not rewrite whole app. Do not remove existing features unless user explicitly asks.\nKeep unchanged sections as-is.\n\nORIGINAL_CURRENT_VERSION_JSX:\n\`\`\`jsx\n${originalFrontendBase.slice(0, 16000)}\n\`\`\``,
      });
    }
    if (appSpec) {
      history.unshift({
        role: 'system',
        content: `[ITERATION_BASELINE]\nRead and follow this APP_SPEC baseline strictly. Preserve old features/APIs/data compatibility unless explicitly requested:\n\n${appSpec.slice(0, 12000)}`,
      });
    }
    if (apiContract) {
      history.unshift({
        role: 'system',
        content: `[API_CONTRACT_BASELINE]\nFollow this API contract baseline. Keep routes compatible and do not remove old APIs unless explicitly requested:\n\n${apiContract.slice(0, 12000)}`,
      });
    }
    if (dbSchemaDoc) {
      history.unshift({
        role: 'system',
        content: `[DB_SCHEMA_BASELINE]\nFollow this DB schema baseline. Use additive, non-destructive changes only:\n\n${dbSchemaDoc.slice(0, 10000)}`,
      });
    }
  }

  if (requestedMode === 'rewrite') {
    if (appSpec) {
      history.unshift({
        role: 'system',
        content: `[REWRITE_GOAL_BASELINE]\nPreserve the app's business goals and required capabilities, but you MAY redesign structure, UI flow, and implementation approach when helpful.\n\n${appSpec.slice(0, 12000)}`,
      });
    }
    if (apiContract) {
      history.unshift({
        role: 'system',
        content: `[REWRITE_API_REFERENCE]\nUse this API contract as reference for important business capabilities, but you may reorganize the implementation when needed. Avoid accidental capability loss.\n\n${apiContract.slice(0, 12000)}`,
      });
    }
    if (dbSchemaDoc) {
      history.unshift({
        role: 'system',
        content: `[REWRITE_DB_REFERENCE]\nUse this DB schema as reference. Prefer preserving data meaning, but structural redesign is allowed if the request implies a larger rewrite. Avoid destructive data loss by default.\n\n${dbSchemaDoc.slice(0, 10000)}`,
      });
    }
    if (originalFrontendBase) {
      history.unshift({
        role: 'system',
        content: `[REWRITE_REFERENCE_IMPLEMENTATION]\nExisting implementation for reference only. Keep product intent, not line-by-line structure.\n\n\`\`\`jsx\n${originalFrontendBase.slice(0, 16000)}\n\`\`\``,
      });
    }
  }

  if (requestedMode === 'create') {
    history.unshift({
      role: 'system',
      content: '[CREATE_MODE_RULE]\nThis is a creation task. Focus on building the best app structure from scratch for the user request. Do not inherit iteration-only constraints unless explicitly requested. Default to a self-contained frontend app with local state persistence. Do not rely on /api requests unless the user explicitly asks for backend implementation in Create mode.',
    });
    if (appSpec) {
      history.unshift({
        role: 'system',
        content: `[CREATE_PRODUCT_CONTEXT]\nUse this existing APP_SPEC only as lightweight product context. Do not let it reduce creative freedom or force incremental editing.\n\n${appSpec.slice(0, 8000)}`,
      });
    }
  }

  return history;
}

function buildModePrompt({ requestedMode, runtimeMode, appStatus, appRow, userId, appId, schemaDiffContext }) {
  const isFrontendDevMode = runtimeMode === 'local' || !['live'].includes(String(appStatus || 'draft'));
  const rolePrompt = requestedMode === 'create'
    ? CREATE_MODE_PROMPT
    : requestedMode === 'rewrite'
      ? REWRITE_MODE_PROMPT
      : isFrontendDevMode
        ? `${EDIT_MODE_PROMPT}\n\n${EDIT_FRONTEND_FIRST_PROMPT}`
        : EDIT_MODE_PROMPT;
  const systemPrompt = buildWorkspaceSystemPrompt({
    requestedMode,
    runtimeMode,
    appStatus,
    appRow,
    userId,
    appId: appId != null ? appId : appRow?.id,
    schemaDiffContext,
    extraSections: runtimeMode === 'server'
      ? [{
          title: 'SERVER_INTEGRATION_CONSTRAINT',
          content: 'This app already has backend integration. Do not regress persisted business flows to local-first state. Keep explicit, verifier-detectable API contracts for core business data.',
        }]
      : [],
  });
  return `${systemPrompt}\n\n${rolePrompt}`;
}

async function runRepairPass({
  mode = 'create',
  frontendCode = '',
  userMessage = '',
  appSpec = '',
  apiContract = '',
  maxRetries = 1,
  callLlmOnce,
  parseAIResponse,
  lintAndRepairJsx,
  validateFrontendOnlyArtifacts,
  extractFrontendApiContracts,
  appRow = null,
  userId = null,
  appId = null,
  runtimeMode = 'local',
  appStatus = null,
  schemaDiffContext = '',
} = {}) {
  let current = String(frontendCode || '').trim();
  if (!current) return { code: current, changed: false, reason: 'empty' };

  const shouldRun = mode === 'create'
    ? (extractFrontendApiContracts(current).length > 0 || !validateFrontendOnlyArtifacts(current).ok)
    : mode === 'rewrite'
      ? !validateFrontendOnlyArtifacts(current).ok
      : mode === 'edit'
        ? !validateFrontendOnlyArtifacts(current).ok
        : false;

  if (!shouldRun) return { code: current, changed: false, reason: 'not-needed' };

  const repairSystemPrompt = buildRepairSystemPrompt({
    requestedMode: mode,
    runtimeMode,
    appStatus,
    appRow,
    userId,
    appId: appId != null ? appId : appRow?.id,
    schemaDiffContext,
  });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const repairPrompt = `${REPAIR_ROLE_PROMPT}

Current stage: ${String(mode).toUpperCase()}

Original user intent:
${userMessage || '-'}

APP_SPEC context (lightweight):
${String(appSpec || '').slice(0, 6000) || '-'}

API_CONTRACT context (lightweight):
${String(apiContract || '').slice(0, 4000) || '-'}

Current JSX:
\`\`\`jsx
${current}
\`\`\``;
    const repaired = await callLlmOnce([
      { role: 'system', content: repairSystemPrompt },
      { role: 'user', content: repairPrompt },
    ]);
    const parsed = parseAIResponse(repaired);
    if (!parsed.jsx) continue;
    const pre = lintAndRepairJsx(parsed.jsx);
    const validation = validateFrontendOnlyArtifacts(pre.code);
    if (!validation.ok) {
      current = pre.code;
      continue;
    }
    if (mode === 'create' && extractFrontendApiContracts(pre.code).length > 0) {
      current = pre.code;
      continue;
    }
    return { code: pre.code, changed: pre.code.trim() !== frontendCode.trim(), reason: 'repaired' };
  }

  return { code: current, changed: current.trim() !== frontendCode.trim(), reason: 'best-effort' };
}

module.exports = {
  buildWorkspaceHistory,
  buildModePrompt,
  runRepairPass,
};
