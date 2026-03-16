interface AppPreviewProps {
  previewUrl?: string | null;
  previewSubPath?: string | null;
  refreshKey?: number;
  deviceType: 'mobile' | 'laptop' | 'desktop';
  onOpenExternal?: () => void;
}

function joinPreviewUrl(previewUrl?: string | null, previewSubPath?: string | null) {
  if (!previewUrl) return null;
  const base = previewUrl.endsWith('/') ? previewUrl.slice(0, -1) : previewUrl;
  const sub = (previewSubPath || '').trim();
  if (!sub || sub === '/' || sub === base) return previewUrl;
  if (sub.startsWith('/?')) return `${base}/${sub.slice(2) ? `?${sub.slice(2)}` : ''}`;
  if (/^https?:\/\//i.test(sub)) return sub;
  return `${base}${sub.startsWith('/') ? sub : `/${sub}`}`;
}

export default function AppPreview({ previewUrl, previewSubPath, refreshKey = 0, deviceType, onOpenExternal }: AppPreviewProps) {
  const maxWidth =
    deviceType === 'mobile'  ? '390px'  :
    deviceType === 'laptop'  ? '900px'  : '100%';

  if (!previewUrl) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_35%),linear-gradient(180deg,#f8fafc,#eef2ff)] text-slate-500">
        <div className="text-center space-y-4">
          <div className="text-5xl opacity-40">{'</>'}</div>
          <p className="text-sm font-mono">チャットでアプリを説明してください</p>
          <p className="text-xs opacity-60">AIが自動でUIを生成・プレビュー表示します</p>
        </div>
      </div>
    );
  }

  const effectiveUrl = joinPreviewUrl(previewUrl, previewSubPath) || previewUrl;
  const src = effectiveUrl ? `${effectiveUrl}${effectiveUrl.includes('?') ? '&' : '?'}v=${refreshKey}` : '';

  return (
    <div className="flex-1 overflow-auto bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_28%),linear-gradient(180deg,#f8fafc,#eef2ff)] p-5">
      <div
        className="mx-auto bg-white/96 rounded-[22px] shadow-[0_24px_80px_rgba(15,23,42,0.14)] overflow-hidden transition-all duration-300 border border-slate-200/80 backdrop-blur"
        style={{ maxWidth, height: 'calc(100% - 0px)', minHeight: '500px' }}
      >
        <div className="flex items-center gap-2 px-4 py-3 bg-slate-50/95 border-b border-slate-200/80 backdrop-blur">
          <span className="w-3 h-3 rounded-full bg-red-500/80" />
          <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <span className="w-3 h-3 rounded-full bg-green-500/80" />
          <div className="flex-1 mx-3 px-3 py-1.5 bg-white rounded-lg text-xs text-slate-500 font-mono truncate border border-slate-200">
            {effectiveUrl || previewUrl}
          </div>
          <button
            onClick={() => (onOpenExternal ? onOpenExternal() : null)}
            className="text-slate-400 hover:text-slate-700 transition-colors text-xs rounded-md hover:bg-slate-100 px-2 py-1"
          >
            ⌂
          </button>
        </div>

        <iframe
          key={`${previewUrl}-${refreshKey}`}
          src={src}
          className="w-full border-0 bg-white rounded-b-[22px]"
          style={{ height: 'calc(100% - 40px)', minHeight: '460px' }}
          title="App Preview"
        />
      </div>
    </div>
  );
}
