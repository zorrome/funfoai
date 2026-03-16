import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts';
import { BarChart3, Database, ExternalLink, FolderKanban, Pencil, Save, Table2, Upload } from 'lucide-react';
import { api, type App } from '../../services/api';
import AppIcon from '../AppIcon';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '../ui/chart';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Textarea } from '../ui/textarea';

type Props = {
  app: App | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAppUpdated?: (app: App) => void;
  appIconStyle?: (color?: string | null) => CSSProperties | undefined;
};

type DbTableInfo = { name: string; rowCount: number | null; columns: string[] };
type DbOverview = { dbPath: string; exists: boolean; tables: DbTableInfo[] };
type DbTableRows = { table: string; columns: string[]; rows: Record<string, unknown>[]; limit: number; offset: number; total: number | null };
type QueryResult = { mode: 'read' | 'write'; columns?: string[]; rows?: Record<string, unknown>[]; rowCount?: number; changes?: number; message?: string };
type AnalyticsPoint = { bucket: string; label: string; visits: number; activeUsers: number };
type AnalyticsResponse = { range: 'day' | 'week' | 'month'; summary: { visits: number; activeUsers: number; lastVisitedAt?: string | null }; points: AnalyticsPoint[] };

const chartConfig = {
  visits: { label: '访问量', color: '#6366f1' },
  activeUsers: { label: '活跃用户', color: '#10b981' },
};

function formatCell(value: unknown) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export default function AppInfrastructureDialog({ app, open, onOpenChange, onAppUpdated, appIconStyle }: Props) {
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectIcon, setProjectIcon] = useState('✨');
  const [savingProject, setSavingProject] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbOverview, setDbOverview] = useState<DbOverview | null>(null);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [tableRows, setTableRows] = useState<DbTableRows | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [querySql, setQuerySql] = useState('');
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [analyticsRange, setAnalyticsRange] = useState<'day' | 'week' | 'month'>('day');
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!app || !open) return;
    setProjectName(app.name || '');
    setProjectDescription(app.description || '');
    setProjectIcon(app.icon || '✨');
    setError('');
    setQueryResult(null);
    setQuerySql('SELECT name FROM sqlite_master WHERE type = "table" ORDER BY name;');
  }, [app, open]);

  useEffect(() => {
    if (!app || !open) return;
    (async () => {
      setDbLoading(true);
      try {
        const info = await api.getInfrastructureDatabase(app.id);
        setDbOverview(info);
        const firstTable = info.tables[0]?.name || '';
        setSelectedTable(firstTable);
      } catch (e: any) {
        setError(e?.message || '数据库信息获取失败');
      } finally {
        setDbLoading(false);
      }
    })();
  }, [app, open]);

  useEffect(() => {
    if (!app || !open) return;
    (async () => {
      setAnalyticsLoading(true);
      try {
        const data = await api.getInfrastructureAnalytics(app.id, analyticsRange);
        setAnalytics(data);
      } catch (e: any) {
        setError(e?.message || '统计分析获取失败');
      } finally {
        setAnalyticsLoading(false);
      }
    })();
  }, [app, open, analyticsRange]);

  useEffect(() => {
    if (!app || !open || !selectedTable) return;
    (async () => {
      setTableLoading(true);
      try {
        const rows = await api.getInfrastructureDatabaseTable(app.id, selectedTable, 20, 0);
        setTableRows(rows);
      } catch (e: any) {
        setError(e?.message || '表单数据获取失败');
      } finally {
        setTableLoading(false);
      }
    })();
  }, [app, open, selectedTable]);

  const analyticsSummary = analytics?.summary;
  const previewUrl = app?.preview_path
    ? `${window.location.origin}${app.preview_path}`
    : app?.public_path
      ? `${window.location.origin}${app.public_path}`
      : null;
  const currentColumns = useMemo(() => tableRows?.columns || queryResult?.columns || [], [tableRows, queryResult]);
  const currentRows = useMemo(() => tableRows?.rows || queryResult?.rows || [], [tableRows, queryResult]);

  if (!app) return null;

  async function saveProject() {
    setSavingProject(true);
    setError('');
    try {
      const updated = await api.updateApp(app.id, {
        name: projectName.trim() || app.name,
        description: projectDescription,
        icon: projectIcon || app.icon,
      });
      onAppUpdated?.(updated);
    } catch (e: any) {
      setError(e?.message || '项目信息保存失败');
    } finally {
      setSavingProject(false);
    }
  }

  async function onIconUpload(file?: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setProjectIcon(String(reader.result || ''));
    reader.readAsDataURL(file);
  }

  async function runQuery() {
    if (!app || !querySql.trim()) return;
    setQueryLoading(true);
    setError('');
    try {
      const result = await api.runInfrastructureDatabaseQuery(app.id, querySql);
      setQueryResult(result);
    } catch (e: any) {
      setError(e?.message || '数据库编辑器执行失败');
    } finally {
      setQueryLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[90vw] !h-[700px] !max-w-[1500px] !max-h-[85vh] overflow-hidden rounded-[28px] border-0 bg-white/98 p-0 shadow-[0_35px_120px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:!max-w-[1500px]">
        <div className="flex h-full flex-col">
          <DialogHeader className="px-8 pt-8 pb-4 border-b border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-blue-50/70">
            <DialogTitle className="flex items-center gap-3 text-xl">
              <AppIcon icon={projectIcon || app.icon} name={projectName || app.name} className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shadow-sm" style={appIconStyle?.(app.color)} />
              <div>
                <div>{projectName || app.name} · Advanced</div>
                <DialogDescription>项目设置、数据库和统计分析等高级工具都集中在这里。</DialogDescription>
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-8 py-6">
            <Tabs defaultValue="project" className="h-full">
              <TabsList className="grid grid-cols-3 w-full max-w-xl mb-6">
                <TabsTrigger value="project"><FolderKanban className="w-4 h-4" />Project</TabsTrigger>
                <TabsTrigger value="database"><Database className="w-4 h-4" />Database</TabsTrigger>
                <TabsTrigger value="analytics"><BarChart3 className="w-4 h-4" />Analytics</TabsTrigger>
              </TabsList>

              <TabsContent value="project" className="space-y-4">
                <Card><CardContent className="p-5 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-[112px_1fr] gap-5 items-start">
                    <div className="space-y-3">
                      <AppIcon icon={projectIcon} name={projectName} className="w-28 h-28 rounded-3xl flex items-center justify-center text-5xl border bg-slate-50 overflow-hidden" style={appIconStyle?.(app.color)} />
                      <label className="block">
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => onIconUpload(e.target.files?.[0])} />
                        <span className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-slate-50"><Upload className="w-4 h-4" />上传 icon</span>
                      </label>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <div className="text-sm font-medium mb-2">APP 名字</div>
                        <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="输入 app 名字" />
                      </div>
                      <div>
                        <div className="text-sm font-medium mb-2">描述</div>
                        <Textarea value={projectDescription} onChange={(e) => setProjectDescription(e.target.value)} rows={5} placeholder="输入 app 描述" />
                      </div>
                      <div>
                        <div className="text-sm font-medium mb-2">icon 文本 / URL / data:image</div>
                        <div className="flex gap-2">
                          <Input value={projectIcon} onChange={(e) => setProjectIcon(e.target.value)} placeholder="例如 ✨ 或上传后的 data:image" />
                          <Button onClick={saveProject} disabled={savingProject} className="gap-2"><Save className="w-4 h-4" />{savingProject ? '保存中...' : '保存'}</Button>
                        </div>
                      </div>
                      {previewUrl && <div className="text-sm text-slate-500">Live 地址：<a href={previewUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{previewUrl}</a></div>}
                    </div>
                  </div>
                </CardContent></Card>
              </TabsContent>

              <TabsContent value="database" className="space-y-4">
                <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-4">
                  <Card><CardContent className="p-4 space-y-3">
                    <div className="font-semibold">表单 / 数据表</div>
                    <div className="text-xs text-slate-500 break-all">{dbOverview?.dbPath || '正在读取数据库...'}</div>
                    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                      {(dbOverview?.tables || []).map((table) => (
                        <button key={table.name} className={`w-full rounded-xl border px-3 py-3 text-left transition ${selectedTable === table.name ? 'border-indigo-300 bg-indigo-50' : 'hover:bg-slate-50'}`} onClick={() => setSelectedTable(table.name)}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium flex items-center gap-2"><Table2 className="w-4 h-4" />{table.name}</div>
                            <div className="text-xs text-slate-500">{table.rowCount ?? '—'} rows</div>
                          </div>
                          <div className="mt-1 text-xs text-slate-500 line-clamp-2">{table.columns.join(', ')}</div>
                        </button>
                      ))}
                      {!dbLoading && !(dbOverview?.tables || []).length && <div className="text-sm text-slate-500">当前 app 还没有检测到数据库表。</div>}
                    </div>
                  </CardContent></Card>

                  <div className="space-y-4">
                    <Card><CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">表数据预览 {selectedTable ? `· ${selectedTable}` : ''}</div>
                          <div className="text-xs text-slate-500">打开表单查看数据详情，后面也可以扩展关联关系、字段配置等。</div>
                        </div>
                        {previewUrl && <Button variant="outline" className="gap-2" onClick={() => window.open(previewUrl, '_blank')}><ExternalLink className="w-4 h-4" />打开 app</Button>}
                      </div>
                      <div className="overflow-auto max-h-[280px] border rounded-xl">
                        <Table>
                          <TableHeader><TableRow>{currentColumns.map((col) => <TableHead key={col}>{col}</TableHead>)}</TableRow></TableHeader>
                          <TableBody>
                            {currentRows.map((row, idx) => (
                              <TableRow key={idx}>{currentColumns.map((col) => <TableCell key={col}>{formatCell(row[col])}</TableCell>)}</TableRow>
                            ))}
                            {!tableLoading && !currentRows.length && <TableRow><TableCell colSpan={Math.max(currentColumns.length, 1)} className="text-center text-slate-500 py-8">暂无数据</TableCell></TableRow>}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent></Card>

                    <Card><CardContent className="p-4 space-y-3">
                      <div className="flex items-center gap-2 font-semibold"><Pencil className="w-4 h-4" />数据库编辑器</div>
                      <Textarea value={querySql} onChange={(e) => setQuerySql(e.target.value)} rows={6} className="font-mono text-xs" />
                      <div className="flex items-center gap-3">
                        <Button onClick={runQuery} disabled={queryLoading} className="gap-2">{queryLoading ? '执行中...' : '执行 SQL'}</Button>
                        {queryResult?.message && <span className="text-sm text-slate-500">{queryResult.message}</span>}
                        {queryResult?.changes !== undefined && <span className="text-sm text-emerald-600">已影响 {queryResult.changes} 行</span>}
                      </div>
                    </CardContent></Card>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="analytics" className="space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                    <Card><CardContent className="p-4"><div className="text-xs text-slate-500">访问量</div><div className="text-3xl font-bold">{analyticsSummary?.visits ?? '—'}</div></CardContent></Card>
                    <Card><CardContent className="p-4"><div className="text-xs text-slate-500">活跃用户</div><div className="text-3xl font-bold">{analyticsSummary?.activeUsers ?? '—'}</div></CardContent></Card>
                    <Card><CardContent className="p-4"><div className="text-xs text-slate-500">最近访问</div><div className="text-sm font-medium">{analyticsSummary?.lastVisitedAt ? new Date(analyticsSummary.lastVisitedAt).toLocaleString('zh-CN') : '暂无'}</div></CardContent></Card>
                  </div>
                  <Tabs value={analyticsRange} onValueChange={(v) => setAnalyticsRange(v as 'day' | 'week' | 'month')}>
                    <TabsList>
                      <TabsTrigger value="day">日</TabsTrigger>
                      <TabsTrigger value="week">周</TabsTrigger>
                      <TabsTrigger value="month">月</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <Card><CardContent className="p-4">
                  <div className="font-semibold mb-3">趋势图表</div>
                  <ChartContainer config={chartConfig} className="h-[340px] w-full aspect-auto">
                    <AreaChart data={analytics?.points || []} margin={{ left: 8, right: 8, top: 8 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="visits" stroke="var(--color-visits)" fill="var(--color-visits)" fillOpacity={0.18} strokeWidth={2} />
                      <Area type="monotone" dataKey="activeUsers" stroke="var(--color-activeUsers)" fill="var(--color-activeUsers)" fillOpacity={0.14} strokeWidth={2} />
                    </AreaChart>
                  </ChartContainer>
                  {!analyticsLoading && !(analytics?.points || []).length && <div className="text-sm text-slate-500 mt-4">还没有足够的访问数据。等用户访问发布 app 后，这里会自动开始累计。</div>}
                </CardContent></Card>
              </TabsContent>
            </Tabs>
            {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
