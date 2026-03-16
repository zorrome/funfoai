import { useEffect, useMemo, useState } from 'react';
import { api, AdminAiConfig, AdminAppMemory, AdminInvalidDraft, AdminOAuthSession, AdminOrphanAppResource, AdminRuntime, AdminUser, AdminUserDetail } from '../services/api';
import { AppLang, getLang, setLang, tr } from '../i18n';
import AppFeedbackDialog from '../components/ui/app-feedback-dialog';

export default function Admin() {
  const [token, setToken] = useState(localStorage.getItem('funfo_admin_token') || '');
  const [lang, setLangState] = useState<AppLang>(() => getLang());
  const t = (key: string) => tr(lang, key);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const [stats, setStats] = useState<{ users: number; apps: number; pending: number } | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [appMemory, setAppMemory] = useState<AdminAppMemory | null>(null);
  const [loadingAppMemory, setLoadingAppMemory] = useState(false);
  const [reviewApps, setReviewApps] = useState<any[]>([]);
  const [runtimes, setRuntimes] = useState<AdminRuntime[]>([]);
  const [runtimeActingId, setRuntimeActingId] = useState<number | null>(null);
  const [aiConfig, setAiConfig] = useState<AdminAiConfig | null>(null);
  const [loadingAiConfig, setLoadingAiConfig] = useState(false);
  const [savingAiProvider, setSavingAiProvider] = useState<string | null>(null);
  const [savingPlatformDefault, setSavingPlatformDefault] = useState(false);
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [codexSession, setCodexSession] = useState<AdminOAuthSession | null>(null);
  const [codexManualCode, setCodexManualCode] = useState('');
  const [cleaningInvalidDrafts, setCleaningInvalidDrafts] = useState(false);
  const [previewingInvalidDrafts, setPreviewingInvalidDrafts] = useState(false);
  const [invalidDrafts, setInvalidDrafts] = useState<AdminInvalidDraft[]>([]);
  const [invalidDraftPreviewOpen, setInvalidDraftPreviewOpen] = useState(false);
  const [orphanResources, setOrphanResources] = useState<AdminOrphanAppResource[]>([]);
  const [loadingOrphans, setLoadingOrphans] = useState(false);
  const [cleaningOrphans, setCleaningOrphans] = useState(false);
  const [lastAdminActionSummary, setLastAdminActionSummary] = useState('');
  const [lastAdminActionDetail, setLastAdminActionDetail] = useState('');
  const [notice, setNotice] = useState<null | { tone: 'info' | 'success' | 'warning' | 'danger'; title: string; description: string }>(null);
  const [confirmState, setConfirmState] = useState<null | {
    tone: 'warning' | 'danger';
    title: string;
    description: string;
    confirmText: string;
    busy?: boolean;
    onConfirm: () => Promise<void> | void;
  }>(null);
  const candidateApps = reviewApps.filter(a => (a.release_state || 'draft') === 'candidate');
  const liveApps = reviewApps.filter(a => (a.release_state || 'draft') === 'live');
  const rollbackApps = reviewApps.filter(a => (a.release_state || 'draft') === 'rollback');
  const failedApps = reviewApps.filter(a => (a.release_state || 'draft') === 'failed');
  const describeAdminState = (app: any) => {
    const releaseState = app.release_state || 'draft';
    const reviewStatus = app.review_status || 'none';
    return `release:${releaseState} · review:${reviewStatus} · legacy:${app.status || 'draft'}`;
  };
  const describeReleaseMeta = (app: any) => {
    const parts = [
      `live_v:${app.live_version_id ?? '-'}`,
      `candidate_v:${app.candidate_version_id ?? '-'}`,
      `backups:${app.backup_count ?? 0}`,
      `latest_backup:${app.latest_backup_version ?? '-'}`,
      `last_promoted:${app.last_promoted_at || '-'}`,
    ];
    return parts.join(' · ');
  };
  const orphanSummary = useMemo(() => orphanResources.reduce((acc, item) => {
    acc.count += 1;
    acc.totalMb += Number(item.size_mb || 0);
    if (item.runtime_running) acc.running += 1;
    return acc;
  }, { count: 0, totalMb: 0, running: 0 }), [orphanResources]);
  const codexProvider = useMemo(() => aiConfig?.providers.find(item => item.providerId === 'openai-codex') || null, [aiConfig]);
  const anthropicProvider = useMemo(() => aiConfig?.providers.find(item => item.providerId === 'anthropic') || null, [aiConfig]);

  const refreshAiConfig = async () => {
    setLoadingAiConfig(true);
    try {
      const next = await api.adminAiConfig();
      setAiConfig(next);
    } finally {
      setLoadingAiConfig(false);
    }
  };

  const load = async () => {
    const [s, u, r, rt, orphan, ai] = await Promise.all([
      api.adminStats(),
      api.adminUsers(),
      api.adminReviewApps(),
      api.adminRuntimes(),
      api.adminOrphanResourcesPreview().catch(() => ({ items: [] as AdminOrphanAppResource[] })),
      api.adminAiConfig().catch(() => null),
    ]);
    setStats(s); setUsers(u); setReviewApps(r); setRuntimes(rt); setOrphanResources(orphan.items || []);
    if (ai) setAiConfig(ai);
  };

  const patchProviderDraft = (providerId: string, updater: (provider: NonNullable<AdminAiConfig['providers'][number]>) => NonNullable<AdminAiConfig['providers'][number]>) => {
    setAiConfig(prev => prev ? {
      ...prev,
      providers: prev.providers.map(provider => provider.providerId === providerId ? updater({ ...provider, enabledModelIds: [...provider.enabledModelIds] }) : provider),
    } : prev);
  };

  const toggleProviderModelDraft = (providerId: string, modelId: string) => {
    patchProviderDraft(providerId, provider => {
      const enabledModelIds = provider.enabledModelIds.includes(modelId)
        ? provider.enabledModelIds.filter(id => id !== modelId)
        : [...provider.enabledModelIds, modelId];
      return {
        ...provider,
        enabledModelIds,
        defaultModelId: enabledModelIds.includes(provider.defaultModelId || '') ? provider.defaultModelId : (enabledModelIds[0] || null),
        enabled: enabledModelIds.length ? provider.enabled : false,
      };
    });
  };

  const saveProviderModels = async (providerId: string) => {
    const provider = aiConfig?.providers.find(item => item.providerId === providerId);
    if (!provider) return;
    try {
      setSavingAiProvider(providerId);
      setError('');
      const next = await api.adminUpdateAiProviderModels(providerId, {
        enabled: provider.enabled,
        enabledModelIds: provider.enabledModelIds,
        defaultModelId: provider.defaultModelId || null,
      });
      setAiConfig(next);
    } catch (e: any) {
      setError(e?.message || 'AI provider save failed');
    } finally {
      setSavingAiProvider(null);
    }
  };

  const disconnectAiProvider = async (providerId: string) => {
    try {
      setSavingAiProvider(providerId);
      setError('');
      const next = await api.adminDisconnectAiProvider(providerId);
      setAiConfig(next);
      if (providerId === 'openai-codex') {
        setCodexSession(null);
        setCodexManualCode('');
      }
    } catch (e: any) {
      setError(e?.message || 'AI provider disconnect failed');
    } finally {
      setSavingAiProvider(null);
    }
  };

  const saveAnthropicConnection = async () => {
    if (!anthropicApiKey.trim()) {
      setError('请输入 Claude API key');
      return;
    }
    try {
      setSavingAiProvider('anthropic-connect');
      setError('');
      const next = await api.adminSaveAnthropicProvider({
        apiKey: anthropicApiKey.trim(),
        enabled: anthropicProvider?.enabled ?? true,
        enabledModelIds: anthropicProvider?.enabledModelIds,
        defaultModelId: anthropicProvider?.defaultModelId || null,
      });
      setAiConfig(next);
      setAnthropicApiKey('');
    } catch (e: any) {
      setError(e?.message || 'Claude API save failed');
    } finally {
      setSavingAiProvider(null);
    }
  };

  const startCodexOAuth = async () => {
    try {
      setSavingAiProvider('openai-codex-connect');
      setError('');
      const session = await api.adminStartCodexOAuth();
      setCodexSession(session);
      if (session.authUrl) {
        window.open(session.authUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (e: any) {
      setError(e?.message || 'Codex OAuth start failed');
    } finally {
      setSavingAiProvider(null);
    }
  };

  const submitCodexManualCode = async () => {
    if (!codexSession?.id || !codexManualCode.trim()) return;
    try {
      setSavingAiProvider('openai-codex-manual');
      setError('');
      const nextSession = await api.adminSubmitCodexOAuthCode(codexSession.id, codexManualCode.trim());
      setCodexSession(nextSession);
      setCodexManualCode('');
      if (nextSession.status === 'completed') {
        await refreshAiConfig();
      }
    } catch (e: any) {
      setError(e?.message || 'Codex OAuth code submit failed');
    } finally {
      setSavingAiProvider(null);
    }
  };

  const savePlatformDefaultModel = async () => {
    if (!aiConfig?.defaultModelKey) return;
    try {
      setSavingPlatformDefault(true);
      setError('');
      const next = await api.adminUpdatePlatformDefaultModel(aiConfig.defaultModelKey);
      setAiConfig(next);
    } catch (e: any) {
      setError(e?.message || 'Platform default model save failed');
    } finally {
      setSavingPlatformDefault(false);
    }
  };

  const applyAdminAction = async (id: number, action: 'promote_candidate_to_live' | 'revert_to_draft' | 'promote_rollback_to_live' | 'clear_failed_candidate', fallbackError: string) => {
    try {
      setError('');
      const result = await api.adminApplyAction(id, action);
      setLastAdminActionSummary(result.summary || `${action} finished for #${id}`);
      const release = result.release || {};
      setLastAdminActionDetail([
        `before:${release.before_release_state || '-'}`,
        `after:${release.after_release_state || '-'}`,
        `live_v:${release.live_version_id ?? '-'}`,
        `candidate_v:${release.candidate_version_id ?? '-'}`,
        `backups:${release.backup_count ?? 0}`,
        `rollback:${release.rollback_available ? 'yes' : 'no'}`,
      ].join(' · '));
      await load();
    } catch (e: any) {
      setError(e?.message || fallbackError);
    }
  };

  const removeApp = async (id: number) => {
    setConfirmState({
      tone: 'danger',
      title: '删除 App',
      description: `确定要删除 App #${id} 吗？这个操作不可恢复。`,
      confirmText: '确认删除',
      onConfirm: async () => {
        try {
          await api.adminDeleteApp(id);
          if (detail?.apps?.some(a => a.id === id)) {
            setDetail(await api.adminUserDetail(detail.id));
          }
          if (appMemory?.appId === id) setAppMemory(null);
          await load();
          setConfirmState(null);
          setNotice({ tone: 'success', title: '删除完成', description: `App #${id} 已删除。` });
        } catch (e: any) {
          setConfirmState(null);
          setError(e?.message || '削除に失敗しました');
        }
      },
    });
  };

  const openAppMemory = async (id: number) => {
    try {
      setLoadingAppMemory(true);
      setError('');
      setAppMemory(await api.adminAppMemory(id));
    } catch (e: any) {
      setError(e?.message || 'App memory 读取失败');
    } finally {
      setLoadingAppMemory(false);
    }
  };

  const openInvalidDraftPreview = async () => {
    try {
      setPreviewingInvalidDrafts(true);
      setError('');
      const result = await api.adminInvalidReleaseDraftsPreview();
      setInvalidDrafts(result.drafts || []);
      setInvalidDraftPreviewOpen(true);
    } catch (e: any) {
      setError(e?.message || '预览无效 draft 失败');
    } finally {
      setPreviewingInvalidDrafts(false);
    }
  };

  const confirmCleanupInvalidDrafts = async () => {
    try {
      setCleaningInvalidDrafts(true);
      setError('');
      const result = await api.adminCleanupInvalidReleaseDrafts();
      await load();
      setInvalidDrafts([]);
      setInvalidDraftPreviewOpen(false);
      setNotice({
        tone: result.count > 0 ? 'success' : 'info',
        title: result.count > 0 ? '无效 Draft 已清理' : '没有可清理的无效 Draft',
        description: result.count > 0 ? `已清理 ${result.count} 个无效 draft：#${result.deletedIds.join(', #')}` : '没有发现无效 release_app_id draft',
      });
    } catch (e: any) {
      setError(e?.message || '清理失败');
    } finally {
      setCleaningInvalidDrafts(false);
    }
  };

  const refreshOrphans = async () => {
    try {
      setLoadingOrphans(true);
      setError('');
      const result = await api.adminOrphanResourcesPreview();
      setOrphanResources(result.items || []);
    } catch (e: any) {
      setError(e?.message || '加载孤儿资源失败');
    } finally {
      setLoadingOrphans(false);
    }
  };

  const cleanupOrphans = async (ids?: number[]) => {
    const targets = ids && ids.length ? ids : orphanResources.map(item => item.id);
    if (!targets.length) {
      setNotice({ tone: 'info', title: '没有可清理的孤儿资源', description: '当前没有发现可释放的 orphan app 资源。' });
      return;
    }
    setConfirmState({
      tone: 'danger',
      title: '释放孤儿资源',
      description: `将释放 ${targets.length} 个孤儿 app 资源，包含目录和残留 runtime。这个操作不可恢复。`,
      confirmText: targets.length === 1 ? '确认释放' : `确认释放 ${targets.length} 个`,
      onConfirm: async () => {
        try {
          setCleaningOrphans(true);
          setError('');
          const result = await api.adminCleanupOrphanResources(targets);
          await refreshOrphans();
          await load();
          setConfirmState(null);
          setNotice({
            tone: result.count > 0 ? 'success' : 'info',
            title: result.count > 0 ? '孤儿资源已释放' : '没有释放任何孤儿资源',
            description: result.count > 0 ? `已释放 ${result.count} 个 orphan app，回收约 ${result.reclaimedMb} MB` : '没有释放任何 orphan app',
          });
        } catch (e: any) {
          setConfirmState(null);
          setError(e?.message || '清理孤儿资源失败');
        } finally {
          setCleaningOrphans(false);
        }
      },
    });
  };

  useEffect(() => {
    if (!token) return;
    load().catch(e => setError(e?.message || 'load failed'));
  }, [token]);

  useEffect(() => {
    if (!codexSession?.id) return;
    if (!['starting', 'waiting_auth', 'awaiting_browser', 'manual_code_submitted'].includes(codexSession.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await api.adminGetCodexOAuthSession(codexSession.id);
        setCodexSession(next);
        if (next.status === 'completed') {
          await refreshAiConfig();
        }
      } catch {}
    }, 1500);
    return () => window.clearInterval(timer);
  }, [codexSession?.id, codexSession?.status]);

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white border rounded-xl shadow p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Admin Login</h1>
            <select value={lang} onChange={e => { const v = e.target.value as AppLang; setLangState(v); setLang(v); }} className="h-8 text-xs border rounded px-2">
              <option value="ja">日本語</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </div>
          <input className="w-full border rounded px-3 py-2" value={username} onChange={e => setUsername(e.target.value)} />
          <input className="w-full border rounded px-3 py-2" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="password" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            className="w-full bg-indigo-600 text-white rounded px-3 py-2"
            onClick={async () => {
              try {
                setError('');
                const r = await api.adminLogin(username, password);
                localStorage.setItem('funfo_admin_token', r.token);
                setToken(r.token);
              } catch (e: any) { setError(e?.message || 'login failed'); }
            }}
          >ログイン</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Admin</h1>
          <p className="text-sm text-slate-500 mt-1">可手动清理历史脏 draft，也可深度删除 app 及其文件。</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <select value={lang} onChange={e => { const v = e.target.value as AppLang; setLangState(v); setLang(v); }} className="h-8 text-xs border rounded px-2 bg-white">
            <option value="ja">日本語</option>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
          <button
            className="border rounded px-3 py-2 bg-amber-50 text-amber-800 border-amber-200 disabled:opacity-50"
            disabled={cleaningInvalidDrafts || previewingInvalidDrafts}
            onClick={openInvalidDraftPreview}
          >{previewingInvalidDrafts ? '加载预览中…' : '预览并清理无效 Draft'}</button>
          <button className="border rounded px-3 py-2" onClick={async () => {
            await api.adminLogout().catch(() => {});
            localStorage.removeItem('funfo_admin_token');
            setToken('');
          }}>{t('logout')}</button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 text-sm">{error}</div>}
      {!error && !!lastAdminActionSummary && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded px-3 py-2 text-sm">
          <div>{lastAdminActionSummary}</div>
          {!!lastAdminActionDetail && <div className="text-[11px] text-emerald-800/80 mt-1">{lastAdminActionDetail}</div>}
        </div>
      )}

      <AppFeedbackDialog
        open={!!confirmState}
        tone={confirmState?.tone || 'warning'}
        title={confirmState?.title || ''}
        description={confirmState?.description || ''}
        confirmText={confirmState?.confirmText || '确定'}
        cancelText="取消"
        busy={cleaningOrphans}
        onCancel={() => { if (!cleaningOrphans) setConfirmState(null); }}
        onConfirm={async () => { await confirmState?.onConfirm?.(); }}
      />
      <AppFeedbackDialog
        open={!!notice}
        tone={notice?.tone || 'info'}
        title={notice?.title || ''}
        description={notice?.description || ''}
        confirmText="知道了"
        hideCancel
        onCancel={() => setNotice(null)}
        onConfirm={() => setNotice(null)}
      />

      {invalidDraftPreviewOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b bg-slate-50 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">将要被清理的无效 draft 列表</h2>
                <p className="text-sm text-slate-500 mt-1">先确认名单，再执行删除。会同时清理这些 draft 的文件夹与关联数据。</p>
              </div>
              <button className="px-3 py-1.5 rounded border bg-white text-sm" onClick={() => setInvalidDraftPreviewOpen(false)} disabled={cleaningInvalidDrafts}>关闭</button>
            </div>
            <div className="max-h-[60vh] overflow-auto p-5 space-y-3 bg-white">
              {invalidDrafts.length === 0 ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">没有发现无效 release_app_id draft，可以不用清理。</div>
              ) : (
                invalidDrafts.map(draft => (
                  <div key={draft.id} className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-slate-900">{draft.icon} {draft.name} <span className="text-xs text-slate-400">#{draft.id}</span></div>
                      <div className="text-xs text-slate-500 mt-1">owner: {draft.owner_email || draft.owner_nickname || 'unknown'} · invalid release_app_id: {draft.release_app_id ?? '-'}</div>
                    </div>
                    <div className="text-[11px] text-slate-400 whitespace-nowrap">{draft.updated_at}</div>
                  </div>
                ))
              )}
            </div>
            <div className="px-5 py-4 border-t bg-slate-50 flex items-center justify-between gap-3">
              <div className="text-sm text-slate-500">共 {invalidDrafts.length} 个待清理对象</div>
              <div className="flex items-center gap-2">
                <button className="px-3 py-2 rounded border bg-white text-sm" onClick={() => setInvalidDraftPreviewOpen(false)} disabled={cleaningInvalidDrafts}>取消</button>
                <button
                  className="px-3 py-2 rounded bg-red-600 text-white text-sm disabled:opacity-50"
                  disabled={cleaningInvalidDrafts || invalidDrafts.length === 0}
                  onClick={confirmCleanupInvalidDrafts}
                >{cleaningInvalidDrafts ? '清理中…' : '确认删除这些 Draft'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border rounded p-4"><p className="text-slate-500 text-sm">用户数量</p><p className="text-3xl font-bold">{stats?.users ?? '-'}</p></div>
        <div className="bg-white border rounded p-4"><p className="text-slate-500 text-sm">App数量</p><p className="text-3xl font-bold">{stats?.apps ?? '-'}</p></div>
        <div className="bg-white border rounded p-4"><p className="text-slate-500 text-sm">Candidate / 待审核</p><p className="text-3xl font-bold">{stats?.pending ?? '-'}</p></div>
      </div>

      <div className="bg-white border rounded p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold">Platform AI</h2>
            <p className="text-xs text-slate-500 mt-1">这里配置平台级 provider。普通用户只会在生成界面看到你开放出来的模型。</p>
          </div>
          <button className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-sm disabled:opacity-50" onClick={() => refreshAiConfig().catch(e => setError(e?.message || 'ai config load failed'))} disabled={loadingAiConfig}>
            {loadingAiConfig ? '刷新中…' : '刷新 AI 配置'}
          </button>
        </div>

        {!aiConfig ? (
          <p className="text-sm text-slate-500">正在加载 AI 配置…</p>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-end gap-3 flex-wrap">
              <div className="min-w-[260px]">
                <div className="text-xs font-medium text-slate-500 mb-1">平台默认模型</div>
                <select
                  value={aiConfig.defaultModelKey || ''}
                  onChange={e => setAiConfig(prev => prev ? { ...prev, defaultModelKey: e.target.value } : prev)}
                  className="w-full border rounded px-3 py-2 bg-white text-sm"
                >
                  {aiConfig.publicModels.length === 0 && <option value="">暂无可公开模型</option>}
                  {aiConfig.publicModels.map(model => (
                    <option key={model.key} value={model.key}>{model.providerLabel} / {model.name}</option>
                  ))}
                </select>
              </div>
              <button
                className="px-3 py-2 rounded bg-slate-900 text-white text-sm disabled:opacity-50"
                disabled={savingPlatformDefault || !aiConfig.defaultModelKey}
                onClick={savePlatformDefaultModel}
              >
                {savingPlatformDefault ? '保存中…' : '保存默认模型'}
              </button>
              <div className="text-xs text-slate-500">当前公开模型数：{aiConfig.publicModels.length}</div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="border rounded-xl p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Codex OAuth</h3>
                    <p className="text-xs text-slate-500 mt-1">用平台自己的 Codex OAuth 连接 OpenAI，再决定给用户开放哪些 GPT/Codex 模型。</p>
                  </div>
                  <div className="text-xs">
                    <span className={`px-2 py-1 rounded-full ${codexProvider?.connected ? 'bg-emerald-100 text-emerald-700' : codexProvider?.connectionStatus === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                      {codexProvider?.connected ? '已连接' : codexProvider?.connectionStatus === 'error' ? '连接异常' : '未连接'}
                    </span>
                  </div>
                </div>

                {codexProvider?.metadata?.accountId && (
                  <div className="text-xs text-slate-500">accountId: {codexProvider.metadata.accountId}</div>
                )}
                {codexProvider?.lastError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{codexProvider.lastError}</div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    className="px-3 py-2 rounded bg-slate-900 text-white text-sm disabled:opacity-50"
                    disabled={savingAiProvider === 'openai-codex-connect'}
                    onClick={startCodexOAuth}
                  >
                    {savingAiProvider === 'openai-codex-connect' ? '启动中…' : (codexProvider?.connected ? '重新连接 Codex' : '连接 Codex')}
                  </button>
                  <button
                    className="px-3 py-2 rounded border text-sm disabled:opacity-50"
                    disabled={savingAiProvider === 'openai-codex' || !codexProvider?.connected}
                    onClick={() => disconnectAiProvider('openai-codex')}
                  >
                    断开连接
                  </button>
                </div>

                {codexSession && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-3">
                    <div className="text-xs text-slate-600">OAuth 状态：<b>{codexSession.status}</b></div>
                    {codexSession.authUrl && (
                      <div className="text-xs text-slate-600 break-all">
                        <a className="text-indigo-600 hover:underline" href={codexSession.authUrl} target="_blank" rel="noreferrer">{codexSession.authUrl}</a>
                      </div>
                    )}
                    {codexSession.instructions && <div className="text-xs text-slate-500">{codexSession.instructions}</div>}
                    {!!codexSession.progress?.length && (
                      <div className="text-xs text-slate-500 space-y-1">
                        {codexSession.progress.map((item, index) => <div key={`${item}-${index}`}>{item}</div>)}
                      </div>
                    )}
                    {codexSession.status !== 'completed' && codexSession.status !== 'failed' && (
                      <div className="flex items-center gap-2">
                        <input
                          value={codexManualCode}
                          onChange={e => setCodexManualCode(e.target.value)}
                          className="flex-1 border rounded px-3 py-2 text-sm bg-white"
                          placeholder="浏览器回调失败时，可粘贴 code 或完整 redirect URL"
                        />
                        <button
                          className="px-3 py-2 rounded bg-white border text-sm disabled:opacity-50"
                          disabled={!codexManualCode.trim() || savingAiProvider === 'openai-codex-manual'}
                          onClick={submitCodexManualCode}
                        >
                          {savingAiProvider === 'openai-codex-manual' ? '提交中…' : '提交 code'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500">开放给用户的模型</div>
                  <div className="max-h-[220px] overflow-auto space-y-2 border rounded-lg p-3 bg-slate-50/70">
                    {codexProvider?.availableModels.map(model => (
                      <label key={model.id} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={codexProvider.enabledModelIds.includes(model.id)}
                          disabled={!codexProvider.connected}
                          onChange={() => toggleProviderModelDraft('openai-codex', model.id)}
                        />
                        <span>{model.name}</span>
                        <span className="text-[11px] text-slate-400">{model.id}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex items-end gap-3 flex-wrap">
                  <div>
                    <div className="text-xs font-medium text-slate-500 mb-1">Codex 默认模型</div>
                    <select
                      value={codexProvider?.defaultModelId || ''}
                      disabled={!codexProvider?.enabledModelIds.length}
                      onChange={e => patchProviderDraft('openai-codex', provider => ({ ...provider, defaultModelId: e.target.value || null }))}
                      className="border rounded px-3 py-2 bg-white text-sm min-w-[220px]"
                    >
                      {codexProvider?.enabledModelIds.length === 0 && <option value="">请先勾选模型</option>}
                      {codexProvider?.availableModels.filter(model => codexProvider.enabledModelIds.includes(model.id)).map(model => (
                        <option key={model.id} value={model.id}>{model.name}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={!!codexProvider?.enabled}
                      disabled={!codexProvider?.connected || !(codexProvider?.enabledModelIds.length)}
                      onChange={e => patchProviderDraft('openai-codex', provider => ({ ...provider, enabled: e.target.checked }))}
                    />
                    <span>对用户开放</span>
                  </label>
                  <button
                    className="px-3 py-2 rounded bg-slate-900 text-white text-sm disabled:opacity-50"
                    disabled={savingAiProvider === 'openai-codex' || !codexProvider?.connected}
                    onClick={() => saveProviderModels('openai-codex')}
                  >
                    {savingAiProvider === 'openai-codex' ? '保存中…' : '保存 Codex 模型策略'}
                  </button>
                </div>
              </div>

              <div className="border rounded-xl p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Claude API</h3>
                    <p className="text-xs text-slate-500 mt-1">平台保存自己的 Anthropic API key，再决定给用户开放哪些 Claude 模型。</p>
                  </div>
                  <div className="text-xs">
                    <span className={`px-2 py-1 rounded-full ${anthropicProvider?.connected ? 'bg-emerald-100 text-emerald-700' : anthropicProvider?.connectionStatus === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                      {anthropicProvider?.connected ? '已连接' : anthropicProvider?.connectionStatus === 'error' ? '连接异常' : '未连接'}
                    </span>
                  </div>
                </div>

                {anthropicProvider?.credentialHint && (
                  <div className="text-xs text-slate-500">当前保存：{anthropicProvider.credentialHint}</div>
                )}
                {anthropicProvider?.lastError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{anthropicProvider.lastError}</div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={anthropicApiKey}
                    onChange={e => setAnthropicApiKey(e.target.value)}
                    className="flex-1 border rounded px-3 py-2 text-sm"
                    placeholder={anthropicProvider?.connected ? '如需更换 Claude API key，请重新输入' : '输入 Claude API key'}
                  />
                  <button
                    className="px-3 py-2 rounded bg-slate-900 text-white text-sm disabled:opacity-50"
                    disabled={savingAiProvider === 'anthropic-connect'}
                    onClick={saveAnthropicConnection}
                  >
                    {savingAiProvider === 'anthropic-connect' ? '保存中…' : (anthropicProvider?.connected ? '更新 key' : '保存 key')}
                  </button>
                  <button
                    className="px-3 py-2 rounded border text-sm disabled:opacity-50"
                    disabled={savingAiProvider === 'anthropic' || !anthropicProvider?.connected}
                    onClick={() => disconnectAiProvider('anthropic')}
                  >
                    断开连接
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500">开放给用户的模型</div>
                  <div className="max-h-[220px] overflow-auto space-y-2 border rounded-lg p-3 bg-slate-50/70">
                    {anthropicProvider?.availableModels.map(model => (
                      <label key={model.id} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={anthropicProvider.enabledModelIds.includes(model.id)}
                          disabled={!anthropicProvider.connected}
                          onChange={() => toggleProviderModelDraft('anthropic', model.id)}
                        />
                        <span>{model.name}</span>
                        <span className="text-[11px] text-slate-400">{model.id}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex items-end gap-3 flex-wrap">
                  <div>
                    <div className="text-xs font-medium text-slate-500 mb-1">Claude 默认模型</div>
                    <select
                      value={anthropicProvider?.defaultModelId || ''}
                      disabled={!anthropicProvider?.enabledModelIds.length}
                      onChange={e => patchProviderDraft('anthropic', provider => ({ ...provider, defaultModelId: e.target.value || null }))}
                      className="border rounded px-3 py-2 bg-white text-sm min-w-[220px]"
                    >
                      {anthropicProvider?.enabledModelIds.length === 0 && <option value="">请先勾选模型</option>}
                      {anthropicProvider?.availableModels.filter(model => anthropicProvider.enabledModelIds.includes(model.id)).map(model => (
                        <option key={model.id} value={model.id}>{model.name}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={!!anthropicProvider?.enabled}
                      disabled={!anthropicProvider?.connected || !(anthropicProvider?.enabledModelIds.length)}
                      onChange={e => patchProviderDraft('anthropic', provider => ({ ...provider, enabled: e.target.checked }))}
                    />
                    <span>对用户开放</span>
                  </label>
                  <button
                    className="px-3 py-2 rounded bg-slate-900 text-white text-sm disabled:opacity-50"
                    disabled={savingAiProvider === 'anthropic' || !anthropicProvider?.connected}
                    onClick={() => saveProviderModels('anthropic')}
                  >
                    {savingAiProvider === 'anthropic' ? '保存中…' : '保存 Claude 模型策略'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bg-white border rounded p-4 space-y-3">
        <h2 className="font-semibold">Candidate / 待审核 App</h2>
        <p className="text-xs text-slate-500">删除会深度清理：messages / versions / favorites / publish jobs / release backups / server/apps 文件夹；若该 app 下面挂着 workspace draft，也会一并清掉。</p>
        <div className="space-y-2">
          {candidateApps.length === 0 && <p className="text-sm text-slate-500">暂无 Candidate App</p>}
          {candidateApps.map(a => (
            <div key={a.id} className="border rounded p-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{a.icon} {a.name} <span className="text-xs text-slate-400">#{a.id}</span></div>
                <div className="text-xs text-slate-500">{a.owner_email || 'unknown'} · {describeAdminState(a)}</div>
                <div className="text-[11px] text-slate-400 mt-1">{describeReleaseMeta(a)}</div>
                {(a.last_failure_reason || a.last_failure_at) && (
                  <div className="text-[11px] text-rose-600 mt-1">last failure: {a.last_failure_at || '-'} {a.last_failure_reason ? `· ${a.last_failure_reason}` : ''}</div>
                )}
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm" onClick={async () => { try { await api.adminApplyAction(a.id, 'mark_live'); await load(); } catch (e: any) { setError(e?.message || '标记 live 失败'); } }}>标记为 Live</button>
                <button className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-sm" onClick={async () => { try { await api.adminApplyAction(a.id, 'send_to_draft'); await load(); } catch (e: any) { setError(e?.message || '退回 draft 失败'); } }}>退回 Draft</button>
                <button className="px-3 py-1.5 rounded bg-red-600 text-white text-sm" onClick={() => removeApp(a.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded p-4 space-y-3">
        <h2 className="font-semibold">Live App</h2>
        <div className="space-y-2">
          {liveApps.length === 0 && <p className="text-sm text-slate-500">暂无 Live App</p>}
          {liveApps.map(a => (
            <div key={a.id} className="border rounded p-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{a.icon} {a.name} <span className="text-xs text-slate-400">#{a.id}</span></div>
                <div className="text-xs text-slate-500">{a.owner_email || 'unknown'} · {describeAdminState(a)}</div>
                <div className="text-[11px] text-slate-400 mt-1">{describeReleaseMeta(a)}</div>
                {(a.last_failure_reason || a.last_failure_at) && (
                  <div className="text-[11px] text-rose-600 mt-1">last failure: {a.last_failure_at || '-'} {a.last_failure_reason ? `· ${a.last_failure_reason}` : ''}</div>
                )}
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-sm" onClick={async () => { try { await api.adminApplyAction(a.id, 'send_to_draft'); await load(); } catch (e: any) { setError(e?.message || '回到 draft 失败'); } }}>回到 Draft</button>
                <button className="px-3 py-1.5 rounded bg-red-600 text-white text-sm" onClick={() => removeApp(a.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white border rounded p-4 space-y-3">
          <h2 className="font-semibold">Rollback App</h2>
          <div className="space-y-2">
            {rollbackApps.length === 0 && <p className="text-sm text-slate-500">暂无 Rollback App</p>}
            {rollbackApps.map(a => (
              <div key={a.id} className="border rounded p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{a.icon} {a.name} <span className="text-xs text-slate-400">#{a.id}</span></div>
                  <div className="text-xs text-slate-500">{a.owner_email || 'unknown'} · {describeAdminState(a)}</div>
                  <div className="text-[11px] text-slate-400 mt-1">{describeReleaseMeta(a)}</div>
                  {(a.last_failure_reason || a.last_failure_at) && (
                    <div className="text-[11px] text-rose-600 mt-1">last failure: {a.last_failure_at || '-'} {a.last_failure_reason ? `· ${a.last_failure_reason}` : ''}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm" onClick={() => applyAdminAction(a.id, 'promote_rollback_to_live', '恢复 live 失败')}>Promote Rollback → Live</button>
                  <button className="px-3 py-1.5 rounded bg-red-600 text-white text-sm" onClick={() => removeApp(a.id)}>删除</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border rounded p-4 space-y-3">
          <h2 className="font-semibold">Failed Candidate</h2>
          <div className="space-y-2">
            {failedApps.length === 0 && <p className="text-sm text-slate-500">暂无 Failed Candidate</p>}
            {failedApps.map(a => (
              <div key={a.id} className="border rounded p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{a.icon} {a.name} <span className="text-xs text-slate-400">#{a.id}</span></div>
                  <div className="text-xs text-slate-500">{a.owner_email || 'unknown'} · {describeAdminState(a)}</div>
                  <div className="text-[11px] text-slate-400 mt-1">{describeReleaseMeta(a)}</div>
                  {(a.last_failure_reason || a.last_failure_at) && (
                    <div className="text-[11px] text-rose-600 mt-1">last failure: {a.last_failure_at || '-'} {a.last_failure_reason ? `· ${a.last_failure_reason}` : ''}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-sm" onClick={async () => { try { await api.adminApplyAction(a.id, 'clear_failed_candidate'); await load(); } catch (e: any) { setError(e?.message || '清回 draft 失败'); } }}>清回 Draft</button>
                  <button className="px-3 py-1.5 rounded bg-red-600 text-white text-sm" onClick={() => removeApp(a.id)}>删除</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white border rounded p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold">孤儿资源管理</h2>
            <p className="text-xs text-slate-500 mt-1">这里列出数据库里已经不存在，但 server/apps 目录或 runtime 还残留的 app 资源。</p>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-sm disabled:opacity-50" disabled={loadingOrphans || cleaningOrphans} onClick={refreshOrphans}>{loadingOrphans ? '刷新中…' : '刷新'}</button>
            <button className="px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:opacity-50" disabled={cleaningOrphans || orphanResources.length === 0} onClick={() => cleanupOrphans()}>{cleaningOrphans ? '清理中…' : '释放全部孤儿资源'}</button>
          </div>
        </div>
        <div className="text-sm text-slate-600">共 <b>{orphanSummary.count}</b> 个孤儿 app，占用约 <b>{orphanSummary.totalMb.toFixed(2)} MB</b>，其中运行中 <b>{orphanSummary.running}</b> 个。</div>
        <div className="space-y-2 max-h-[280px] overflow-auto">
          {orphanResources.length === 0 && <p className="text-sm text-slate-500">暂无孤儿资源</p>}
          {orphanResources.map(item => (
            <div key={item.id} className="border rounded p-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">🧹 Orphan App <span className="text-xs text-slate-400">#{item.id}</span></div>
                <div className="text-xs text-slate-500">size: {item.size_mb} MB · versions:{item.has_versions ? 'yes' : 'no'} · prodDB:{item.has_prod_db ? 'yes' : 'no'} · runtime:{item.runtime_running ? 'running' : 'stopped'}</div>
                <div className="text-[11px] text-slate-400">container: {item.runtime_container || '-'} · preview port: {item.preview_port || '-'}</div>
              </div>
              <button className="px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:opacity-50" disabled={cleaningOrphans} onClick={() => cleanupOrphans([item.id])}>{cleaningOrphans ? '处理中…' : '释放'}</button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Runtime 面板</h2>
          <button className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-sm" onClick={() => load().catch(e => setError(e?.message || 'load failed'))}>刷新</button>
        </div>
        <div className="space-y-2 max-h-[320px] overflow-auto">
          {runtimes.length === 0 && <p className="text-sm text-slate-500">暂无 runtime 数据</p>}
          {runtimes.map(rt => (
            <div key={rt.id} className="border rounded p-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{rt.icon} {rt.name} <span className="text-xs text-slate-400">#{rt.id}</span></div>
                <div className="text-xs text-slate-500">
                  {rt.owner_email || 'unknown'} · release:{rt.release_state || 'draft'} · mode:{rt.runtime_mode || 'local'} · backend:{rt.backend_state || rt.runtime_state} · frontend:{rt.frontend_state || 'sleeping'} · preview:{rt.preview_state || 'sleeping'} · last:{rt.last_access_at || '-'}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${ (rt.backend_state || rt.runtime_state) === 'running' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    当前状态：{(rt.backend_state || rt.runtime_state) === 'running' ? '已唤醒' : '已休眠'}
                  </span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${ (rt.frontend_state || 'sleeping') === 'running' ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600'}`}>
                    前端：{(rt.frontend_state || 'sleeping') === 'running' ? '容器中运行' : '未运行'}
                  </span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${ (rt.preview_state || 'sleeping') === 'running' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                    预览：{(rt.preview_state || 'sleeping') === 'running' ? '运行中' : '未运行'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">container: {rt.runtime_container || '-'} · dockerized: {rt.dockerized ? 'yes' : 'no'} · db: {rt.health_db_mode || '-'} · live_version: {rt.live_version_id ?? '-'} · candidate_version: {rt.candidate_version_id ?? '-'}</div>
                {(rt.last_failure_reason || rt.last_failure_at) && (
                  <div className="text-[11px] text-rose-600 mt-1">last failure: {rt.last_failure_at || '-'} {rt.last_failure_reason ? `· ${rt.last_failure_reason}` : ''}</div>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${rt.health_ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                    健康检查：{rt.health_ok ? '通过' : '异常'}
                  </span>
                  {rt.autofix_inflight ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">AutoFix: 运行中</span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">AutoFix: 空闲</span>
                  )}
                  {(rt.autofix_cooldown_sec || 0) > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">冷却 {rt.autofix_cooldown_sec}s</span>
                  )}
                </div>
                {(rt.public_path || rt.preview_path) && (
                  <a className="text-xs text-indigo-600 hover:underline" href={rt.public_path || rt.preview_path || '#'} target="_blank" rel="noreferrer">{rt.public_path || rt.preview_path}</a>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm disabled:opacity-50"
                  disabled={(rt.backend_state || rt.runtime_state) === 'running' || runtimeActingId === rt.id}
                  onClick={async () => {
                    try {
                      setRuntimeActingId(rt.id);
                      await api.adminWakeRuntime(rt.id);
                      await load();
                    } catch (e: any) { setError(e?.message || '唤醒失败'); }
                    finally { setRuntimeActingId(null); }
                  }}
                >{runtimeActingId === rt.id ? '处理中…' : '唤醒'}</button>
                <button
                  className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-sm disabled:opacity-50"
                  disabled={(rt.backend_state || rt.runtime_state) !== 'running' || runtimeActingId === rt.id}
                  onClick={async () => {
                    try {
                      setRuntimeActingId(rt.id);
                      await api.adminSleepRuntime(rt.id);
                      await load();
                    } catch (e: any) { setError(e?.message || '休眠失败'); }
                    finally { setRuntimeActingId(null); }
                  }}
                >{runtimeActingId === rt.id ? '处理中…' : '休眠'}</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border rounded p-4 space-y-2">
          <h2 className="font-semibold">用户列表</h2>
          <div className="space-y-2 max-h-[420px] overflow-auto">
            {users.map(u => (
              <button key={u.id} className="w-full text-left border rounded p-2 hover:bg-slate-50" onClick={async () => setDetail(await api.adminUserDetail(u.id))}>
                <div className="font-medium">{u.nickname} <span className="text-xs text-slate-400">#{u.id}</span></div>
                <div className="text-xs text-slate-500">{u.email} · apps:{u.app_count}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="bg-white border rounded p-4 space-y-4">
          <div>
            <h2 className="font-semibold mb-2">用户详情</h2>
            {!detail ? <p className="text-sm text-slate-500">左侧から選択してください</p> : (
              <div className="space-y-2 text-sm">
                <p><b>昵称:</b> {detail.nickname}</p>
                <p><b>邮箱:</b> {detail.email}</p>
                <p><b>APP:</b> {detail.apps.length}</p>
                <div className="space-y-1 pt-2 max-h-[240px] overflow-auto">
                  {detail.apps.map(a => (
                    <div key={a.id} className="border rounded px-2 py-1 flex items-center justify-between gap-2">
                      <button className="text-left flex-1" onClick={() => openAppMemory(a.id)}>
                        <span>{a.icon} {a.name} · {a.status}</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <button className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-xs" onClick={() => openAppMemory(a.id)}>Memory</button>
                        <button className="px-2 py-0.5 rounded bg-red-600 text-white text-xs" onClick={() => removeApp(a.id)}>删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">App Memory 面板</h3>
              {loadingAppMemory ? <span className="text-xs text-slate-500">读取中…</span> : null}
            </div>
            {!appMemory ? <p className="text-sm text-slate-500">点击用户的某个 app 的 Memory 按钮查看。</p> : (
              <div className="space-y-3 text-sm">
                <div className="text-xs text-slate-500">App #{appMemory.appId} · memory: {appMemory.updatedAt?.memory || '-'} · decisions: {appMemory.updatedAt?.decisions || '-'} · release notes: {appMemory.updatedAt?.releaseNotes || '-'}</div>
                <div>
                  <div className="font-medium mb-1">MEMORY</div>
                  <pre className="bg-slate-50 border rounded p-3 max-h-[180px] overflow-auto whitespace-pre-wrap text-xs">{appMemory.memory || '(empty)'}</pre>
                </div>
                <div>
                  <div className="font-medium mb-1">DECISIONS</div>
                  <pre className="bg-slate-50 border rounded p-3 max-h-[180px] overflow-auto whitespace-pre-wrap text-xs">{appMemory.decisions || '(empty)'}</pre>
                </div>
                <div>
                  <div className="font-medium mb-1">RELEASE_NOTES</div>
                  <pre className="bg-slate-50 border rounded p-3 max-h-[220px] overflow-auto whitespace-pre-wrap text-xs">{appMemory.releaseNotes || '(empty)'}</pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
