import { useEffect, useState } from 'react';
import { api, AdminRuntime, AdminUser, AdminUserDetail } from '../services/api';
import { AppLang, getLang, setLang, tr } from '../i18n';

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
  const [reviewApps, setReviewApps] = useState<any[]>([]);
  const [runtimes, setRuntimes] = useState<AdminRuntime[]>([]);
  const [runtimeActingId, setRuntimeActingId] = useState<number | null>(null);
  const pendingApps = reviewApps.filter(a => a.status === 'private');
  const publishedApps = reviewApps.filter(a => a.status === 'published');

  const load = async () => {
    const [s, u, r, rt] = await Promise.all([api.adminStats(), api.adminUsers(), api.adminReviewApps(), api.adminRuntimes()]);
    setStats(s); setUsers(u); setReviewApps(r); setRuntimes(rt);
  };

  const removeApp = async (id: number) => {
    if (!confirm(`App #${id} を削除しますか？この操作は元に戻せません。`)) return;
    try {
      await api.adminDeleteApp(id);
      if (detail?.apps?.some(a => a.id === id)) {
        setDetail(await api.adminUserDetail(detail.id));
      }
      await load();
    } catch (e: any) {
      setError(e?.message || '削除に失敗しました');
    }
  };

  useEffect(() => {
    if (!token) return;
    load().catch(e => setError(e?.message || 'load failed'));
  }, [token]);

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
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Admin</h1>
        <div className="flex items-center gap-2">
          <select value={lang} onChange={e => { const v = e.target.value as AppLang; setLangState(v); setLang(v); }} className="h-8 text-xs border rounded px-2 bg-white">
            <option value="ja">日本語</option>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
          <button className="border rounded px-3 py-2" onClick={async () => {
            await api.adminLogout().catch(() => {});
            localStorage.removeItem('funfo_admin_token');
            setToken('');
          }}>{t('logout')}</button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 text-sm">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border rounded p-4"><p className="text-slate-500 text-sm">用户数量</p><p className="text-3xl font-bold">{stats?.users ?? '-'}</p></div>
        <div className="bg-white border rounded p-4"><p className="text-slate-500 text-sm">App数量</p><p className="text-3xl font-bold">{stats?.apps ?? '-'}</p></div>
        <div className="bg-white border rounded p-4"><p className="text-slate-500 text-sm">待审核</p><p className="text-3xl font-bold">{stats?.pending ?? '-'}</p></div>
      </div>

      <div className="bg-white border rounded p-4 space-y-3">
        <h2 className="font-semibold">等待审核（プライベート）</h2>
        <div className="space-y-2">
          {pendingApps.length === 0 && <p className="text-sm text-slate-500">暂无等待审核的 App</p>}
          {pendingApps.map(a => (
            <div key={a.id} className="border rounded p-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{a.icon} {a.name} <span className="text-xs text-slate-400">#{a.id}</span></div>
                <div className="text-xs text-slate-500">{a.owner_email || 'unknown'} · {a.status}</div>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm" onClick={async () => { try { await api.adminSetAppStatus(a.id, 'published'); await load(); } catch (e: any) { setError(e?.message || '上架失败'); } }}>上架</button>
                <button className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-sm" onClick={async () => { try { await api.adminSetAppStatus(a.id, 'draft'); await load(); } catch (e: any) { setError(e?.message || '打回草稿失败'); } }}>打回草稿</button>
                <button className="px-3 py-1.5 rounded bg-red-600 text-white text-sm" onClick={() => removeApp(a.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded p-4 space-y-3">
        <h2 className="font-semibold">已公开 App</h2>
        <div className="space-y-2">
          {publishedApps.length === 0 && <p className="text-sm text-slate-500">暂无公开 App</p>}
          {publishedApps.map(a => (
            <div key={a.id} className="border rounded p-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{a.icon} {a.name} <span className="text-xs text-slate-400">#{a.id}</span></div>
                <div className="text-xs text-slate-500">{a.owner_email || 'unknown'} · {a.status}</div>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-sm" onClick={async () => { try { await api.adminSetAppStatus(a.id, 'draft'); await load(); } catch (e: any) { setError(e?.message || '下架失败'); } }}>下架</button>
                <button className="px-3 py-1.5 rounded bg-red-600 text-white text-sm" onClick={() => removeApp(a.id)}>删除</button>
              </div>
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
                  {rt.owner_email || 'unknown'} · backend:{rt.backend_state || rt.runtime_state} · preview:{rt.preview_state || 'sleeping'} · last:{rt.last_access_at || '-'}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${ (rt.backend_state || rt.runtime_state) === 'running' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    当前状态：{(rt.backend_state || rt.runtime_state) === 'running' ? '已唤醒' : '已休眠'}
                  </span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${ (rt.preview_state || 'sleeping') === 'running' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                    预览：{(rt.preview_state || 'sleeping') === 'running' ? '运行中' : '未运行'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">container: {rt.runtime_container || '-'}</div>
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
                {rt.preview_path && (
                  <a className="text-xs text-indigo-600 hover:underline" href={rt.preview_path} target="_blank" rel="noreferrer">{rt.preview_path}</a>
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
        <div className="bg-white border rounded p-4">
          <h2 className="font-semibold mb-2">用户详情</h2>
          {!detail ? <p className="text-sm text-slate-500">左侧から選択してください</p> : (
            <div className="space-y-2 text-sm">
              <p><b>昵称:</b> {detail.nickname}</p>
              <p><b>邮箱:</b> {detail.email}</p>
              <p><b>APP:</b> {detail.apps.length}</p>
              <div className="space-y-1 pt-2 max-h-[300px] overflow-auto">
                {detail.apps.map(a => (
                  <div key={a.id} className="border rounded px-2 py-1 flex items-center justify-between gap-2">
                    <span>{a.icon} {a.name} · {a.status}</span>
                    <button className="px-2 py-0.5 rounded bg-red-600 text-white text-xs" onClick={() => removeApp(a.id)}>删除</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
