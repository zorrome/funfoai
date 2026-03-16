import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Sparkles, Check } from 'lucide-react';
import { cn } from './ui/utils';

// ── Color palette ────────────────────────────────────────────────────
const COLORS = [
  { id: 'indigo',  hex: '#6366f1', label: 'インディゴ' },
  { id: 'violet',  hex: '#8b5cf6', label: 'バイオレット' },
  { id: 'blue',    hex: '#3b82f6', label: 'ブルー'     },
  { id: 'sky',     hex: '#0ea5e9', label: 'スカイ'     },
  { id: 'cyan',    hex: '#06b6d4', label: 'シアン'     },
  { id: 'teal',    hex: '#14b8a6', label: 'ティール'   },
  { id: 'emerald', hex: '#10b981', label: 'エメラルド'  },
  { id: 'green',   hex: '#22c55e', label: 'グリーン'   },
  { id: 'lime',    hex: '#84cc16', label: 'ライム'     },
  { id: 'yellow',  hex: '#eab308', label: 'イエロー'   },
  { id: 'amber',   hex: '#f59e0b', label: 'アンバー'   },
  { id: 'orange',  hex: '#f97316', label: 'オレンジ'   },
  { id: 'red',     hex: '#ef4444', label: 'レッド'     },
  { id: 'rose',    hex: '#f43f5e', label: 'ローズ'     },
  { id: 'pink',    hex: '#ec4899', label: 'ピンク'     },
  { id: 'slate',   hex: '#64748b', label: 'スレート'   },
];

// ── Emoji catalogue ──────────────────────────────────────────────────
const EMOJIS = [
  '📊','📈','📉','📋','📅','🗓️','📝','🧾','💰','💳','💴','💹','📦','🏷️','🔖',
  '👥','🧑‍🍳','👨‍🍳','👩‍🍳','🛎️','🎯','🎁','🏆','⭐','🌟','✨','🚀','⚡','🔥','💡',
  '🍽️','🍜','🍣','🍤','🍙','🍛','🍱','🥗','🍔','🍕','🥪','🥐','🍰','🍩','🍪',
  '☕','🍵','🧋','🍺','🍷','🍶','🥂','🥤','📱','🖥️','💻','⌚','📡','🔔','📣',
  '🏪','🏬','🏢','🏷️','🛒','🛍️','📌','🔍','🧠','🤖','🧩','🧰','🔧','🧪','🎨',
  '🎵','🎮','📷','🎬','🧭','🗂️','🧾','📨','📬','📲','✅','🆕','🆒','💎','🎉',
];

// Keyword → emoji mapping
const KEYWORD_MAP: [string[], string][] = [
  [['売上','収益','revenue','sales'],           '📊'],
  [['グラフ','chart','分析','analytics'],        '📈'],
  [['シフト','勤務','schedule','スケジュール'],    '📅'],
  [['在庫','inventory','stock','食材'],           '📦'],
  [['コスト','原価','利益','profit','経費'],       '💰'],
  [['レシート','領収書','会計','receipt'],         '🧾'],
  [['従業員','スタッフ','人事','employee'],        '👥'],
  [['顧客','会員','customer','member','crm'],     '🎯'],
  [['メニュー','menu','料理','dish','food'],       '🍽️'],
  [['注文','order','オーダー'],                   '📋'],
  [['ドリンク','drink','coffee','飲み物'],         '☕'],
  [['通知','アラート','alert'],                   '🔔'],
  [['ダッシュボード','dashboard'],                '🖥️'],
  [['ポイント','会員証'],                          '🎁'],
  [['ramen','ラーメン','noodle'],                 '🍜'],
  [['寿司','sushi'],                              '🍣'],
  [['pizza','ピザ'],                              '🍕'],
];

function autoEmoji(text: string): string {
  const lower = text.toLowerCase();
  for (const [kws, emoji] of KEYWORD_MAP) {
    if (kws.some(k => lower.includes(k))) return emoji;
  }
  // fallback: pick a vivid but meaningful icon from extended set
  const fallback = ['✨','🚀','📱','🖥️','💡','🎯','📊','🧠','🧩','🏪'];
  return fallback[Math.floor(Math.random() * fallback.length)];
}

function autoColorId(_text: string): string {
  const neutral = ['slate', 'blue', 'cyan', 'amber', 'rose', 'teal'];
  return neutral[Math.floor(Math.random() * neutral.length)];
}

interface PublishDialogProps {
  open: boolean;
  mode?: 'edit' | 'publish';
  routeSummary?: string;
  actionLabel?: string;
  validationSummary?: string;
  validationItems?: string[];
  onClose: () => void;
  onConfirm: (name: string, description: string, icon: string, color: string) => void;
  initialName?: string;
  initialDescription?: string;
  initialIcon?: string;
  initialColor?: string;
}

export default function PublishDialog({
  open, mode = 'edit', routeSummary = '', actionLabel = '', validationSummary = '', validationItems = [], onClose, onConfirm,
  initialName = '', initialDescription = '',
  initialIcon = '✨', initialColor = 'slate',
}: PublishDialogProps) {
  const [name,        setName]        = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [icon,        setIcon]        = useState(initialIcon);
  const [colorId,     setColorId]     = useState(initialColor);
  const [aiRunning,   setAiRunning]   = useState(false);
  const [showEmojis,  setShowEmojis]  = useState(false);

  // Sync form state whenever the dialog opens (props may have changed since last mount)
  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription(initialDescription);
      setIcon(initialIcon || '✨');
      setColorId(initialColor || 'slate');
      setShowEmojis(false);
      setAiRunning(false);
    }
  }, [open]); // intentionally exclude initialX — only re-sync when open flips to true

  const currentColor = COLORS.find(c => c.id === colorId) ?? COLORS[0];

  const handleAISuggest = () => {
    setAiRunning(true);
    const combined = name + ' ' + description;
    const suggestedEmoji = autoEmoji(combined);
    const suggestedColor = autoColorId(combined);
    setTimeout(() => {
      setIcon(suggestedEmoji);
      setColorId(suggestedColor);
      setAiRunning(false);
    }, 700);
  };

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed, description.trim(), icon, colorId);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="w-5 h-5 text-primary" />
            {mode === 'publish' ? '确认信息并发布' : '保存应用信息'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {mode === 'publish' && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-2">
              <div className="font-semibold">发布过程</div>
              {actionLabel ? <div className="text-xs font-medium text-amber-950">{actionLabel}</div> : null}
              <div>{routeSummary || '保存当前信息后，系统会先完成发布验证，再更新线上版本。'}</div>
              {validationSummary ? <div className="text-xs text-amber-950/90">{validationSummary}</div> : null}
              {!!validationItems.length && (
                <ul className="m-0 pl-5 space-y-1 text-xs text-amber-950/90">
                  {validationItems.map(item => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
          )}

          {/* ── Icon preview + AI button ─────────────────────────── */}
          <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border">
            {/* Large icon preview */}
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl shadow-md shrink-0 transition-all duration-300"
              style={{ backgroundColor: currentColor.hex }}>
              {icon}
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">アイコンプレビュー</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn('gap-1.5 h-8 text-xs border-dashed', aiRunning && 'text-violet-600 border-violet-300')}
                  onClick={handleAISuggest}
                  disabled={aiRunning}>
                  <Sparkles className={cn('w-3.5 h-3.5', aiRunning && 'animate-spin text-violet-500')} />
                  {aiRunning ? 'AI生成中...' : 'AIで自動生成'}
                </Button>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-2"
                onClick={() => setShowEmojis(v => !v)}>
                <span className="text-base leading-none">{icon}</span>
                絵文字を変える
              </Button>
              <p className="text-xs text-slate-400">
                アプリ名・説明に合わせて AI が絵文字とカラーを自動提案
              </p>
            </div>
          </div>

          {/* ── Emoji picker (collapsible) ──────────────────────── */}
          {showEmojis && (
            <div className="rounded-xl border bg-white p-3">
              <p className="text-xs font-medium text-slate-500 mb-2">絵文字を選択</p>
              <div className="grid grid-cols-10 gap-1">
                {EMOJIS.map(e => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => { setIcon(e); setShowEmojis(false); }}
                    className={cn(
                      'text-xl w-9 h-9 flex items-center justify-center rounded-lg transition-all',
                      'hover:bg-slate-100 hover:scale-110',
                      icon === e && 'bg-slate-100 ring-2 ring-primary/40 scale-110'
                    )}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Color palette ───────────────────────────────────── */}
          <div>
            <Label className="text-sm font-semibold text-slate-700 mb-3 block">背景カラー</Label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map(c => (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  onClick={() => setColorId(c.id)}
                  style={{ backgroundColor: c.hex }}
                  className={cn(
                    'w-9 h-9 rounded-full shrink-0 transition-all duration-150',
                    'hover:scale-110 hover:ring-2 hover:ring-offset-2 hover:ring-slate-300',
                    'flex items-center justify-center',
                    colorId === c.id && 'scale-110 ring-2 ring-offset-2 ring-slate-400'
                  )}>
                  {colorId === c.id && (
                    <Check className="w-4 h-4 text-white drop-shadow-sm" strokeWidth={2.5} />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ── App name ────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="pub-name" className="text-sm font-semibold text-slate-700">
              アプリ名 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="pub-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例：月次売上ダッシュボード"
              className="font-medium"
            />
          </div>

          {/* ── Description ─────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="pub-desc" className="text-sm font-semibold text-slate-700">
              説明
            </Label>
            <Textarea
              id="pub-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="このアプリの機能・用途を説明してください"
              rows={3}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 border-t">
          <Button type="button" variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!name.trim()}
            className="gap-2 text-white border-0 px-6"
            style={{ backgroundColor: currentColor.hex }}>
            <Check className="w-4 h-4" />
            {mode === 'publish' ? '立即发布' : '保存信息'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
