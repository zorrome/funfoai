import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../services/api";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [serverToken, setServerToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const send = async () => {
    setError(""); setMessage("");
    try {
      const r = await api.forgotPassword(email);
      setServerToken(r.resetToken || "");
      setMessage("リセット案内を送信しました（デモではトークンを画面表示）");
      setStep("reset");
    } catch (e: any) {
      setError(e?.message || "送信に失敗しました");
    }
  };

  const reset = async () => {
    setError(""); setMessage("");
    try {
      await api.resetPassword(token, newPassword);
      setMessage("パスワードを更新しました。ログインしてください。");
      setTimeout(() => navigate('/login'), 900);
    } catch (e: any) {
      setError(e?.message || "リセットに失敗しました");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl p-6">
        <h1 className="text-2xl font-bold mb-1">パスワード再設定</h1>
        <p className="text-sm text-slate-500 mb-6">メールで再設定トークンを受け取り、パスワードを更新します。</p>

        {step === "email" ? (
          <div className="space-y-3">
            <input className="w-full border border-slate-300 rounded-lg px-3 py-2" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button onClick={send} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2">トークン送信</button>
          </div>
        ) : (
          <div className="space-y-3">
            {serverToken && (
              <div className="text-xs p-2 rounded bg-amber-50 border border-amber-200 text-amber-700">デモ用トークン: <b>{serverToken}</b></div>
            )}
            <input className="w-full border border-slate-300 rounded-lg px-3 py-2" placeholder="リセットトークン" value={token} onChange={(e) => setToken(e.target.value)} />
            <input type="password" className="w-full border border-slate-300 rounded-lg px-3 py-2" placeholder="新しいパスワード" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <button onClick={reset} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2">パスワード更新</button>
          </div>
        )}

        {message && <p className="text-sm text-emerald-600 mt-3">{message}</p>}
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

        <button className="mt-4 text-sm text-indigo-600 hover:underline" onClick={() => navigate('/login')}>ログインへ戻る</button>
      </div>
    </div>
  );
}
