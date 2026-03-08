interface AppPreviewProps {
  previewUrl?: string | null;
  refreshKey?: number;
  deviceType: 'mobile' | 'laptop' | 'desktop';
  onOpenExternal?: () => void;
}

export default function AppPreview({ previewUrl, refreshKey = 0, deviceType, onOpenExternal }: AppPreviewProps) {
  const maxWidth =
    deviceType === 'mobile'  ? '390px'  :
    deviceType === 'laptop'  ? '900px'  : '100%';

  if (!previewUrl) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0d1117] text-slate-400">
        <div className="text-center space-y-4">
          <div className="text-5xl opacity-40">{'</>'}</div>
          <p className="text-sm font-mono">チャットでアプリを説明してください</p>
          <p className="text-xs opacity-60">AIが自動でUIを生成・プレビュー表示します</p>
        </div>
      </div>
    );
  }

  const src = `${previewUrl}?v=${refreshKey}`;

  return (
    <div className="flex-1 overflow-auto bg-[#0d1117] p-4">
      <div
        className="mx-auto bg-white rounded-xl shadow-2xl overflow-hidden transition-all duration-300 border border-white/10"
        style={{ maxWidth, height: 'calc(100% - 0px)', minHeight: '500px' }}
      >
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[#1e1e1e] border-b border-white/5">
          <span className="w-3 h-3 rounded-full bg-red-500/80" />
          <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <span className="w-3 h-3 rounded-full bg-green-500/80" />
          <div className="flex-1 mx-3 px-3 py-1 bg-[#2a2a2a] rounded-md text-xs text-slate-400 font-mono truncate">
            {previewUrl}
          </div>
          <button
            onClick={() => (onOpenExternal ? onOpenExternal() : window.open(src, '_blank'))}
            className="text-slate-500 hover:text-slate-300 transition-colors text-xs"
          >
            ↗
          </button>
        </div>

        <iframe
          key={`${previewUrl}-${refreshKey}`}
          src={src}
          className="w-full border-0 bg-white"
          style={{ height: 'calc(100% - 40px)', minHeight: '460px' }}
          title="App Preview"
        />
      </div>
    </div>
  );
}
