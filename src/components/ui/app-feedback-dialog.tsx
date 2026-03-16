import { AlertTriangle, CheckCircle2, Info, Sparkles } from 'lucide-react';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog';

type Tone = 'info' | 'success' | 'warning' | 'danger';

export type AppFeedbackDialogProps = {
  open: boolean;
  tone?: Tone;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  hideCancel?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
};

const toneMap: Record<Tone, { icon: any; wrap: string; iconWrap: string }> = {
  info: {
    icon: Info,
    wrap: 'from-slate-50 via-white to-blue-50 border-slate-200',
    iconWrap: 'bg-blue-100 text-blue-700',
  },
  success: {
    icon: CheckCircle2,
    wrap: 'from-emerald-50 via-white to-teal-50 border-emerald-200',
    iconWrap: 'bg-emerald-100 text-emerald-700',
  },
  warning: {
    icon: Sparkles,
    wrap: 'from-amber-50 via-white to-orange-50 border-amber-200',
    iconWrap: 'bg-amber-100 text-amber-700',
  },
  danger: {
    icon: AlertTriangle,
    wrap: 'from-red-50 via-white to-rose-50 border-red-200',
    iconWrap: 'bg-red-100 text-red-700',
  },
};

export default function AppFeedbackDialog({
  open,
  tone = 'info',
  title,
  description,
  confirmText = '确定',
  cancelText = '取消',
  hideCancel = false,
  onConfirm,
  onCancel,
  busy = false,
}: AppFeedbackDialogProps) {
  const visual = toneMap[tone];
  const Icon = visual.icon;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent className={`w-[min(92vw,720px)] rounded-[28px] border bg-gradient-to-br ${visual.wrap} p-0 shadow-2xl`}>
        <div className="overflow-hidden rounded-[28px]">
          <DialogHeader className="px-7 pt-7 pb-4 text-left">
            <div className="flex items-start gap-4">
              <div className={`mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${visual.iconWrap}`}>
                <Icon className="h-6 w-6" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <DialogTitle className="text-xl font-semibold text-slate-900">{title}</DialogTitle>
                <DialogDescription className="text-sm leading-6 text-slate-600 whitespace-pre-wrap">{description}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogFooter className="border-t border-slate-200/80 bg-white/70 px-7 py-5 sm:justify-end">
            {!hideCancel && (
              <Button type="button" variant="outline" onClick={onCancel} disabled={busy} className="min-w-28 rounded-xl">
                {cancelText}
              </Button>
            )}
            <Button type="button" onClick={onConfirm} disabled={busy} className="min-w-28 rounded-xl bg-slate-900 text-white hover:bg-slate-800">
              {busy ? '处理中…' : confirmText}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
