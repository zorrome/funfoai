// API base strategy:
// - Vite dev (3000/5173) 或 Nginx 反代 (80/443)：走同源 /api，由代理到后端 3100，避免 CORS
// - 其他端口（如直连 5175）：直连 hostname:3100
const BASE = (typeof window !== 'undefined' && ['3000', '5173', '80', '443', ''].includes(window.location.port))
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

export interface AdminRuntime {
  id: number;
  name: string;
  icon: string;
  status: 'draft' | 'private' | 'published';
  owner_email?: string | null;
  preview_slug?: string | null;
  preview_path?: string | null;
  preview_port?: number | null;
  api_port?: number | null;
  runtime_state: 'running' | 'sleeping';
  backend_state?: 'running' | 'sleeping';
  preview_state?: 'running' | 'sleeping';
  runtime_container?: string | null;
  health_ok?: boolean;
  autofix_inflight?: boolean;
  autofix_cooldown_sec?: number;
  last_access_at?: string | null;
  updated_at: string;
}

export interface App {
  id: number;
  name: string;
  icon: string;
  description: string;
  status: 'draft' | 'private' | 'published';
  current_version: number;
  version_count?: number;
  is_favorite?: number;
  preview_port?: number | null;
  preview_slug?: string | null;
  preview_path?: string | null;
  preview_url?: string | null;
  api_port?: number | null;
  color?: string | null;
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
}

export interface BackendStatus {
  ok: boolean;
  running: boolean;
  reachable: boolean;
  apiPort: number | null;
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

  generatePlan: (prompt: string): Promise<{ steps: string[]; questionnaire: Array<{ id: string; title: string; options: string[] }> }> =>
    fetch(`${BASE}/apps/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ prompt }),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'プラン生成に失敗しました');
      return d;
    }),

  generateDesignBrief: (prompt: string, paradigm: string): Promise<{ concept: string; styleGuide: string[]; uiChecklist: string[] }> =>
    fetch(`${BASE}/apps/design-brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ prompt, paradigm }),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'デザインブリーフ生成に失敗しました');
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
    fetch(`${BASE}/apps/${id}`, { headers: { ...authHeaders() } }).then(r => r.json()),

  updateApp: (id: number, data: Partial<App>): Promise<App> =>
    fetch(`${BASE}/apps/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data),
    }).then(r => r.json()),

  deleteApp: (id: number): Promise<void> =>
    fetch(`${BASE}/apps/${id}`, { method: 'DELETE', headers: { ...authHeaders() } }).then(r => r.json()),

  cloneApp: (id: number): Promise<App> =>
    fetch(`${BASE}/apps/${id}/clone`, { method: 'POST', headers: { ...authHeaders() } }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'コピーに失敗しました');
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

  adminReviewApps: (): Promise<any[]> =>
    fetch(`${BASE}/admin/apps/review`, { headers: { ...adminHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '審査一覧の取得に失敗しました');
      return d;
    }),

  adminSetAppStatus: (id: number, status: 'draft' | 'private' | 'published'): Promise<App> =>
    fetch(`${BASE}/admin/apps/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ status }),
    }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || '状態更新に失敗しました');
      return d;
    }),

  adminDeleteApp: (id: number): Promise<{ ok: boolean }> =>
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

  qaCheck: (id: number): Promise<{ ok: boolean; passed: boolean; summary: string; checks: Array<{name:string; ok:boolean; detail?:string}> }> =>
    fetch(`${BASE}/apps/${id}/qa-check`, { headers: { ...authHeaders() } }).then(async r => {
      const d = await parseJsonSafe(r);
      if (!r.ok) throw new Error(d?.error || 'QAチェックに失敗しました');
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

  // Chat with SSE streaming
  chat: (
    appId: number,
    message: string,
    callbacks: {
      onDelta: (text: string) => void;
      onCode: (code: string, versionId: number, versionNumber: number, previewPort?: number | null, apiPort?: number | null, hasBackend?: boolean, hasDb?: boolean, previewSlug?: string | null, previewPath?: string | null) => void;
      onDone: () => void;
      onError: (msg: string) => void;
    },
    displayMessage?: string,
  ) => {
    const controller = new AbortController();

    fetch(`${BASE}/apps/${appId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ message, displayMessage }),
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok) {
        let msg = `Chat failed (${res.status})`;
        try {
          const data = await parseJsonSafe(res);
          msg = data?.error || msg;
        } catch {
          try {
            const t = await res.text();
            if (t) msg = t.slice(0, 160);
          } catch {}
        }
        callbacks.onError(msg);
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
