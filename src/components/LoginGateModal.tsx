import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";

interface LoginGateModalProps {
  open: boolean;
  actionLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
  onLogin?: () => void;
}

export default function LoginGateModal({ open, actionLabel = "この操作", onClose, onConfirm, onLogin }: LoginGateModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px] animate-in fade-in duration-200"
        onClick={onClose}
      />
      <Card className="relative w-[92%] max-w-md border-indigo-200 shadow-2xl animate-in zoom-in-95 fade-in slide-in-from-bottom-2 duration-300">
        <CardContent className="p-7 text-center space-y-4">
          <div className="text-4xl animate-pulse">✨</div>
          <h3 className="text-xl font-bold">
            今すぐアカウント登録して、
            <br />今すぐApp開発の旅を始めよう
          </h3>
          <p className="text-sm text-slate-600">{actionLabel}を続けるにはログイン／登録が必要です。</p>
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose}>あとで</Button>
            <Button className="flex-1" onClick={onConfirm}>今すぐ登録</Button>
          </div>
          <p className="text-xs text-slate-500">
            すでにアカウントをお持ちですか？{" "}
            <button className="text-indigo-600 hover:underline" onClick={() => (onLogin ? onLogin() : onConfirm())}>
              ログイン
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
