import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, Sparkles } from "lucide-react";
import { api } from "../services/api";

type Mode = "register-choice" | "register-form" | "login";

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get("redirect") || "/";
  const initialMode = params.get("mode") === "login" ? "login" : "register-choice";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [error, setError] = useState("");

  const saveAuthAndGo = (token: string) => {
    localStorage.setItem("funfo_token", token);
    navigate(redirect);
  };

  const onLogin = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api.login({ email, password });
      saveAuthAndGo(r.token);
    } catch (e: any) {
      setError(e?.message || "ログインに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const onRegister = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api.register({ email, password, nickname });
      saveAuthAndGo(r.token);
    } catch (e: any) {
      setError(e?.message || "登録に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const onGoogleRegister = () => {
    setError("");
    alert("Google登録は現在準備中です。近日中に対応します。");
  };

  const onNextWithEmail = async () => {
    if (!email) return;
    setError('');
    setCheckingEmail(true);
    try {
      const r = await api.checkEmailExists(email);
      if (r.exists) {
        setError('このメールは既に登録されています。ログインしてください。');
        setMode('login');
      } else {
        setMode('register-form');
      }
    } catch (e: any) {
      setError(e?.message || 'メール確認に失敗しました');
    } finally {
      setCheckingEmail(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white/95 border border-indigo-100 rounded-2xl shadow-2xl p-6 backdrop-blur animate-in fade-in zoom-in-95 duration-300">
        <button
          onClick={() => navigate(redirect)}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> 戻る
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-tight">funfo AI</h1>
            <p className="text-xs text-slate-500">App開発を、もっと速く。</p>
          </div>
        </div>

        <p className="text-sm text-slate-500 mb-6">アカウントを作成して開発を始めましょう</p>

        {mode === "register-choice" && (
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="メールアドレス"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              type="button"
              disabled={!email || checkingEmail}
              onClick={onNextWithEmail}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg py-2.5 font-medium"
            >
              {checkingEmail ? '確認中...' : 'メールで登録を続ける'}
            </button>
            <button
              type="button"
              onClick={onGoogleRegister}
              className="w-full border border-slate-300 hover:border-slate-400 bg-white rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition hover:shadow-sm"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.26-.96 2.33-2.04 3.06l3.3 2.56c1.92-1.77 3.04-4.38 3.04-7.5 0-.73-.07-1.43-.2-2.1H12z"/>
                <path fill="#34A853" d="M12 22c2.76 0 5.08-.91 6.77-2.46l-3.3-2.56c-.91.61-2.08.97-3.47.97-2.67 0-4.93-1.8-5.74-4.22H2.85v2.65A9.99 9.99 0 0 0 12 22z"/>
                <path fill="#FBBC05" d="M6.26 13.73A5.98 5.98 0 0 1 5.94 12c0-.6.11-1.17.32-1.73V7.62H2.85A9.99 9.99 0 0 0 2 12c0 1.61.39 3.13 1.08 4.38l3.18-2.65z"/>
                <path fill="#4285F4" d="M12 6.05c1.5 0 2.84.52 3.9 1.53l2.93-2.93C17.07 2.98 14.75 2 12 2A9.99 9.99 0 0 0 2.85 7.62l3.41 2.65C7.07 7.85 9.33 6.05 12 6.05z"/>
              </svg>
              Googleで新規登録
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <p className="text-xs text-slate-500 text-center pt-2">
              すでにアカウントをお持ちですか？{" "}
              <button
                className="text-indigo-600 hover:underline"
                onClick={() => {
                  setError("");
                  setMode("login");
                }}
              >
                ログイン
              </button>
            </p>
          </div>
        )}

        {mode === "register-form" && (
          <div className="space-y-3 animate-in fade-in zoom-in-95 duration-300">
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 bg-slate-50 text-slate-600"
              value={email}
              disabled
            />
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="ニックネーム"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
            <input
              type="password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="パスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              disabled={loading || !email || !password || !nickname}
              onClick={onRegister}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg py-2.5 font-medium"
            >
              {loading ? "登録中..." : "登録する"}
            </button>
            <p className="text-xs text-slate-500 text-center pt-1">
              すでにアカウントをお持ちですか？{" "}
              <button className="text-indigo-600 hover:underline" onClick={() => setMode("login")}>ログイン</button>
            </p>
          </div>
        )}

        {mode === "login" && (
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="メールアドレス"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="パスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              disabled={loading || !email || !password}
              onClick={onLogin}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg py-2.5 font-medium"
            >
              {loading ? "ログイン中..." : "ログイン"}
            </button>
            <p className="text-xs text-slate-500 text-center pt-1">
              まだアカウントをお持ちでないですか？{" "}
              <button className="text-indigo-600 hover:underline" onClick={() => setMode("register-choice")}>新規登録</button>
            </p>
          </div>
        )}

        <div className="mt-4 text-sm text-center">
          <button className="text-indigo-600 hover:underline" onClick={() => navigate('/forgot-password')}>パスワードを忘れた方</button>
        </div>
      </div>
    </div>
  );
}
