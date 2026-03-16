const crypto = require('crypto');
const db = require('./db');

const INTERNAL_APP_GUARD = '[FUNFO_INTERNAL_APP_GUARD]\nNever create, suggest, migrate to, or reason from any external standalone project path such as projects/apps/... . Every app in this system must stay inside funfo AI Store as server/apps/<numeric-app-id>/ with DB-backed app/app_versions records. If a user request sounds like a standalone project, reinterpret it as an internal funfo app request instead.';

const PLATFORM_PROVIDERS = {
  'openai-codex': {
    id: 'openai-codex',
    label: 'Codex OAuth',
    authType: 'oauth',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Claude API',
    authType: 'api_key',
  },
};

const oauthSessions = new Map();

let piAiModulePromise = null;
let oauthModulePromise = null;

function boolFromEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function normalizeBaseUrl(rawUrl) {
  const input = String(rawUrl || '').trim();
  if (!input) return '';
  try {
    const url = new URL(input);
    url.pathname = url.pathname
      .replace(/\/chat\/completions\/?$/i, '')
      .replace(/\/responses\/?$/i, '')
      .replace(/\/+$/, '') || '/v1';
    return url.toString().replace(/\/$/, '');
  } catch {
    return input.replace(/\/chat\/completions\/?$/i, '').replace(/\/responses\/?$/i, '').replace(/\/$/, '');
  }
}

function normalizeTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item) return '';
        if (typeof item === 'string') return item;
        if (typeof item.text === 'string') return item.text;
        if (typeof item.content === 'string') return item.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content == null) return '';
  return String(content);
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function buildPiContext(messages, model) {
  const systemSections = [INTERNAL_APP_GUARD];
  const conversation = [];
  let stamp = Date.now();

  for (const msg of Array.isArray(messages) ? messages : []) {
    const role = String(msg?.role || '').toLowerCase();
    const text = normalizeTextContent(msg?.content).trim();
    if (!text) continue;

    if (role === 'system' || role === 'developer') {
      systemSections.push(text);
      continue;
    }

    if (role === 'assistant') {
      conversation.push({
        role: 'assistant',
        content: [{ type: 'text', text }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: emptyUsage(),
        stopReason: 'stop',
        timestamp: stamp++,
      });
      continue;
    }

    conversation.push({
      role: 'user',
      content: text,
      timestamp: stamp++,
    });
  }

  if (!conversation.length) {
    throw new Error('LLM request has no user/assistant conversation payload');
  }

  return {
    systemPrompt: systemSections.join('\n\n'),
    messages: conversation,
  };
}

function extractAssistantText(message) {
  const parts = Array.isArray(message?.content) ? message.content : [];
  return parts
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('');
}

function safeJsonParse(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function stableStrings(values, limit = 64) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = String(raw || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function buildModelKey(providerId, modelId) {
  return `${providerId}:${modelId}`;
}

function splitModelKey(modelKey) {
  const value = String(modelKey || '').trim();
  const idx = value.indexOf(':');
  if (idx <= 0 || idx >= value.length - 1) return { providerId: null, modelId: null };
  return {
    providerId: value.slice(0, idx),
    modelId: value.slice(idx + 1),
  };
}

function isEnvModelKey(modelKey) {
  return String(modelKey || '').startsWith('env:');
}

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 8) return '*'.repeat(text.length);
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function buildMissingConfigMessage() {
  return [
    'AI provider 尚未配置。',
    '请在 /admin 的 Platform AI 面板里连接 Codex OAuth 或保存 Claude API key，并至少启用一个模型。',
    '如果你暂时不走后台配置，也可以继续使用环境变量 FUNFO_AI_* 作为平台级后备配置。',
  ].join('\n');
}

function buildCompatOverrides({ provider, baseUrl, api }) {
  if (api !== 'openai-completions') return undefined;

  const compat = {};
  const inferredOllama = /ollama/i.test(String(provider || '')) || /:\/\/[^/]*:11434(\/|$)/.test(String(baseUrl || ''));

  if (inferredOllama || boolFromEnv('FUNFO_AI_COMPAT_NO_DEVELOPER_ROLE', false)) {
    compat.supportsDeveloperRole = false;
  }
  if (inferredOllama || boolFromEnv('FUNFO_AI_COMPAT_NO_REASONING_EFFORT', false)) {
    compat.supportsReasoningEffort = false;
  }
  if (boolFromEnv('FUNFO_AI_COMPAT_NO_STORE', false)) {
    compat.supportsStore = false;
  }
  if (boolFromEnv('FUNFO_AI_COMPAT_NO_STREAM_USAGE', false)) {
    compat.supportsUsageInStreaming = false;
  }
  if (process.env.FUNFO_AI_MAX_TOKENS_FIELD === 'max_tokens') {
    compat.maxTokensField = 'max_tokens';
  }

  return Object.keys(compat).length ? compat : undefined;
}

function buildCustomEnvRuntime() {
  const baseUrl = normalizeBaseUrl(process.env.FUNFO_AI_BASE_URL || '');
  if (!baseUrl) return null;

  const modelId = String(process.env.FUNFO_AI_MODEL || '').trim();
  if (!modelId) {
    throw new Error(`FUNFO_AI_MODEL is required when FUNFO_AI_BASE_URL is set.\n\n${buildMissingConfigMessage()}`);
  }

  const provider = String(process.env.FUNFO_AI_PROVIDER || 'openai-compatible').trim();
  const api = String(process.env.FUNFO_AI_API || 'openai-completions').trim();
  const reasoning = boolFromEnv('FUNFO_AI_REASONING', false);
  const maxTokens = Math.max(256, Number(process.env.FUNFO_AI_MODEL_MAX_TOKENS || '8192'));
  const contextWindow = Math.max(maxTokens, Number(process.env.FUNFO_AI_CONTEXT_WINDOW || '131072'));
  const compat = buildCompatOverrides({ provider, baseUrl, api });

  return {
    mode: 'custom',
    summary: {
      configured: true,
      mode: 'custom',
      provider,
      model: modelId,
      api,
      baseUrl,
      source: 'env',
    },
    model: {
      id: modelId,
      name: `${modelId} (${provider})`,
      api,
      provider,
      baseUrl,
      reasoning,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens,
      ...(compat ? { compat } : {}),
    },
    requestOptions: {
      apiKey: process.env.FUNFO_AI_API_KEY || process.env.OPENAI_API_KEY || 'dummy',
    },
  };
}

function buildBuiltinEnvRuntime(piAi) {
  const provider = String(process.env.FUNFO_AI_PROVIDER || '').trim();
  const modelId = String(process.env.FUNFO_AI_MODEL || '').trim();
  if (!provider || !modelId) return null;

  const model = piAi.getModel(provider, modelId);
  if (!model) {
    const available = piAi.getModels(provider).slice(0, 20).map((item) => item.id);
    const suffix = available.length ? ` Available models for ${provider}: ${available.join(', ')}` : ' No built-in models were found for that provider.';
    throw new Error(`Unknown pi-ai model configuration: ${provider}/${modelId}.${suffix}`);
  }

  return {
    mode: 'builtin',
    summary: {
      configured: true,
      mode: 'builtin',
      provider,
      model: modelId,
      api: model.api,
      baseUrl: model.baseUrl,
      source: 'env',
    },
    model,
    requestOptions: {
      ...(process.env.FUNFO_AI_API_KEY ? { apiKey: process.env.FUNFO_AI_API_KEY } : {}),
    },
  };
}

function getEnvFallbackSummary() {
  try {
    const baseUrl = normalizeBaseUrl(process.env.FUNFO_AI_BASE_URL || '');
    if (baseUrl) {
      return {
        configured: true,
        mode: 'custom',
        provider: process.env.FUNFO_AI_PROVIDER || 'openai-compatible',
        model: process.env.FUNFO_AI_MODEL || null,
        api: process.env.FUNFO_AI_API || 'openai-completions',
        baseUrl,
        source: 'env',
      };
    }
    if (process.env.FUNFO_AI_PROVIDER || process.env.FUNFO_AI_MODEL) {
      return {
        configured: !!(process.env.FUNFO_AI_PROVIDER && process.env.FUNFO_AI_MODEL),
        mode: 'builtin',
        provider: process.env.FUNFO_AI_PROVIDER || null,
        model: process.env.FUNFO_AI_MODEL || null,
        api: null,
        baseUrl: null,
        source: 'env',
      };
    }
  } catch {}

  return {
    configured: false,
    mode: 'unconfigured',
    provider: null,
    model: null,
    api: null,
    baseUrl: null,
    source: 'env',
  };
}

function buildEnvFallbackPublicModel() {
  const summary = getEnvFallbackSummary();
  if (!summary.configured || !summary.provider || !summary.model) return null;
  return {
    key: `env:${summary.provider}:${summary.model}`,
    providerId: 'env',
    providerLabel: 'Server Default',
    modelId: summary.model,
    name: `${summary.model} (${summary.provider})`,
    api: summary.api,
    isDefault: false,
    isProviderDefault: true,
    source: 'env',
    readOnly: true,
  };
}

function parseProviderRow(row) {
  if (!row) return null;
  return {
    ...row,
    enabled: !!row.enabled,
    enabled_models: stableStrings(safeJsonParse(row.enabled_models_json, [])),
    credentials: safeJsonParse(row.credentials_json, null),
    metadata: safeJsonParse(row.metadata_json, null),
  };
}

function getPlatformProviderRow(providerId) {
  return parseProviderRow(
    db.prepare('SELECT * FROM platform_ai_providers WHERE provider_id = ?').get(providerId),
  );
}

function getPlatformStateRow() {
  const row = db.prepare('SELECT * FROM platform_ai_state WHERE id = 1').get();
  return row || { id: 1, default_model_key: null };
}

function setPlatformDefaultModelKey(defaultModelKey) {
  db.prepare(`
    INSERT INTO platform_ai_state (id, default_model_key, created_at, updated_at)
    VALUES (1, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      default_model_key = excluded.default_model_key,
      updated_at = datetime('now')
  `).run(defaultModelKey || null);
}

function upsertPlatformProvider(providerId, patch = {}) {
  const definition = PLATFORM_PROVIDERS[providerId];
  if (!definition) throw new Error(`Unsupported AI provider: ${providerId}`);

  const existing = getPlatformProviderRow(providerId);
  const next = {
    label: patch.label !== undefined ? patch.label : (existing?.label || definition.label),
    auth_type: patch.authType !== undefined ? patch.authType : (existing?.auth_type || definition.authType),
    connection_status: patch.connectionStatus !== undefined ? patch.connectionStatus : (existing?.connection_status || 'disconnected'),
    credentials_json: patch.credentialsJson !== undefined ? patch.credentialsJson : (existing?.credentials_json ?? null),
    enabled_models_json: patch.enabledModelsJson !== undefined ? patch.enabledModelsJson : (existing?.enabled_models_json || '[]'),
    default_model_id: patch.defaultModelId !== undefined ? patch.defaultModelId : (existing?.default_model_id || null),
    enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (existing?.enabled ? 1 : 0),
    last_error: patch.lastError !== undefined ? patch.lastError : (existing?.last_error || null),
    metadata_json: patch.metadataJson !== undefined ? patch.metadataJson : (existing?.metadata_json ?? null),
  };

  if (existing) {
    db.prepare(`
      UPDATE platform_ai_providers
      SET
        label = ?,
        auth_type = ?,
        connection_status = ?,
        credentials_json = ?,
        enabled_models_json = ?,
        default_model_id = ?,
        enabled = ?,
        last_error = ?,
        metadata_json = ?,
        updated_at = datetime('now')
      WHERE provider_id = ?
    `).run(
      next.label,
      next.auth_type,
      next.connection_status,
      next.credentials_json,
      next.enabled_models_json,
      next.default_model_id,
      next.enabled,
      next.last_error,
      next.metadata_json,
      providerId,
    );
  } else {
    db.prepare(`
      INSERT INTO platform_ai_providers (
        provider_id, label, auth_type, connection_status, credentials_json,
        enabled_models_json, default_model_id, enabled, last_error, metadata_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      providerId,
      next.label,
      next.auth_type,
      next.connection_status,
      next.credentials_json,
      next.enabled_models_json,
      next.default_model_id,
      next.enabled,
      next.last_error,
      next.metadata_json,
    );
  }

  return getPlatformProviderRow(providerId);
}

function providerHasUsableCredentials(providerRow) {
  if (!providerRow) return false;
  if (providerRow.auth_type === 'oauth') {
    const oauth = providerRow.credentials?.oauth || providerRow.credentials;
    return !!(oauth && oauth.access && oauth.refresh);
  }
  if (providerRow.auth_type === 'api_key') {
    return !!String(providerRow.credentials?.apiKey || '').trim();
  }
  return false;
}

function extractOauthCredentials(providerRow) {
  const oauth = providerRow?.credentials?.oauth || providerRow?.credentials;
  if (!oauth || !oauth.access || !oauth.refresh) return null;
  return oauth;
}

function extractApiKeyCredentials(providerRow) {
  return String(providerRow?.credentials?.apiKey || '').trim();
}

function pickRecommendedModelIds(providerId, availableModels) {
  const preferred = providerId === 'openai-codex'
    ? ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2', 'gpt-5.1-codex-mini']
    : ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-3-7-sonnet-latest'];
  const availableIds = new Set((availableModels || []).map((item) => item.id));
  const fromPreferred = preferred.filter((id) => availableIds.has(id));
  if (fromPreferred.length) return fromPreferred.slice(0, 4);
  return (availableModels || []).slice(0, 4).map((item) => item.id);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeProviderSelection(providerId, availableModels, currentRow, payload = {}) {
  const availableIds = new Set((availableModels || []).map((item) => item.id));
  const existingEnabled = stableStrings(currentRow?.enabled_models || []).filter((id) => availableIds.has(id));
  const requestedEnabled = hasOwn(payload, 'enabledModelIds')
    ? stableStrings(payload.enabledModelIds || []).filter((id) => availableIds.has(id))
    : null;
  const enabledModelIds = requestedEnabled !== null
    ? requestedEnabled
    : (existingEnabled.length ? existingEnabled : pickRecommendedModelIds(providerId, availableModels));

  let defaultModelId = hasOwn(payload, 'defaultModelId')
    ? String(payload.defaultModelId || '').trim()
    : String(currentRow?.default_model_id || '').trim();
  if (!enabledModelIds.includes(defaultModelId)) {
    defaultModelId = enabledModelIds[0] || null;
  }

  let enabled = hasOwn(payload, 'enabled') ? !!payload.enabled : !!currentRow?.enabled;
  if (!currentRow) enabled = hasOwn(payload, 'enabled') ? !!payload.enabled : true;
  if (!enabledModelIds.length) enabled = false;

  return { enabledModelIds, defaultModelId, enabled };
}

function sanitizeProviderError(error) {
  return String(error?.message || error || 'provider failed').trim();
}

function getRetryConfig() {
  return {
    timeoutMs: Math.max(1000, Number(process.env.FUNFO_AI_TIMEOUT_MS || process.env.OPENCLAW_TIMEOUT_MS || '300000')),
    maxAttempts: Math.max(1, Number(process.env.FUNFO_AI_MAX_RETRY || process.env.OPENCLAW_MAX_RETRY || '2')),
  };
}

function normalizeProviderError(error) {
  const message = String(error?.message || error || 'LLM request failed');
  if (/No API key|API key is required/i.test(message)) {
    return `${message}\n\n${buildMissingConfigMessage()}`;
  }
  return message;
}

async function getPiAi() {
  if (!piAiModulePromise) {
    piAiModulePromise = import('@mariozechner/pi-ai');
  }
  return piAiModulePromise;
}

async function getOAuthTools() {
  if (!oauthModulePromise) {
    oauthModulePromise = import('@mariozechner/pi-ai/oauth');
  }
  return oauthModulePromise;
}

async function listProviderAvailableModels(providerId) {
  const piAi = await getPiAi();
  return piAi.getModels(providerId).map((model) => ({
    id: model.id,
    name: model.name || model.id,
    api: model.api,
    provider: model.provider,
  }));
}

async function buildPublicModelCatalog(options = {}) {
  const includeEnvFallback = options.includeEnvFallback !== false;
  const piAi = await getPiAi();
  const state = getPlatformStateRow();
  const models = [];

  for (const providerId of Object.keys(PLATFORM_PROVIDERS)) {
    const row = getPlatformProviderRow(providerId);
    if (!row || !row.enabled || row.connection_status !== 'connected' || !providerHasUsableCredentials(row)) continue;

    const enabledIds = stableStrings(row.enabled_models || []);
    if (!enabledIds.length) continue;

    const available = piAi.getModels(providerId);
    for (const model of available) {
      if (!enabledIds.includes(model.id)) continue;
      models.push({
        key: buildModelKey(providerId, model.id),
        providerId,
        providerLabel: PLATFORM_PROVIDERS[providerId].label,
        modelId: model.id,
        name: model.name || model.id,
        api: model.api || null,
        source: 'platform',
        isProviderDefault: row.default_model_id === model.id,
      });
    }
  }

  if (!models.length && includeEnvFallback) {
    const envFallback = buildEnvFallbackPublicModel();
    if (envFallback) models.push(envFallback);
  }

  const derivedDefaultModelKey = models.some((item) => item.key === state.default_model_key)
    ? state.default_model_key
    : (models.find((item) => item.isProviderDefault)?.key || models[0]?.key || null);

  const sorted = models
    .map((item) => ({ ...item, isDefault: item.key === derivedDefaultModelKey }))
    .sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      if (a.providerLabel !== b.providerLabel) return a.providerLabel.localeCompare(b.providerLabel);
      return a.name.localeCompare(b.name);
    });

  return {
    models: sorted,
    defaultModelKey: derivedDefaultModelKey,
    configuredDefaultModelKey: state.default_model_key || null,
  };
}

async function syncPlatformDefaultModelKey(requestedModelKey = null) {
  const catalog = await buildPublicModelCatalog({ includeEnvFallback: true });
  const candidate = requestedModelKey && catalog.models.some((item) => item.key === requestedModelKey)
    ? requestedModelKey
    : catalog.defaultModelKey;
  if (candidate !== getPlatformStateRow().default_model_key) {
    setPlatformDefaultModelKey(candidate || null);
  }
  return candidate || null;
}

async function resolveSelectedModelKey(requestedModelKey = null) {
  const catalog = await buildPublicModelCatalog({ includeEnvFallback: true });
  if (requestedModelKey && catalog.models.some((item) => item.key === requestedModelKey)) {
    return requestedModelKey;
  }
  return catalog.defaultModelKey || null;
}

async function getAdminAiConfig() {
  const catalog = await buildPublicModelCatalog({ includeEnvFallback: true });
  const providers = [];
  for (const providerId of Object.keys(PLATFORM_PROVIDERS)) {
    const definition = PLATFORM_PROVIDERS[providerId];
    const row = getPlatformProviderRow(providerId);
    const availableModels = await listProviderAvailableModels(providerId);
    providers.push({
      providerId,
      label: definition.label,
      authType: definition.authType,
      connected: !!(row && row.connection_status === 'connected' && providerHasUsableCredentials(row)),
      connectionStatus: row?.connection_status || 'disconnected',
      enabled: !!row?.enabled,
      enabledModelIds: stableStrings(row?.enabled_models || []),
      defaultModelId: row?.default_model_id || null,
      lastError: row?.last_error || null,
      metadata: row?.metadata || null,
      credentialHint: definition.authType === 'api_key'
        ? maskSecret(extractApiKeyCredentials(row))
        : (row?.metadata?.accountId ? `account:${row.metadata.accountId}` : ''),
      availableModels,
    });
  }
  return {
    providers,
    publicModels: catalog.models,
    defaultModelKey: catalog.defaultModelKey,
    envFallback: getEnvFallbackSummary(),
  };
}

async function saveAnthropicProvider(payload = {}) {
  const providerId = 'anthropic';
  const apiKey = String(payload.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('Claude API key is required');
  }

  const existing = getPlatformProviderRow(providerId);
  const availableModels = await listProviderAvailableModels(providerId);
  const selection = normalizeProviderSelection(providerId, availableModels, existing, payload);
  const metadata = {
    ...(existing?.metadata || {}),
    authMode: 'api_key',
    savedAt: new Date().toISOString(),
  };

  upsertPlatformProvider(providerId, {
    connectionStatus: 'connected',
    credentialsJson: JSON.stringify({ apiKey }),
    enabledModelsJson: JSON.stringify(selection.enabledModelIds),
    defaultModelId: selection.defaultModelId,
    enabled: selection.enabled,
    lastError: null,
    metadataJson: JSON.stringify(metadata),
  });

  if (payload.setAsPlatformDefault && selection.defaultModelId) {
    await syncPlatformDefaultModelKey(buildModelKey(providerId, selection.defaultModelId));
  } else {
    await syncPlatformDefaultModelKey();
  }
  return getAdminAiConfig();
}

async function updatePlatformProviderModels(providerId, payload = {}) {
  const definition = PLATFORM_PROVIDERS[providerId];
  if (!definition) throw new Error(`Unsupported AI provider: ${providerId}`);

  const existing = getPlatformProviderRow(providerId) || upsertPlatformProvider(providerId);
  if (!providerHasUsableCredentials(existing) && payload.enabled) {
    throw new Error(`${definition.label} 尚未连接，无法启用模型`);
  }

  const availableModels = await listProviderAvailableModels(providerId);
  const selection = normalizeProviderSelection(providerId, availableModels, existing, payload);
  if (selection.enabled && !providerHasUsableCredentials(existing)) {
    throw new Error(`${definition.label} 尚未连接，无法启用模型`);
  }

  upsertPlatformProvider(providerId, {
    enabledModelsJson: JSON.stringify(selection.enabledModelIds),
    defaultModelId: selection.defaultModelId,
    enabled: selection.enabled,
    lastError: payload.clearError ? null : undefined,
  });

  if (payload.setAsPlatformDefault && selection.defaultModelId) {
    await syncPlatformDefaultModelKey(buildModelKey(providerId, selection.defaultModelId));
  } else {
    await syncPlatformDefaultModelKey();
  }
  return getAdminAiConfig();
}

async function disconnectPlatformProvider(providerId) {
  const definition = PLATFORM_PROVIDERS[providerId];
  if (!definition) throw new Error(`Unsupported AI provider: ${providerId}`);
  upsertPlatformProvider(providerId, {
    connectionStatus: 'disconnected',
    credentialsJson: null,
    enabledModelsJson: '[]',
    defaultModelId: null,
    enabled: false,
    lastError: null,
    metadataJson: JSON.stringify({
      ...(getPlatformProviderRow(providerId)?.metadata || {}),
      disconnectedAt: new Date().toISOString(),
    }),
  });
  await syncPlatformDefaultModelKey();
  return getAdminAiConfig();
}

async function updatePlatformDefaultModel(modelKey) {
  const value = String(modelKey || '').trim();
  const catalog = await buildPublicModelCatalog({ includeEnvFallback: true });
  if (value && !catalog.models.some((item) => item.key === value)) {
    throw new Error('Selected default model is not enabled');
  }
  await syncPlatformDefaultModelKey(value || null);
  return getAdminAiConfig();
}

function createDeferred() {
  const deferred = { settled: false };
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = (value) => {
      if (deferred.settled) return;
      deferred.settled = true;
      resolve(value);
    };
    deferred.reject = (error) => {
      if (deferred.settled) return;
      deferred.settled = true;
      reject(error);
    };
  });
  return deferred;
}

function sanitizeOAuthSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    providerId: session.providerId,
    status: session.status,
    authUrl: session.authUrl || null,
    instructions: session.instructions || '',
    progress: session.progress.slice(-8),
    error: session.error || null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    accountId: session.accountId || null,
  };
}

async function connectOpenAICodexProvider(credentials) {
  const providerId = 'openai-codex';
  const existing = getPlatformProviderRow(providerId);
  const availableModels = await listProviderAvailableModels(providerId);
  const selection = normalizeProviderSelection(providerId, availableModels, existing, {});
  const metadata = {
    ...(existing?.metadata || {}),
    authMode: 'oauth',
    accountId: credentials.accountId || null,
    connectedAt: new Date().toISOString(),
  };

  upsertPlatformProvider(providerId, {
    connectionStatus: 'connected',
    credentialsJson: JSON.stringify({ oauth: credentials }),
    enabledModelsJson: JSON.stringify(selection.enabledModelIds),
    defaultModelId: selection.defaultModelId,
    enabled: selection.enabled,
    lastError: null,
    metadataJson: JSON.stringify(metadata),
  });

  await syncPlatformDefaultModelKey();
}

async function startOpenAICodexOAuthSession() {
  const providerId = 'openai-codex';
  const session = {
    id: crypto.randomUUID(),
    providerId,
    status: 'starting',
    authUrl: null,
    instructions: '',
    progress: [],
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    accountId: null,
    manualInput: createDeferred(),
  };
  oauthSessions.set(session.id, session);

  (async () => {
    try {
      const { loginOpenAICodex } = await getOAuthTools();
      session.status = 'waiting_auth';
      session.updatedAt = new Date().toISOString();
      const credentials = await loginOpenAICodex({
        onAuth: (info) => {
          session.authUrl = info.url;
          session.instructions = info.instructions || '';
          session.status = 'awaiting_browser';
          session.updatedAt = new Date().toISOString();
        },
        onProgress: (message) => {
          if (message) {
            session.progress.push(String(message));
            session.updatedAt = new Date().toISOString();
          }
        },
        onManualCodeInput: () => session.manualInput.promise,
        onPrompt: async () => session.manualInput.promise,
      });
      await connectOpenAICodexProvider(credentials);
      session.status = 'completed';
      session.accountId = credentials.accountId || null;
      session.updatedAt = new Date().toISOString();
    } catch (error) {
      const message = sanitizeProviderError(error);
      session.status = 'failed';
      session.error = message;
      session.updatedAt = new Date().toISOString();
      upsertPlatformProvider(providerId, {
        connectionStatus: 'error',
        lastError: message,
      });
    }
  })();

  return sanitizeOAuthSession(session);
}

function getOpenAICodexOAuthSession(sessionId) {
  return sanitizeOAuthSession(oauthSessions.get(String(sessionId || '')));
}

function submitOpenAICodexOAuthManualInput(sessionId, input) {
  const session = oauthSessions.get(String(sessionId || ''));
  if (!session) throw new Error('OAuth session not found');
  if (session.status === 'completed' || session.status === 'failed') {
    return sanitizeOAuthSession(session);
  }
  const value = String(input || '').trim();
  if (!value) throw new Error('Authorization code is required');
  session.status = 'manual_code_submitted';
  session.updatedAt = new Date().toISOString();
  session.manualInput.resolve(value);
  return sanitizeOAuthSession(session);
}

async function buildPlatformRuntime(piAi, providerId, modelId, providerRow) {
  const model = piAi.getModel(providerId, modelId);
  if (!model) {
    const available = piAi.getModels(providerId).slice(0, 30).map((item) => item.id);
    const suffix = available.length ? ` Available models for ${providerId}: ${available.join(', ')}` : '';
    throw new Error(`Unknown platform model: ${providerId}/${modelId}.${suffix}`);
  }

  const requestOptions = {};
  if (providerRow.auth_type === 'api_key') {
    const apiKey = extractApiKeyCredentials(providerRow);
    if (!apiKey) throw new Error(`${PLATFORM_PROVIDERS[providerId].label} 缺少 API key`);
    requestOptions.apiKey = apiKey;
  } else if (providerRow.auth_type === 'oauth') {
    const oauthCredentials = extractOauthCredentials(providerRow);
    if (!oauthCredentials) throw new Error(`${PLATFORM_PROVIDERS[providerId].label} OAuth 凭证缺失，请重新连接`);
    const { getOAuthApiKey } = await getOAuthTools();
    const result = await getOAuthApiKey(providerId, { [providerId]: oauthCredentials });
    if (!result?.apiKey) throw new Error(`${PLATFORM_PROVIDERS[providerId].label} 无法获取可用 API key`);
    requestOptions.apiKey = result.apiKey;

    if (result.newCredentials) {
      upsertPlatformProvider(providerId, {
        connectionStatus: 'connected',
        credentialsJson: JSON.stringify({ oauth: result.newCredentials }),
        lastError: null,
        metadataJson: JSON.stringify({
          ...(providerRow.metadata || {}),
          authMode: 'oauth',
          accountId: result.newCredentials.accountId || providerRow.metadata?.accountId || null,
          refreshedAt: new Date().toISOString(),
        }),
      });
    }
  }

  if (providerRow.last_error) {
    upsertPlatformProvider(providerId, {
      connectionStatus: 'connected',
      lastError: null,
    });
  }

  return {
    mode: 'platform',
    summary: {
      configured: true,
      mode: 'platform',
      provider: providerId,
      model: modelId,
      api: model.api || null,
      baseUrl: model.baseUrl || null,
      source: 'platform',
    },
    model,
    requestOptions,
  };
}

async function buildEnvRuntime(piAi) {
  const custom = buildCustomEnvRuntime();
  if (custom) return custom;
  const builtin = buildBuiltinEnvRuntime(piAi);
  if (builtin) return builtin;
  return null;
}

async function resolveRuntime(options = {}) {
  const piAi = await getPiAi();
  const requestedModelKey = String(options.modelKey || '').trim();
  const catalog = await buildPublicModelCatalog({ includeEnvFallback: true });
  const effectiveModelKey = requestedModelKey && catalog.models.some((item) => item.key === requestedModelKey)
    ? requestedModelKey
    : catalog.defaultModelKey;

  if (effectiveModelKey && isEnvModelKey(effectiveModelKey)) {
    const envRuntime = await buildEnvRuntime(piAi);
    if (envRuntime) return { ...envRuntime, selectedModelKey: effectiveModelKey };
  }

  const parsed = splitModelKey(effectiveModelKey);
  if (parsed.providerId && PLATFORM_PROVIDERS[parsed.providerId]) {
    const providerRow = getPlatformProviderRow(parsed.providerId);
    if (providerRow && providerRow.enabled && providerRow.connection_status === 'connected' && providerHasUsableCredentials(providerRow)) {
      try {
        const runtime = await buildPlatformRuntime(piAi, parsed.providerId, parsed.modelId, providerRow);
        return { ...runtime, selectedModelKey: effectiveModelKey };
      } catch (error) {
        const message = sanitizeProviderError(error);
        upsertPlatformProvider(parsed.providerId, {
          connectionStatus: 'error',
          lastError: message,
        });
        throw new Error(message);
      }
    }
  }

  const envRuntime = await buildEnvRuntime(piAi);
  if (envRuntime) {
    const summary = envRuntime.summary || {};
    const envModelKey = `env:${summary.provider || 'env'}:${summary.model || 'default'}`;
    return { ...envRuntime, selectedModelKey: envModelKey };
  }

  throw new Error(buildMissingConfigMessage());
}

async function callLlmOnce(messages, options = {}) {
  const runtime = await resolveRuntime(options);
  const { complete } = runtime.piAi || await getPiAi();
  const { timeoutMs, maxAttempts } = getRetryConfig();

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await complete(
        runtime.model,
        buildPiContext(messages, runtime.model),
        {
          ...runtime.requestOptions,
          signal: controller.signal,
        },
      );
      const content = extractAssistantText(result).trim();
      if (!content) throw new Error('Empty model response');
      return content;
    } catch (error) {
      lastError = error;
      const normalized = normalizeProviderError(error);
      const retryable = /aborted|timeout|timed out|fetch failed|network|5\d\d/i.test(normalized);
      if (!(retryable && attempt < maxAttempts)) break;
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  const message = normalizeProviderError(lastError);
  if (/aborted|timeout|timed out/i.test(message)) {
    throw new Error('模型响应超时（已自动重试），请再试一次或简化一次需求');
  }
  throw new Error(message);
}

async function streamLlmText(messages, options = {}) {
  const runtime = await resolveRuntime(options);
  const { stream } = runtime.piAi || await getPiAi();
  const { timeoutMs } = getRetryConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const eventStream = stream(
      runtime.model,
      buildPiContext(messages, runtime.model),
      {
        ...runtime.requestOptions,
        signal: controller.signal,
      },
    );

    let text = '';
    for await (const event of eventStream) {
      if (event.type === 'text_delta' && event.delta) {
        text += event.delta;
        if (typeof options.onTextDelta === 'function') options.onTextDelta(event.delta);
      }
      if (event.type === 'done' && !text) {
        text = extractAssistantText(event.message);
      }
      if (event.type === 'error') {
        throw new Error(normalizeProviderError(event.error?.errorMessage || 'LLM stream failed'));
      }
    }

    if (!text) {
      const finalMessage = await eventStream.result();
      text = extractAssistantText(finalMessage);
    }

    if (!text.trim()) throw new Error('Empty model response');
    return text;
  } catch (error) {
    const message = normalizeProviderError(error);
    if (/aborted|timeout|timed out/i.test(message)) {
      throw new Error('模型流式响应超时，请再试一次或简化一次需求');
    }
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

function getLlmProviderSummary() {
  const state = getPlatformStateRow();
  const parsedDefault = splitModelKey(state.default_model_key);
  if (parsedDefault.providerId && PLATFORM_PROVIDERS[parsedDefault.providerId]) {
    const providerRow = getPlatformProviderRow(parsedDefault.providerId);
    if (providerRow && providerRow.enabled && providerRow.connection_status === 'connected' && providerHasUsableCredentials(providerRow)) {
      return {
        configured: true,
        mode: 'platform',
        provider: parsedDefault.providerId,
        model: parsedDefault.modelId,
        api: null,
        baseUrl: null,
        source: 'platform',
      };
    }
  }

  for (const providerId of Object.keys(PLATFORM_PROVIDERS)) {
    const row = getPlatformProviderRow(providerId);
    if (!row || !row.enabled || row.connection_status !== 'connected' || !providerHasUsableCredentials(row)) continue;
    const modelId = row.default_model_id || row.enabled_models?.[0] || null;
    if (!modelId) continue;
    return {
      configured: true,
      mode: 'platform',
      provider: providerId,
      model: modelId,
      api: null,
      baseUrl: null,
      source: 'platform',
    };
  }

  return getEnvFallbackSummary();
}

module.exports = {
  buildModelKey,
  splitModelKey,
  resolveSelectedModelKey,
  getPublicModelCatalog: () => buildPublicModelCatalog({ includeEnvFallback: true }),
  getAdminAiConfig,
  saveAnthropicProvider,
  updatePlatformProviderModels,
  disconnectPlatformProvider,
  updatePlatformDefaultModel,
  startOpenAICodexOAuthSession,
  getOpenAICodexOAuthSession,
  submitOpenAICodexOAuthManualInput,
  callLlmOnce,
  streamLlmText,
  getLlmProviderSummary,
};
