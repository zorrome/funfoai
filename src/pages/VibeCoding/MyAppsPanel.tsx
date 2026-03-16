import type { CSSProperties, Dispatch, MouseEvent, SetStateAction } from "react";
import { ArrowUp, Edit3, Folder, Loader2, Plus, Rocket, ServerCog, Store as StoreIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import AppFeedbackDialog from "../../components/ui/app-feedback-dialog";
import AppIcon from "../../components/AppIcon";
import AppInfrastructureDialog from "../../components/infrastructure/AppInfrastructureDialog";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { cn } from "../../components/ui/utils";
import { api, type App, type User } from "../../services/api";

type GroupedApp = {
  key: string;
  release?: App | null;
  draft?: App | null;
  latestUpdatedAt: string;
};

type PublishMeta = {
  label: string;
  badgeClass?: string;
};

type Props = {
  appsLoading: boolean;
  myAppsGroups: GroupedApp[];
  user: User | null;
  currentApp: App | null;
  setApps: Dispatch<SetStateAction<App[]>>;
  setCurrentApp: Dispatch<SetStateAction<App | null>>;
  setActiveTab: (tab: 'store') => void;
  createNewApp: () => void;
  openApp: (appId: number) => void;
  openWorkspaceDraftForRelease: (appId: number) => void;
  deleteApp: (appId: number, e?: MouseEvent) => void;
  canEditApp: (app: App, user: User | null) => boolean;
  isPublishedReleaseApp: (app: App | null | undefined) => boolean;
  getPreviewUrl: (app: App | null | undefined) => string | null;
  getPublishStatusMeta: (app: App | null | undefined) => PublishMeta;
  appIconStyle: (color?: string | null) => CSSProperties | undefined;
};

export default function MyAppsPanel({
  appsLoading,
  myAppsGroups,
  user,
  currentApp,
  setApps,
  setCurrentApp,
  setActiveTab,
  createNewApp,
  openApp,
  openWorkspaceDraftForRelease,
  deleteApp,
  canEditApp,
  isPublishedReleaseApp,
  getPreviewUrl,
  getPublishStatusMeta,
  appIconStyle,
}: Props) {
  const [infraApp, setInfraApp] = useState<App | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'success' | 'warning' | 'danger'; title: string; description: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ appId: number; appName: string; isDraft?: boolean } | null>(null);
  const [submittingReviewId, setSubmittingReviewId] = useState<number | null>(null);

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-slate-50/50 via-white to-blue-50/30">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="flex items-end justify-between mb-12 gap-6">
          <div className="space-y-3">
            <h1 className="text-4xl font-bold leading-tight">Projects</h1>
            <p className="text-muted-foreground text-base">统一管理你的项目、线上版本与编辑副本（{myAppsGroups.length}组）</p>
          </div>
          <Button size="lg" className="gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 shrink-0" onClick={createNewApp}>
            <Plus className="w-5 h-5" /> 新規アプリ作成
          </Button>
        </div>

        {appsLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
        ) : myAppsGroups.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            <div className="text-6xl mb-4">📁</div>
            <p className="text-lg font-medium mb-4">还没有项目</p>
            <Button onClick={() => setActiveTab('store')} className="gap-2"><StoreIcon className="w-4 h-4" /> 去 Create 生成</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {myAppsGroups.map(group => {
              const releaseApp = group.release;
              const draftApp = group.draft;
              const primaryApp = draftApp || releaseApp;
              if (!primaryApp) return null;
              const canOpenPrimary = canEditApp(primaryApp as App, user);
              const publishMeta = getPublishStatusMeta(releaseApp || draftApp);
              return (
                <Card
                  key={group.key}
                  className={cn("hover:shadow-lg transition-all duration-300 border bg-white relative overflow-hidden group", canOpenPrimary ? "cursor-pointer" : "opacity-90")}
                  onClick={() => {
                    if (draftApp && canEditApp(draftApp as App, user)) openApp(draftApp.id);
                    else if (releaseApp && canEditApp(releaseApp as App, user)) openApp(releaseApp.id);
                  }}
                >
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-start gap-4">
                      <AppIcon icon={primaryApp.icon} name={primaryApp.name} className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0 shadow-sm overflow-hidden" style={primaryApp.color ? appIconStyle(primaryApp.color) : undefined} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h3 className="font-bold text-xl mb-2">{primaryApp.name}</h3>
                            <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
                              <span>Release v{releaseApp?.current_version || primaryApp.current_version}</span><span>·</span>
                              <span>{new Date(group.latestUpdatedAt).toLocaleDateString('ja-JP')}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 ml-4" onClick={e => e.stopPropagation()}>
                            {releaseApp && getPreviewUrl(releaseApp) && (releaseApp.release_state === 'live' || releaseApp.release_state === 'rollback') && (
                              <Button size="sm" className="gap-1 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => {
                                const u = getPreviewUrl(releaseApp);
                                if (u) window.open(u, '_blank');
                              }}>
                                <ArrowUp className="w-3 h-3 rotate-45" /> 使用
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              disabled={!canOpenPrimary || primaryApp.release_state === 'candidate'}
                              title={!canOpenPrimary ? '編集権限がありません（先に「自分用に編集」）' : undefined}
                              onClick={() => {
                                if (draftApp) openApp(draftApp.id);
                                else if (releaseApp && isPublishedReleaseApp(releaseApp)) openWorkspaceDraftForRelease(releaseApp.id);
                                else if (releaseApp) openApp(releaseApp.id);
                              }}
                            >
                              <Edit3 className="w-3 h-3" /> {draftApp ? 'Draft を編集' : '編集'}
                            </Button>
                            {releaseApp && ['candidate', 'live', 'failed', 'rollback'].includes(releaseApp.release_state || 'draft') && (
                              <Button size="sm" variant="outline" className="gap-1 border-indigo-200 text-indigo-700 hover:bg-indigo-50" onClick={(e) => { e.stopPropagation(); setInfraApp(releaseApp); }}>
                                <ServerCog className="w-3 h-3" /> Advanced
                              </Button>
                            )}
                            <Button size="sm" variant="outline" className="gap-1 text-red-600 hover:border-red-300 hover:bg-red-50" onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDelete({ appId: primaryApp.id, appName: primaryApp.name, isDraft: (primaryApp.app_role || 'release') === 'draft' });
                            }}>
                              <Trash2 className="w-3 h-3" /> 削除
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 flex-wrap">
                          {['candidate', 'live', 'failed', 'rollback'].includes(releaseApp?.release_state || 'draft') && (
                            <Badge className="bg-cyan-100 text-cyan-700 border-cyan-200">Live Runtime</Badge>
                          )}
                          {releaseApp && (releaseApp.release_state || 'draft') === 'live' && (releaseApp.review_status || 'none') === 'approved' && (releaseApp.status || 'draft') === 'published' && (
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">App store公开中</Badge>
                          )}
                          <Badge variant={(releaseApp?.release_state || 'draft') === 'live' ? 'default' : 'secondary'} className={cn(publishMeta.badgeClass)}>
                            {publishMeta.label}
                          </Badge>
                          {(releaseApp?.public_path || releaseApp?.preview_path) && (
                            <span className="text-xs text-muted-foreground font-mono">
                              link:{(releaseApp?.release_state === 'live' || releaseApp?.release_state === 'rollback') ? (releaseApp?.public_path || releaseApp?.preview_path) : (releaseApp?.preview_path || releaseApp?.public_path)}
                            </span>
                          )}
                          {(releaseApp?.release_state === 'candidate' || draftApp?.release_state === 'candidate') ? (
                            <Badge className="bg-amber-100 text-amber-700 border-amber-200">● Publishing（暂不可用）</Badge>
                          ) : releaseApp ? (
                            <Button
                              size="sm"
                              className="gap-1 bg-amber-500 hover:bg-amber-600 text-white"
                              disabled={false}
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  setSubmittingReviewId(releaseApp.id);
                                  const updated = await api.submitReview(releaseApp.id);
                                  setApps(prev => prev.map(item => item.id === releaseApp.id ? { ...item, ...updated } : item));
                                  if (currentApp?.id === releaseApp.id) setCurrentApp(prev => prev ? { ...prev, ...updated } : prev);
                                  setNotice({ tone: 'success', title: '上架申请已提交', description: '已经提交到 App Store 审核，请等待结果。' });
                                } catch (err: any) {
                                  setNotice({ tone: 'danger', title: '上架申请失败', description: err?.message || '申请失败（请确认当前账号有编辑权限）' });
                                } finally {
                                  setSubmittingReviewId(null);
                                }
                              }}
                            >
                              <Rocket className="w-3 h-3" /> {submittingReviewId === releaseApp.id ? '提交中…' : '申请上架'}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {releaseApp && ['candidate', 'live', 'failed', 'rollback'].includes(releaseApp.release_state || 'draft') && (
                      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-cyan-50 px-4 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4" onClick={e => e.stopPropagation()}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200">Advanced</Badge>
                            <span className="text-sm font-semibold text-slate-800">项目设置 / 数据库 / 统计分析</span>
                          </div>
                          <p className="text-xs text-slate-600">这里集中放高级工具。默认创作流程不需要进入，只有在维护或运营时再打开即可。</p>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <Button size="sm" className="gap-1 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => setInfraApp(releaseApp)}>
                            <ServerCog className="w-3 h-3" /> 打开 Advanced
                          </Button>
                        </div>
                      </div>
                    )}

                    {draftApp && releaseApp && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">Editing Copy</Badge>
                            <span className="text-sm font-medium text-slate-800">{draftApp.name}</span>
                          </div>
                          <p className="text-xs text-slate-500">这是线上版本对应的编辑副本。修改完成后，从项目内重新发布即可更新线上版本。</p>
                        </div>
                        <div className="shrink-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => openApp(draftApp.id)}>
                            <Folder className="w-3 h-3" /> Draft を開く
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1 text-red-600 hover:border-red-300 hover:bg-red-50" onClick={() => setConfirmDelete({ appId: draftApp.id, appName: draftApp.name, isDraft: true })}>
                            <Trash2 className="w-3 h-3" /> 删除 Draft
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      <AppInfrastructureDialog
        app={infraApp}
        open={!!infraApp}
        onOpenChange={(next) => { if (!next) setInfraApp(null); }}
        appIconStyle={appIconStyle}
        onAppUpdated={(updated) => {
          setApps(prev => prev.map(item => item.id === updated.id ? { ...item, ...updated } : item));
          setCurrentApp(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
          setInfraApp(updated);
        }}
      />
      <AppFeedbackDialog
        open={!!confirmDelete}
        tone="danger"
        title={confirmDelete?.isDraft ? '删除 Draft' : '删除应用'}
        description={confirmDelete ? `确定要删除「${confirmDelete.appName}」吗？此操作不可恢复。` : ''}
        confirmText={confirmDelete?.isDraft ? '删除 Draft' : '确认删除'}
        cancelText="取消"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete) return;
          try {
            await api.deleteApp(confirmDelete.appId);
            setApps(prev => prev.filter(item => item.id !== confirmDelete.appId));
            if (currentApp?.id === confirmDelete.appId) setCurrentApp(null);
            setConfirmDelete(null);
            setNotice({ tone: 'success', title: confirmDelete.isDraft ? 'Draft 已删除' : '应用已删除', description: confirmDelete.isDraft ? '该 workspace draft 已被删除。' : '应用已从列表中移除。' });
          } catch (err: any) {
            setNotice({ tone: 'danger', title: confirmDelete.isDraft ? '删除 Draft 失败' : '删除失败', description: err?.message || '删除失败，请稍后重试。' });
          }
        }}
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
    </div>
  );
}
