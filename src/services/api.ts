// API base strategy:
// - local dev on localhost/127.0.0.1 (any port): use Vite/dev proxy (/api)
// - other hosts (static preview / LAN direct): call backend :3100 directly
const isDevRuntime = typeof import.meta !== 'undefined' && !!import.meta.env?.DEV;

const BASE = isDevRuntime
  ? '/api'
  : `${typeof window !== 'undefined' ? window.location.protocol : 'http:'}//${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3100/api`;

async function parseJsonSafe(r: Response) {
  const text = await r.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const snippet = text.slice(0, 180).replace(/\s+/g, ' ');
    throw new Error(`サーバー応答がJSONではありません: ${snippet}`);
  }
}

export interface User {
  id: number;
  email: string;
  nickname: string;
  avatar_url?: string | null;
  favoriteCount?: number;
}

export interface AdminUser {
  id: number;
  email: string;
  nickname: string;
  avatar_url?: string | null;
  created_at: string;
  app_count: number;
}

export interface AdminUserDetail {
  id: number;
  email: string;
  nickname: string;
  avatar_url?: string | null;
  created_at: string;
  updated_at: string;
  apps: Array<{ id: number; name: string; icon: string; status: string; current_version: number; updated_at: string }>;
}

export interface AdminAppMemory {
  appId: number;
  memory: string;
  decisions: string;
  releaseNotes: string;
  updatedAt: {
    memory?: string | null;
    decisions?: string | null;
    releaseNotes?: string | null;
  };
}

export interface PublicAiModel {
  key: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  name: string;
  api?: string | null;
  isDefault?: boolean;
  isProviderDefault?: boolean;
  source?: 'platform' | 'env';
  readOnly?: boolean;
}

export interface AdminAiProvider {
  providerId: string;
  label: string;
  authType: 'oauth' | 'api_key';
  connected: boolean;
  connectionStatus: 'disconnected' | 'connected' | 'error' | string;
  enabled: boolean;
  enabledModelIds: string[];
  defaultModelId?: string | null;
  lastError?: string | null;
  metadata?: Record<string, any> | null;
  credentialHint?: string | null;
  availableModels: Array<{ id: string; name: string; api?: string | null; provider?: string | null }>;
}

export interface AdminAiConfig {
  providers: AdminAiProvider[];
  publicModels: PublicAiModel[];
  defaultModelKey?: string | null;
  envFallback?: {
    configured: boolean;
    provider?: string | null;
    model?: string | null;
    api?: string | null;
    baseUrl?: string | null;
    source?: string | null;
  };
}

export interface AdminOAuthSession {
  id: string;
  providerId: string;
  status: string;
  authUrl?: string | null;
  instructions?: string;
  progress?: string[];
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  accountId?: string | null;
}

export type ReleaseState = 'draft' | 'candidate' | 'live' | 'failed' | 'rollback';
export type LegacyStatus = 'draft' | 'private' | 'published'; // legacy compatibility only; prefer release_state/action semantics

export interface AdminRuntime {
  id: number;
  name: string;
  icon: string;
  live_version_id?: number | null;
  candidate_version_id?: number | null;
  last_failure_reason?: string | null;
  last_failure_at?: string | null;
  status: LegacyStatus; // legacy compatibility only; prefer release_state
  owner_email?: string | null;
  preview_slug?: string | null;
  preview_path?: string | null;
  preview_port?: number | null;
  public_path?: string | null;
  api_port?: number | null;
  runtime_mode?: 'local' | 'server';
  release_state?: ReleaseState;
  dockerized?: boolean;
  runtime_state: 'running' | 'sleeping';
  backend_state?: 'running' | 'sleeping';
  preview_state?: 'running' | 'sleeping';
  frontend_state?: 'running' | 'sleeping';
  runtime_container?: string | null;
  health_ok?: boolean;
  health_frontend?: boolean;
  health_db_mode?: string | null;
  autofix_inflight?: boolean;
  autofix_cooldown_sec?: number;
  last_access_at?: string | null;
  updated_at: string;
}

export interface AdminInvalidDraft {
  id: number;
  name: string;
  icon: string;
  owner_user_id?: number | null;
  owner_email?: string | null;
  owner_nickname?: string | null;
  release_app_id?: number | null;
  updated_at: string;
}

export interface AdminOrphanAppResource {
  id: number;
  exists_in_db: boolean;
  dir_exists: boolean;
  size_bytes: number;
  size_mb: number;
  runtime_running: boolean;
  runtime_container?: string | null;
  preview_port?: number | null;
  has_versions?: boolean;
  has_prod_db?: boolean;
  has_dev_db?: boolean;
}

export interface AdminActionResult {
  ok: boolean;
  action: string;
  summary: string;
  release: {
    before_release_state?: ReleaseState | null;
    after_release_state?: ReleaseState | null;
    live_version_id?: number | null;
    candidate_version_id?: number | null;
    backup_count?: number;
    rollback_available?: boolean;
    last_promoted_at?: string | null;
  };
  app: App;
}

export type AppStage =
  | 'prototype'
  | 'frontend_ready'
  | 'backend_proposed'
  | 'backend_generated'
  | 'backend_verified'
  | 'release_blocked'
  | 'release_ready'
  | 'published_live' // legacy stage label for live runtime
  | 'repair_needed';

export interface PublishStep {
  id: 'frontend_analyze' | 'backend_sql_generate' | 'verify' | 'db_check' | 'docker_start' | 'health_check' | 'completion' | 'candidate_prepare' | 'candidate_runtime';
  label: string;
  order: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  detail?: string;
  updated_at?: string | null;
}

export interface PublishProgress {
  status: 'idle' | 'publishing' | 'completed' | 'failed' | 'cancelled';
  current_step?: PublishStep['id'] | null;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  steps: PublishStep[];
}

export interface InfrastructureDbTableInfo {
  name: string;
  rowCount: number | null;
  columns: string[];
}

export interface InfrastructureDbOverview {
  dbPath: string;
  exists: boolean;
  tables: InfrastructureDbTableInfo[];
}

export interface InfrastructureDbTableRows {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  limit: number;
  offset: number;
  total: number | null;
}

export interface InfrastructureDbQueryResult {
  mode: 'read' | 'write';
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  changes?: number;
  message?: string;
}

export interface InfrastructureAnalyticsPoint {
  bucket: string;
  label: string;
  visits: number;
  activeUsers: number;
}

export interface InfrastructureAnalyticsResponse {
  range: 'day' | 'week' | 'month';
  summary: {
    visits: number;
    activeUsers: number;
    lastVisitedAt?: string | null;
  };
  points: InfrastructureAnalyticsPoint[];
}

export interface App {
  id: number;
  workspace_slug?: string | null;
  live_version_id?: number | null;
  candidate_version_id?: number | null;
  last_failure_reason?: string | null;
  last_failure_at?: string | null;
  last_promoted_at?: string | null;
  publish_route?: PublishRoute;
  name: string;
  icon: string;
  description: string;
  status: LegacyStatus; // legacy compatibility only; prefer release_state
  app_role?: 'release' | 'draft';
  release_app_id?: number | null;
  review_status?: 'none' | 'pending' | 'approved' | 'rejected';
  publish_status?: 'idle' | 'publishing' | 'failed';
  release_state?: ReleaseState;
  runtime_mode?: 'local' | 'server';
  app_stage?: AppStage;
  stage_reason?: string | null;
  current_version: number;
  version_count?: number;
  is_favorite?: number;
  preview_port?: number | null;
  preview_slug?: string | null;
  preview_path?: string | null;
  preview_url?: string | null;
  public_path?: string | null;
  public_url?: string | null;
  legacy_preview_path?: string | null;
  api_port?: number | null;
  ai_model_key?: string | null;
  color?: string | null;
  publish_progress?: PublishProgress;
  latest_backup_version?: number | null;
  backup_count?: number;
  created_at: string;
  updated_at: string;
  messages?: Message[];
  versions?: AppVersion[];
}

export interface Message {
  id: number;
  app_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}


export interface AppFileNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
  children?: AppFileNode[];
}

export interface AppVersion {
  id: number;
  app_id: number;
  version_number: number;
  label: string | null;
  code: string;
  created_at: string;
}

export interface AutoFixResult {
  ok: boolean;
  versionId: number;
  versionNumber: number;
  previewPort?: number | null;
  previewSlug?: string | null;
  previewPath?: string | null;
  apiPort?: number | null;
  hasBackend?: boolean;
  hasDb?: boolean;
  message?: string;
  code?: string;
  assistant?: string;
  recovered?: boolean;
  browserSmoke?: {
    ok: boolean;
    summary?: string;
    checks?: VerifierCheck[];
    blockingFailures?: VerifierCheck[];
  };
}

export interface BackendStatus {
  ok: boolean;
  running: boolean;
  reachable: boolean;
  apiPort: number | null;
}

export interface VerifierCheck {
  id: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  detail?: string;
  meta?: any;
}

export interface VerifierReport {
  ok: boolean;
  appId: number;
  versionNumber?: number | null;
  runtime?: any;
  health?: any;
  browserSmoke?: any;
  checks: VerifierCheck[];
  blockingFailures: VerifierCheck[];
  summary?: string;
}

const getToken = () => localStorage.getItem('funfo_token');
const getAdminToken = () => localStorage.getItem('funfo_admin_token');
const getGuestKey = () => {
  const key = localStorage.getItem('funfo_guest_key');
  if (key) return key;
  const newKey = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `guest_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  localStorage.setItem('funfo_guest_key', newKey);
  return newKey;
};
const authHeaders = () => {
  const token = getToken();
  const guestKey = getGuestKey();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'X-Guest-Key': guestKey,
  };
};

const adminHeaders = () => {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const api = {
  // Auth
  register: (payload: { email: string; password: string; nickname: string }): Promise<{ token: string; user: User }> =>
    fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '登録に失敗しました');
      return d;
    }),

  login: (payload: { email: string; password: string }): Promise<{ token: string; user: User }> =>
    fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'ログインに失敗しました');
      return d;
    }),

  me: (): Promise<User> =>
    fetch(`${BASE}/auth/me`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '未ログイン');
      return d;
    }),

  checkEmailExists: (email: string): Promise<{ exists: boolean }> =>
    fetch(`${BASE}/auth/check-email?email=${encodeURIComponent(email)}`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'メール確認に失敗しました');
      return d;
    }),

  forgotPassword: (email: string): Promise<{ ok: boolean; resetToken?: string; message?: string }> =>
    fetch(`${BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || '送信失敗');
      return d;
    }),

  resetPassword: (token: string, newPassword: string): Promise<{ ok: boolean }> =>
    fetch(`${BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'リセット失敗');
      return d;
    }),

  updateProfile: (payload: { nickname?: string; avatar_url?: string }): Promise<User> =>
    fetch(`${BASE}/auth/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || '更新失敗');
      return d;
    }),

  changePassword: (oldPassword: string, newPassword: string): Promise<{ ok: boolean }> =>
    fetch(`${BASE}/auth/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ oldPassword, newPassword }),
    }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || '変更失敗');
      return d;
    }),

  logout: (): Promise<{ ok: boolean }> =>
    fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { ...authHeaders() } }).then(r => r.json()),

  publicAiModels: (): Promise<{ ok: boolean; models: PublicAiModel[]; defaultModelKey?: string | null }> =>
    fetch(`${BASE}/ai/models`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'AI model catalog load failed');
      return d;
    }),

  // Apps
  listApps: (): Promise<App[]> =>
    fetch(`${BASE}/apps`, { headers: { ...authHeaders() } }).then(r => r.json()),

  createApp: (data?: Partial<App>): Promise<App> =>
    fetch(`${BASE}/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data || {}),
    }).then(r => r.json()),

  getApp: (id: number): Promise<App> =>
    fetch(`${BASE}/apps/${id}`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'App load failed');
      return d;
    }),

  getWorkspaceApp: (slug: string): Promise<{ ok: boolean; app: App }> =>
    fetch(`${BASE.replace(/\/api$/, '')}/api/workspace/${encodeURIComponent(slug)}`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'workspace app not found');
      return d;
    }),

  updateApp: (id: number, data: Partial<App>): Promise<App> =>
    fetch(`${BASE}/apps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data),
    }).then(r => r.json()),

  publishApp: (id: number): Promise<App> =>
    fetch(`${BASE}/apps/${id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ mode: 'llm_provider' }),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '公開に失敗しました');
      return d;
    }),

  getAppFiles: (id: number): Promise<{ root: string; tree: AppFileNode[] }> =>
    fetch(`${BASE}/apps/${id}/files`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '文件结构获取失败');
      return d;
    }),

  getAppFileContent: (id: number, filePath: string): Promise<{ path: string; content: string; size: number }> =>
    fetch(`${BASE}/apps/${id}/files/content?path=${encodeURIComponent(filePath)}`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '文件内容获取失败');
      return d;
    }),


  getPublishStatus: (id: number): Promise<App> =>
    fetch(`${BASE}/apps/${id}/publish-status`, {
      headers: { ...authHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '公開状態の取得に失敗しました');
      return d;
    }),

  resetFailedPublish: (id: number): Promise<App> =>
    fetch(`${BASE}/apps/${id}/reset-failed-publish`, {
      method: 'POST',
      headers: { ...authHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '重置发布失败状态失败');
      return d;
    }),


  submitReview: (id: number): Promise<App> =>
    fetch(`${BASE}/apps/${id}/submit-review`, {
      method: 'POST',
      headers: { ...authHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '提審に失敗しました');
      return d;
    }),

  setRuntimeMode: (id: number, mode: 'local' | 'server'): Promise<App> =>
    fetch(`${BASE}/apps/${id}/runtime-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ mode }),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '模式切换失败');
      return d;
    }),

  deleteApp: (id: number): Promise<{ ok: boolean }> =>
    fetch(`${BASE}/apps/${id}`, { method: 'DELETE', headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'アプリ削除に失敗しました');
      return d;
    }),

  cloneApp: (id: number): Promise<App> =>
    fetch(`${BASE}/apps/${id}/clone`, { method: 'POST', headers: { ...authHeaders() } }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'コピーに失敗しました');
      return d;
    }),

  ensureWorkspaceDraft: (id: number): Promise<App> =>
    fetch(`${BASE}/apps/${id}/ensure-workspace-draft`, { method: 'POST', headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'ワークスペース作成に失敗しました');
      return d;
    }),

  saveDraft: (id: number): Promise<App> =>
    fetch(`${BASE}/apps/${id}/save-draft`, { method: 'POST', headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '下書き保存に失敗しました');
      return d;
    }),

  cloneReady: (id: number): Promise<{ ok: boolean; ready: boolean; reason?: string }> =>
    fetch(`${BASE}/apps/${id}/clone-ready`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'clone ready check failed');
      return d;
    }),

  favoriteApp: (id: number): Promise<{ ok: boolean }> =>
    fetch(`${BASE}/apps/${id}/favorite`, { method: 'POST', headers: { ...authHeaders() } }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || '保存に失敗しました');
      return d;
    }),

  unfavoriteApp: (id: number): Promise<{ ok: boolean }> =>
    fetch(`${BASE}/apps/${id}/favorite`, { method: 'DELETE', headers: { ...authHeaders() } }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || '解除に失敗しました');
      return d;
    }),

  // Auto-fix based on runtime errors
  autoFixApp: (
    appId: number,
    payload: {
      error: string;
      errorType?: string;
      detail?: string;
      url?: string;
      retries?: number;
    }
  ): Promise<AutoFixResult> =>
    fetch(`${BASE}/apps/${appId}/auto-fix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `Auto-fix failed (${r.status})`);
      return data;
    }),

  // Admin (separate auth)
  adminLogin: (username: string, password: string): Promise<{ token: string; username: string }> =>
    fetch(`${BASE}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '管理者ログイン失敗');
      return d;
    }),

  adminLogout: (): Promise<{ ok: boolean }> =>
    fetch(`${BASE}/admin/logout`, { method: 'POST', headers: { ...adminHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '管理者ログアウト失敗');
      return d;
    }),

  adminAiConfig: (): Promise<AdminAiConfig> =>
    fetch(`${BASE}/admin/ai/config`, { headers: { ...adminHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'AI config load failed');
      return d;
    }),

  adminStartCodexOAuth: (): Promise<AdminOAuthSession> =>
    fetch(`${BASE}/admin/ai/providers/openai-codex/oauth/start`, {
      method: 'POST',
      headers: { ...adminHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'Codex OAuth start failed');
      return d;
    }),

  adminGetCodexOAuthSession: (sessionId: string): Promise<AdminOAuthSession> =>
    fetch(`${BASE}/admin/ai/providers/openai-codex/oauth/${encodeURIComponent(sessionId)}`, {
      headers: { ...adminHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'Codex OAuth session load failed');
      return d;
    }),

  adminSubmitCodexOAuthCode: (sessionId: string, input: string): Promise<AdminOAuthSession> =>
    fetch(`${BASE}/admin/ai/providers/openai-codex/oauth/${encodeURIComponent(sessionId)}/manual-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ input }),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'Codex OAuth code submit failed');
      return d;
    }),

  adminSaveAnthropicProvider: (payload: {
    apiKey: string;
    enabled?: boolean;
    enabledModelIds?: string[];
    defaultModelId?: string | null;
    setAsPlatformDefault?: boolean;
  }): Promise<AdminAiConfig> =>
    fetch(`${BASE}/admin/ai/providers/anthropic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(payload),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'Claude API save failed');
      return d;
    }),

  adminUpdatePlatformDefaultModel: (modelKey: string): Promise<AdminAiConfig> =>
    fetch(`${BASE}/admin/ai/default-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ modelKey }),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'Platform default model update failed');
      return d;
    }),

  adminUpdateAiProviderModels: (providerId: string, payload: {
    enabled?: boolean;
    enabledModelIds?: string[];
    defaultModelId?: string | null;
    setAsPlatformDefault?: boolean;
  }): Promise<AdminAiConfig> =>
    fetch(`${BASE}/admin/ai/providers/${encodeURIComponent(providerId)}/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(payload),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'AI provider models update failed');
      return d;
    }),

  adminDisconnectAiProvider: (providerId: string): Promise<AdminAiConfig> =>
    fetch(`${BASE}/admin/ai/providers/${encodeURIComponent(providerId)}`, {
      method: 'DELETE',
      headers: { ...adminHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'AI provider disconnect failed');
      return d;
    }),

  adminStats: (): Promise<{ users: number; apps: number; pending: number }> =>
    fetch(`${BASE}/admin/stats`, { headers: { ...adminHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '管理統計の取得に失敗しました');
      return d;
    }),

  adminUsers: (): Promise<AdminUser[]> =>
    fetch(`${BASE}/admin/users`, { headers: { ...adminHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'ユーザー一覧の取得に失敗しました');
      return d;
    }),

  adminUserDetail: (id: number): Promise<AdminUserDetail> =>
    fetch(`${BASE}/admin/users/${id}`, { headers: { ...adminHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'ユーザー詳細の取得に失敗しました');
      return d;
    }),

  adminReviewApps: (): Promise<App[]> =>
    fetch(`${BASE}/admin/apps/review`, { headers: { ...adminHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '審査一覧の取得に失敗しました');
      return d;
    }),

  adminAppMemory: (id: number): Promise<AdminAppMemory> =>
    fetch(`${BASE}/admin/apps/${id}/memory`, { headers: { ...adminHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'App memory の取得に失敗しました');
      return d;
    }),

  adminSetAppStatus: (id: number, status: LegacyStatus): Promise<App> => // legacy admin compatibility only; prefer semantic admin actions
    fetch(`${BASE}/admin/apps/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ status }),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '状態更新に失敗しました');
      return d;
    }),

  adminApplyAction: (id: number, action: 'promote_candidate_to_live' | 'revert_to_draft' | 'promote_rollback_to_live' | 'clear_failed_candidate'): Promise<AdminActionResult> =>
    fetch(`${BASE}/admin/apps/${id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ action }),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'Admin action failed');
      return d;
    }),

  adminInvalidReleaseDraftsPreview: (): Promise<{ ok: boolean; drafts: AdminInvalidDraft[]; count: number }> =>
    fetch(`${BASE}/admin/cleanup/invalid-release-drafts`, {
      headers: { ...adminHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '無效 draft 预览失败');
      return d;
    }),

  adminCleanupInvalidReleaseDrafts: (): Promise<{ ok: boolean; deletedIds: number[]; count: number }> =>
    fetch(`${BASE}/admin/cleanup/invalid-release-drafts`, {
      method: 'POST',
      headers: { ...adminHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '無效 draft 清理失败');
      return d;
    }),

  adminOrphanResourcesPreview: (): Promise<{ ok: boolean; items: AdminOrphanAppResource[]; count: number; totalBytes: number; totalMb: number }> =>
    fetch(`${BASE}/admin/cleanup/orphan-app-resources`, {
      headers: { ...adminHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '孤儿资源预览失败');
      return d;
    }),

  adminCleanupOrphanResources: (ids?: number[]): Promise<{ ok: boolean; deletedIds: number[]; count: number; reclaimedBytes: number; reclaimedMb: number }> =>
    fetch(`${BASE}/admin/cleanup/orphan-app-resources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ ids: ids || [] }),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '孤儿资源清理失败');
      return d;
    }),

  adminDeleteApp: (id: number): Promise<{ ok: boolean; deletedIds: number[]; count: number }> =>
    fetch(`${BASE}/admin/apps/${id}`, {
      method: 'DELETE',
      headers: { ...adminHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'App削除に失敗しました');
      return d;
    }),

  adminRuntimes: (): Promise<AdminRuntime[]> =>
    fetch(`${BASE}/admin/runtimes`, { headers: { ...adminHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'Runtime一覧の取得に失敗しました');
      return d;
    }),

  adminWakeRuntime: (id: number): Promise<{ ok: boolean; appId: number; previewPort: number | null; apiPort: number | null }> =>
    fetch(`${BASE}/admin/runtimes/${id}/wake`, {
      method: 'POST',
      headers: { ...adminHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'Runtime起動に失敗しました');
      return d;
    }),

  adminSleepRuntime: (id: number): Promise<{ ok: boolean; appId: number }> =>
    fetch(`${BASE}/admin/runtimes/${id}/sleep`, {
      method: 'POST',
      headers: { ...adminHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'Runtime停止に失敗しました');
      return d;
    }),

  dbCheck: (id: number): Promise<{ ok: boolean; summary: string; applied: string[] }> =>
    fetch(`${BASE}/apps/${id}/db-check`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'DBチェックに失敗しました');
      return d;
    }),

  qaCheck: (id: number): Promise<{ ok: boolean; passed: boolean; summary: string; checks: Array<{name:string; ok:boolean; detail?:string}> }> =>
    fetch(`${BASE}/apps/${id}/qa-check`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'QAチェックに失敗しました');
      return d;
    }),

  verifierReport: (id: number): Promise<{ ok: boolean; report: VerifierReport }> =>
    fetch(`${BASE}/apps/${id}/verifier-report`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'Release verifier 取得に失敗しました');
      return d;
    }),

  releaseRepair: (id: number): Promise<{ ok: boolean; repaired: boolean; report: VerifierReport; message?: string; error?: string }> =>
    fetch(`${BASE}/apps/${id}/release-repair`, {
      method: 'POST',
      headers: { ...authHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'Release repair に失敗しました');
      return d;
    }),

  backendStatus: (appId: number): Promise<BackendStatus> =>
    fetch(`${BASE}/apps/${appId}/backend-status`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'バックエンド状態取得に失敗しました');
      return d;
    }),

  restartBackend: (appId: number): Promise<{ ok: boolean; apiPort: number | null; previewPort: number | null }> =>
    fetch(`${BASE}/apps/${appId}/backend-restart`, {
      method: 'POST',
      headers: { ...authHeaders() },
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'バックエンド再起動に失敗しました');
      return d;
    }),

  getInfrastructureDatabase: (appId: number): Promise<InfrastructureDbOverview> =>
    fetch(`${BASE}/apps/${appId}/infrastructure/database`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '数据库信息获取失败');
      return d;
    }),

  getInfrastructureDatabaseTable: (appId: number, table: string, limit = 20, offset = 0): Promise<InfrastructureDbTableRows> =>
    fetch(`${BASE}/apps/${appId}/infrastructure/database/table/${encodeURIComponent(table)}?limit=${limit}&offset=${offset}`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '表数据获取失败');
      return d;
    }),

  runInfrastructureDatabaseQuery: (appId: number, sql: string): Promise<InfrastructureDbQueryResult> =>
    fetch(`${BASE}/apps/${appId}/infrastructure/database/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ sql }),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '数据库编辑器执行失败');
      return d;
    }),

  getInfrastructureAnalytics: (appId: number, range: 'day' | 'week' | 'month'): Promise<InfrastructureAnalyticsResponse> =>
    fetch(`${BASE}/apps/${appId}/infrastructure/analytics?range=${range}`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '统计分析获取失败');
      return d;
    }),

  // Chat with SSE streaming
  chat: (
    appId: number,
    message: string,
    callbacks: {
      onDelta: (text: string) => void;
      onCode: (code: string, versionId: number, versionNumber: number, previewPort?: number | null, apiPort?: number | null, hasBackend?: boolean, hasDb?: boolean, previewSlug?: string | null, previewPath?: string | null) => void;
      onStatus?: (stage: string, message: string) => void;
      onDone: () => void;
      onError: (msg: string, payload?: any) => void;
    },
    displayMessage?: string,
    mode?: 'create' | 'edit' | 'rewrite',
    modelKey?: string,
  ) => {
    const controller = new AbortController();

    fetch(`${BASE}/apps/${appId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ message, displayMessage, mode, modelKey }),
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok) {
        let msg = `Chat failed (${res.status})`;
        let payload: any = null;
        try {
          payload = await parseJsonSafe(res);
          msg = payload?.error || msg;
        } catch {
          try {
            const t = await res.text();
            if (t) msg = t.slice(0, 160);
          } catch {}
        }
        callbacks.onError(msg, payload);
        return;
      }

      if (!res.body) {
        callbacks.onError('レスポンス本文が空です');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'delta') callbacks.onDelta(data.content);
            else if (data.type === 'code') callbacks.onCode(data.code, data.versionId, data.versionNumber, data.previewPort, data.apiPort, data.hasBackend, data.hasDb, data.previewSlug, data.previewPath);
            else if (data.type === 'status') callbacks.onStatus?.(data.stage || 'info', data.message || '');
            else if (data.type === 'done') callbacks.onDone();
            else if (data.type === 'error') callbacks.onError(data.message);
          } catch {}
        }
      }
    }).catch(err => {
      if (err.name !== 'AbortError') callbacks.onError(err.message);
    });

    return () => controller.abort();
  },
};
