import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import {
  Sparkles, Store as StoreIcon, Folder, Send,
  Plus, Smartphone, Laptop, Monitor,
  FileText, ArrowUp, GripVertical, ArrowLeft,
  Trash2, Edit3, Star, Loader2, Rocket,
  Share2, ChevronRight, TrendingUp, RotateCw,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { cn } from "../components/ui/utils";
import AppPreview from "../components/AppPreview";
import PublishDialog from "../components/PublishDialog";
import LoginGateModal from "../components/LoginGateModal";
import { api, App, Message, AppVersion, User } from "../services/api";
import { AppLang, getLang, setLang, tr } from "../i18n";

type TabType = "workspace" | "store" | "market" | "myapps" | "profile";
type DeviceType = "mobile" | "laptop" | "desktop";

const REQ_CARD_PREFIX = '__FUNFO_REQ__';

function parseReqCard(content: string): { text: string; answers: Array<{ title: string; answer: string }> } | null {
  if (!content?.startsWith(REQ_CARD_PREFIX)) return null;
  try {
    return JSON.parse(content.slice(REQ_CARD_PREFIX.length));
  } catch {
    return null;
  }
}

function sortVersionsByEditedTime(list: AppVersion[]): AppVersion[] {
  return [...(list || [])].sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    if (tb !== ta) return tb - ta;
    return (b.id || 0) - (a.id || 0);
  });
}

function formatEditedTime(ts?: string) {
  if (!ts) return '--';
  // SQLite datetime('now') is UTC. Treat raw "YYYY-MM-DD HH:mm:ss" as UTC explicitly.
  const isoUtc = ts.includes('T') ? ts : ts.replace(' ', 'T');
  const d = new Date(isoUtc.endsWith('Z') ? isoUtc : `${isoUtc}Z`);
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getLocalGuestKey() {
  try {
    return localStorage.getItem('funfo_guest_key');
  } catch {
    return null;
  }
}

function canEditApp(app: any, user: User | null) {
  if (!app || !user) return false;
  const ownerId = app.owner_user_id as number | string | null | undefined;
  if (ownerId === null || ownerId === undefined) return false;
  return Number(ownerId) === Number(user.id);
}

function canGuestGenerateFirstApp(app: any, user: User | null, versions: AppVersion[], messages: Message[]) {
  if (user || !app) return false;
  const ownerId = app.owner_user_id as number | null | undefined;
  const appGuestKey = app.guest_key as string | null | undefined;
  if (ownerId || !appGuestKey || appGuestKey !== getLocalGuestKey()) return false;
  return (versions?.length || 0) === 0 && (messages?.length || 0) === 0;
}

function isFixIntent(text: string) {
  const t = text.toLowerCase();
  return [
    '修复', '修正', 'バグ', '报错', 'エラー', '直して', 'fix', 'broken', '動かない', 'クラッシュ',
  ].some(k => t.includes(k));
}

const DESIGN_PATTERNS = [
  {
    id: 'executive',
    label: 'Executive Dashboard',
    guide: 'High-contrast KPI cards, strong hierarchy, clean charts, concise business tone.',
    recipe: 'Use bg-slate-50 page, white card surfaces, KPI cards in 4-col grid, bold section headers, compact chart legends.',
    tokens: ['bg-slate-50', 'xl:grid-cols-4', 'rounded-xl border bg-white', 'bg-emerald-600'],
    skeleton: `<div className="min-h-screen bg-slate-50 p-6 space-y-6">
  <header className="flex items-center justify-between">
    <h1 className="text-2xl font-bold text-slate-900">📊 {APP_TITLE}</h1>
    <button className="px-4 py-2 rounded-lg bg-emerald-600 text-white">主要操作</button>
  </header>
  <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">{KPI_CARDS}</section>
  <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
    <div className="xl:col-span-2 bg-white rounded-xl border p-4">{MAIN_CHART}</div>
    <div className="bg-white rounded-xl border p-4">{SIDE_INSIGHTS}</div>
  </section>
  <section className="bg-white rounded-xl border p-4">{PRIMARY_TABLE}</section>
</div>`
  },
  {
    id: 'glass',
    label: 'Glassmorphism Pro',
    guide: 'Layered translucent cards, soft blur, gradient accents, modern premium feel.',
    recipe: 'Use gradient page background + backdrop-blur cards (bg-white/30), soft borders, large rounded corners, subtle glow CTA.',
    tokens: ['bg-gradient-to-br', 'backdrop-blur', 'bg-white/35', 'from-teal-100'],
    skeleton: `<div className="min-h-screen bg-gradient-to-br from-teal-100 via-cyan-100 to-emerald-100 p-6">
  <header className="backdrop-blur bg-white/40 border border-white/50 rounded-2xl p-5 mb-5">{HERO_HEADER}</header>
  <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">{GLASS_METRICS}</section>
  <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div className="backdrop-blur bg-white/35 border border-white/50 rounded-2xl p-4">{GLASS_CHART}</div>
    <div className="backdrop-blur bg-white/35 border border-white/50 rounded-2xl p-4">{GLASS_LIST}</div>
  </section>
</div>`
  },
  {
    id: 'bento',
    label: 'Bento Grid',
    guide: 'Asymmetric module grid, large visual blocks, varied card sizes, editorial rhythm.',
    recipe: 'Use CSS grid with mixed col-span/row-span cards, one hero card, two medium analytics cards, and compact action list cards.',
    skeleton: `<div className="min-h-screen bg-slate-100 p-6">
  <div className="grid grid-cols-1 md:grid-cols-4 auto-rows-[160px] gap-4">
    <div className="md:col-span-2 md:row-span-2 bg-white rounded-2xl border p-5">{HERO_BLOCK}</div>
    <div className="md:col-span-2 bg-white rounded-2xl border p-4">{TREND_BLOCK}</div>
    <div className="bg-white rounded-2xl border p-4">{KPI_A}</div>
    <div className="bg-white rounded-2xl border p-4">{KPI_B}</div>
    <div className="md:col-span-2 bg-white rounded-2xl border p-4">{ACTION_BLOCK}</div>
    <div className="md:col-span-2 bg-white rounded-2xl border p-4">{TABLE_BLOCK}</div>
  </div>
</div>`
  },
  {
    id: 'mobile-first',
    label: 'Mobile-First',
    guide: 'Compact density, thumb-friendly controls, sticky actions, responsive-first layout.',
    recipe: 'Start with single-column layout, sticky bottom action bar, 44px controls, short labels, progressive disclosure sections.',
    skeleton: `<div className="min-h-screen bg-slate-50 max-w-md mx-auto p-4 pb-24 space-y-4">
  <header className="bg-white rounded-xl border p-4">{MOBILE_HEADER}</header>
  <section className="bg-white rounded-xl border p-4">{MOBILE_PRIMARY_CARD}</section>
  <section className="space-y-3">{MOBILE_LIST_ITEMS}</section>
  <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-3 bg-white/95 border-t flex gap-2">
    <button className="h-11 flex-1 rounded-lg bg-emerald-600 text-white">主要操作</button>
    <button className="h-11 px-4 rounded-lg border bg-white">次要</button>
  </div>
</div>`
  },
  {
    id: 'data-lab',
    label: 'Data Lab',
    guide: 'Dense analytical layout, filters + drilldown, table/chart dual view, operational UI.',
    recipe: 'Use filter toolbar + split chart/table view, compact spacing, visible sort/filter states, and explicit metric deltas.',
    skeleton: `<div className="min-h-screen bg-slate-100 p-5 space-y-4">
  <header className="bg-white border rounded-lg p-4">{TITLE_AND_SUMMARY}</header>
  <section className="bg-white border rounded-lg p-3 flex flex-wrap gap-2">{FILTER_BAR}</section>
  <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
    <div className="bg-white border rounded-lg p-4">{ANALYTICS_CHARTS}</div>
    <div className="bg-white border rounded-lg p-4">{DATA_TABLE}</div>
  </section>
  <section className="bg-white border rounded-lg p-4">{DRILLDOWN_PANEL}</section>
</div>`
  },
  {
    id: 'tailwind-native',
    label: 'Tailwind Native (Your Favorite)',
    guide: 'Pure Tailwind utility-first style with clean spacing scale, semantic color tokens, and production-ready component consistency.',
    recipe: 'Use only Tailwind utility classes, avoid custom CSS, prefer consistent spacing (4/6/8), rounded-xl cards, and clear hover/focus states.',
    tokens: ['min-h-screen bg-slate-50', 'rounded-xl border bg-white', 'space-y-6', 'bg-emerald-600'],
    skeleton: `<div className="min-h-screen bg-slate-50 p-6 space-y-6">
  <header className="flex items-center justify-between">{TW_HEADER}</header>
  <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">{TW_STATS}</section>
  <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
    <div className="xl:col-span-2 rounded-xl border bg-white p-4">{TW_MAIN}</div>
    <div className="rounded-xl border bg-white p-4">{TW_SIDE}</div>
  </section>
  <section className="rounded-xl border bg-white p-4">{TW_TABLE}</section>
</div>`
  },
  {
    id: 'neo-brutal',
    label: 'Neo Brutal UI',
    guide: 'Bold blocks, thick borders, strong shadows, playful but readable business UI.',
    recipe: 'Use thick border-2/3, hard shadows, strong accent colors, square-ish corners, and bold typography hierarchy.',
    skeleton: `<div className="min-h-screen bg-yellow-50 p-6">
  <header className="border-2 border-black bg-pink-300 shadow-[6px_6px_0_#000] p-4 mb-4">{NB_HEADER}</header>
  <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">{NB_CARDS}</section>
  <section className="border-2 border-black bg-white shadow-[6px_6px_0_#000] p-4">{NB_MAIN}</section>
</div>`
  },
  {
    id: 'saas-clean',
    label: 'SaaS Clean',
    guide: 'Modern SaaS admin style with restrained palette, clear hierarchy, and strong readability.',
    recipe: 'Use neutral base, emerald accents, compact cards, thin borders, and practical forms/table UX.',
    skeleton: `<div className="min-h-screen bg-white p-6 space-y-5">
  <header className="border-b pb-3">{SAAS_HEADER}</header>
  <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
    <aside className="lg:col-span-3 rounded-xl border bg-slate-50 p-4">{SAAS_FILTERS}</aside>
    <main className="lg:col-span-9 space-y-4">
      <div className="rounded-xl border bg-white p-4">{SAAS_METRICS}</div>
      <div className="rounded-xl border bg-white p-4">{SAAS_TABLE}</div>
    </main>
  </section>
</div>`
  }
];

const STORE_TEMPLATES = [
  { emoji: "📊", label: "売上分析", prompt: "複数店舗の日次売上ダッシュボード。棒グラフで比較・前日比を表示する飲食店向けアプリ" },
  { emoji: "📅", label: "シフト管理", prompt: "従業員の週間シフト表。セル選択で担当者を割り当てられるシフト管理アプリ" },
  { emoji: "📦", label: "在庫管理", prompt: "食材在庫の一覧管理。低在庫で赤くハイライト、入出庫ボタン付きの在庫管理アプリ" },
  { emoji: "💰", label: "経費管理", prompt: "月別経費の円グラフと明細リスト。カテゴリーでフィルタ可能な経費管理アプリ" },
];

const FEATURED = [
  { icon: "🍽️", name: "テーブル・席管理システム",    desc: "フロア図で空席・予約・会計中ステータスを一目管理できる飲食店向けアプリ",                   category: "飲食" },
  { icon: "📊", name: "多店舗売上ダッシュボード",     desc: "複数店舗の日次売上・客数・客単価をリアルタイムにグラフ集計する分析アプリ",                 category: "分析" },
  { icon: "👥", name: "AI勤務シフト作成",             desc: "従業員の希望シフトを入力すると、AIが最適な週間シフトを自動生成するアプリ",                   category: "人事" },
  { icon: "🧾", name: "月次損益計算書",               desc: "売上・原価・人件費・経費を入力するだけで月次P&Lを自動計算・グラフ表示する財務アプリ",         category: "財務" },
  { icon: "📦", name: "食材在庫管理",                 desc: "食材の入出庫を記録し、安全在庫を下回ったら赤くアラートを出す在庫管理アプリ",                 category: "在庫" },
  { icon: "🎯", name: "会員ポイントシステム",         desc: "来店・会計金額でポイントを付与し、会員ランクと特典を管理する顧客管理アプリ",                 category: "顧客" },
];

interface StoreApp {
  icon: string;
  name: string;
  publisher: string;
  desc: string;
  usage: string;
  rating: string;
  category: string;
  color: string; // hex
}

const ALL_APPS: StoreApp[] = [
  // ── 🍜 飲食
  { icon: "🍽️", name: "テーブル・席管理",        publisher: "✦ 公式",                   desc: "フロア図で空席・予約・会計中ステータスを一目管理",          usage: "3.1k", rating: "4.9", category: "飲食", color: "#f97316" },
  { icon: "📋", name: "デジタルメニュー作成",      publisher: "✦ 公式",                   desc: "写真・価格・アレルゲン付きメニューをQRコードで配信",       usage: "2.7k", rating: "4.8", category: "飲食", color: "#f97316" },
  { icon: "🔔", name: "注文・呼び出しシステム",    publisher: "コミュニティ @sushi_dx",   desc: "テーブルから注文・呼び出しをデジタル化、厨房へ即通知",     usage: "1.9k", rating: "4.7", category: "飲食", color: "#f97316" },
  { icon: "📅", name: "予約管理カレンダー",        publisher: "✦ 公式",                   desc: "来店予約を一元管理。過去履歴・アレルギー情報も保存",       usage: "2.2k", rating: "4.8", category: "飲食", color: "#f97316" },
  { icon: "🍱", name: "日替わりメニュー計画",      publisher: "コミュニティ @bento_pro",  desc: "週ごとのランチメニューをカレンダー形式で計画・公開",       usage: "876",  rating: "4.5", category: "飲食", color: "#f97316" },

  // ── 📊 分析
  { icon: "📊", name: "売上日報ダッシュボード",    publisher: "✦ 公式",                   desc: "日次売上・客数・客単価をグラフで自動集計",                 usage: "4.2k", rating: "4.9", category: "分析", color: "#6366f1" },
  { icon: "📈", name: "時間帯別売上分析",          publisher: "✦ 公式",                   desc: "ピーク時間帯・曜日別の売上ヒートマップを可視化",           usage: "2.1k", rating: "4.8", category: "分析", color: "#6366f1" },
  { icon: "🏆", name: "メニュー人気ランキング",    publisher: "コミュニティ @izakaya_pro", desc: "注文数・粗利・回転率で人気メニューをランキング表示",       usage: "1.6k", rating: "4.7", category: "分析", color: "#6366f1" },
  { icon: "💬", name: "レビュー集計ダッシュボード",publisher: "✦ 公式",                   desc: "Google・食べログのレビューをAIで感情分析・集約",           usage: "1.1k", rating: "4.7", category: "分析", color: "#6366f1" },
  { icon: "🔍", name: "食材コスト分析",            publisher: "コミュニティ @ramen_dx",   desc: "食材ごとの価格推移と原価率インパクトを分析",               usage: "743",  rating: "4.5", category: "分析", color: "#6366f1" },

  // ── 👥 人事
  { icon: "👥", name: "従業員シフト表",            publisher: "✦ 公式",                   desc: "ドラッグ&ドロップで直感的な週間シフト作成",               usage: "3.8k", rating: "4.9", category: "人事", color: "#3b82f6" },
  { icon: "⏰", name: "勤怠・打刻管理",            publisher: "✦ 公式",                   desc: "スマホQRコードで出退勤を打刻、残業・遅刻を自動集計",      usage: "2.9k", rating: "4.8", category: "人事", color: "#3b82f6" },
  { icon: "📝", name: "採用・応募管理ボード",      publisher: "✦ 公式",                   desc: "求人応募者をカンバン管理。面接日程調整までワンストップ",   usage: "1.2k", rating: "4.6", category: "人事", color: "#3b82f6" },
  { icon: "🎓", name: "スタッフ研修チェックリスト",publisher: "コミュニティ @staff_mgr", desc: "新人研修の進捗をチェックリスト形式で可視化・管理",         usage: "891",  rating: "4.5", category: "人事", color: "#3b82f6" },
  { icon: "⭐", name: "スタッフ評価シート",        publisher: "✦ 公式",                   desc: "月次のパフォーマンス評価をスコア化、成長グラフを表示",     usage: "1.0k", rating: "4.7", category: "人事", color: "#3b82f6" },

  // ── 💰 財務
  { icon: "🧾", name: "月次損益計算書",            publisher: "✦ 公式",                   desc: "売上・原価・人件費・経費から月次P&Lを自動生成",           usage: "2.6k", rating: "4.9", category: "財務", color: "#22c55e" },
  { icon: "💳", name: "経費精算システム",          publisher: "✦ 公式",                   desc: "レシート写真をアップロードして経費を登録・承認フロー",     usage: "1.8k", rating: "4.7", category: "財務", color: "#22c55e" },
  { icon: "💰", name: "キャッシュフロー予測",      publisher: "✦ 公式",                   desc: "入出金予定から今後3ヶ月のCFを予測・グラフ表示",           usage: "1.3k", rating: "4.8", category: "財務", color: "#22c55e" },
  { icon: "📊", name: "予算実績管理",              publisher: "コミュニティ @cfo_tool",   desc: "月次予算と実績を比較、達成率をゲージで可視化",             usage: "967",  rating: "4.6", category: "財務", color: "#22c55e" },
  { icon: "🏦", name: "売掛・買掛管理",            publisher: "コミュニティ @accounting", desc: "取引先ごとの未払い・未収金を一覧管理、督促日程設定",       usage: "734",  rating: "4.5", category: "財務", color: "#22c55e" },

  // ── 📦 在庫
  { icon: "📦", name: "食材在庫管理",              publisher: "✦ 公式",                   desc: "食材の入出庫を記録し、安全在庫を割ったらアラート",         usage: "3.3k", rating: "4.9", category: "在庫", color: "#f59e0b" },
  { icon: "🥤", name: "ドリンク在庫トラッカー",    publisher: "コミュニティ @bar_system", desc: "ボトル単位で管理。発注点に達したら自動メール通知",          usage: "1.4k", rating: "4.7", category: "在庫", color: "#f59e0b" },
  { icon: "📋", name: "棚卸し管理シート",          publisher: "✦ 公式",                   desc: "月次棚卸しを効率化。前月比較・差異レポート自動生成",       usage: "1.7k", rating: "4.8", category: "在庫", color: "#f59e0b" },
  { icon: "🚚", name: "発注・仕入れ管理",          publisher: "✦ 公式",                   desc: "仕入先別に発注履歴・単価推移を管理、PDF発注書出力",        usage: "2.0k", rating: "4.8", category: "在庫", color: "#f59e0b" },
  { icon: "⚠️", name: "廃棄ロス記録",              publisher: "コミュニティ @eco_food",   desc: "日次廃棄量を記録し、ロス率と金額を週次グラフで把握",       usage: "892",  rating: "4.6", category: "在庫", color: "#f59e0b" },

  // ── 🎯 顧客
  { icon: "🎯", name: "会員ポイントシステム",      publisher: "✦ 公式",                   desc: "来店・会計金額でポイント付与、会員ランク管理",             usage: "4.0k", rating: "4.9", category: "顧客", color: "#ec4899" },
  { icon: "📱", name: "LINE友だちCRM",              publisher: "✦ 公式",                   desc: "LINE登録客に誕生日クーポン・来店催促メッセージを自動配信", usage: "2.8k", rating: "4.8", category: "顧客", color: "#ec4899" },
  { icon: "😊", name: "顧客満足度アンケート",      publisher: "✦ 公式",                   desc: "QRコードで退店後アンケート収集、NPS・評価を集計",          usage: "1.5k", rating: "4.7", category: "顧客", color: "#ec4899" },
  { icon: "🎁", name: "クーポン・特典管理",        publisher: "コミュニティ @mkt_cafe",   desc: "デジタルクーポンを発行、利用率・効果測定まで一元管理",     usage: "1.2k", rating: "4.6", category: "顧客", color: "#ec4899" },
  { icon: "🔄", name: "リピーター分析",            publisher: "✦ 公式",                   desc: "来店頻度・RFM分析で優良顧客を特定、離反予防アクション",   usage: "1.1k", rating: "4.7", category: "顧客", color: "#ec4899" },
];

const COLOR_HEX: Record<string, string> = {
  indigo: '#6366f1', purple: '#a855f7', blue: '#3b82f6', cyan: '#06b6d4',
  teal: '#14b8a6', green: '#22c55e', lime: '#84cc16', yellow: '#facc15',
  orange: '#f97316', red: '#ef4444', pink: '#ec4899', rose: '#f43f5e',
  slate: '#475569', stone: '#78716c', zinc: '#3f3f46', sky: '#0ea5e9',
};
function appIconStyle(color?: string | null) {
  return color ? { backgroundColor: COLOR_HEX[color] ?? '#6366f1' } : undefined;
}

// ── Partial code extractor (for streaming) ──────────────────────────
function extractPartialCode(content: string): string {
  // Complete code block
  const complete = content.match(/```(?:jsx?|tsx?)\n([\s\S]*?)```/);
  if (complete) return complete[1];
  // Partial code block (streaming, no closing ```)
  const partial = content.match(/```(?:jsx?|tsx?)\n([\s\S]*)$/);
  if (partial) return partial[1];
  // Fallback: show raw streaming text so user can see generation progress immediately
  if (content.trim()) return content;
  return '';
}

// ── Inline code block (compact, in chat) ──────────────────────────
function InlineCodeBadge({ lineCount }: { lineCount: number }) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-600 font-mono">
      <span className="w-2 h-2 rounded-full bg-green-500" />
      UIコードを生成しました ({lineCount} 行)
    </div>
  );
}

// ── Assistant message (text only, code replaced by badge) ─────────
function AssistantMessage({ content }: { content: string }) {
  const parts: { type: 'text' | 'code'; value: string }[] = [];
  const re = /```(?:\w*)\n?([\s\S]*?)```/g;
  let last = 0, m;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: content.slice(last, m.index) });
    parts.push({ type: 'code', value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ type: 'text', value: content.slice(last) });

  return (
    <div className="space-y-2 text-sm text-foreground">
      {parts.map((p, i) =>
        p.type === 'text'
          ? p.value.trim() ? <p key={i} className="whitespace-pre-wrap leading-relaxed text-slate-700">{p.value.trim()}</p> : null
          : <InlineCodeBadge key={i} lineCount={p.value.split('\n').filter(Boolean).length} />
      )}
    </div>
  );
}

// ── Live code editor (shown in preview panel during streaming) ──────
function LiveCodeEditor({ code, isStreaming }: { code: string; isStreaming: boolean }) {
  const lines = code.split('\n');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [code]);

  return (
    <div className="flex-1 bg-[#0d1117] overflow-hidden flex flex-col">
      {/* Editor header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#161b22] border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/70" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
            <span className="w-3 h-3 rounded-full bg-green-500/70" />
          </div>
          <span className="text-xs font-mono text-slate-400">App.jsx</span>
        </div>
        {isStreaming ? (
          <div className="flex items-center gap-2">
            <span className="flex gap-1">
              {[0,1,2].map(i => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: `${i*0.12}s` }} />
              ))}
            </span>
            <span className="text-xs font-mono text-emerald-400">generating...</span>
          </div>
        ) : (
          <span className="text-xs font-mono text-slate-500">{lines.length} lines</span>
        )}
      </div>
      {/* Code */}
      <div className="flex-1 overflow-y-auto p-4">
        <pre className="font-mono text-xs leading-relaxed">
          {lines.map((line, i) => (
            <div key={i} className="flex min-h-[18px]">
              <span className="select-none text-slate-700 w-8 shrink-0 text-right mr-4 text-[11px]">{i + 1}</span>
              <span className={cn(
                'flex-1',
                line.match(/^\s*(\/\/|\/\*|\*)/) ? 'text-slate-500' :
                line.match(/\b(function|const|let|var|return|if|else|for|while|class|new)\b/) ? 'text-violet-300' :
                line.match(/className=/) ? 'text-sky-300' :
                line.match(/["'`]/) ? 'text-amber-200' :
                line.match(/[<>\/]/) ? 'text-red-300' :
                'text-slate-300'
              )}>
                {line || '\u00a0'}
              </span>
            </div>
          ))}
          {isStreaming && (
            <div className="flex">
              <span className="w-8 mr-4" />
              <span className="w-[2px] h-4 bg-emerald-400 animate-pulse inline-block rounded-sm" />
            </div>
          )}
        </pre>
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────
export default function VibeCoding() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>("store");
  const [lang, setLangState] = useState<AppLang>(() => getLang());
  const [user, setUser] = useState<User | null>(null);
  const [profileNick, setProfileNick] = useState('');
  const [profileAvatar, setProfileAvatar] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType>("laptop");
  const [storeCategory, setStoreCategory] = useState("all");
  const [previewWidth, setPreviewWidth] = useState(560);

  const [apps, setApps] = useState<App[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);

  const [currentApp, setCurrentApp] = useState<App | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [previewPort, setPreviewPort] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewTab, setPreviewTab] = useState<'preview' | 'errors' | 'fix'>('preview');
  const [appErrors, setAppErrors] = useState<Array<{type: string; message: string; detail: string; time: string; url?: string}>>([]);
  const [autoFixing, setAutoFixing] = useState(false);
  const [autoFixCount, setAutoFixCount] = useState(0);
  const [fixStreamingContent, setFixStreamingContent] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [backendStatus, setBackendStatus] = useState<{ running: boolean; reachable: boolean; apiPort: number | null } | null>(null);
  const [restartingBackend, setRestartingBackend] = useState(false);

  const [inputText, setInputText] = useState('');
  const [designPatternId, setDesignPatternId] = useState<string>('executive');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const streamingRef = useRef('');
  const streamAbortRef = useRef<null | (() => void)>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const lastAutoFixTsRef = useRef(0);
  const lastAutoFixSigRef = useRef('');

  const [storeInput, setStoreInput] = useState('');
  const [selectedStoreApp, setSelectedStoreApp] = useState<string | null>(null); // app name
  const storeInputRef = useRef<HTMLTextAreaElement>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [loginGateOpen, setLoginGateOpen] = useState(false);
  const [loginGateAction, setLoginGateAction] = useState('この操作');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [guestTrialCount, setGuestTrialCount] = useState<number>(() => {
    const n = Number(localStorage.getItem('funfo_guest_trial_count') || '0');
    return Number.isFinite(n) ? n : 0;
  });
  const [planSteps, setPlanSteps] = useState<string[]>([]);
  const [questionnaire, setQuestionnaire] = useState<Array<{ id: string; title: string; options: string[]; answer?: string }>>([]);
  const [pendingGeneration, setPendingGeneration] = useState<{ appId: number; text: string } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [showExtraRequirement, setShowExtraRequirement] = useState(false);
  const [extraRequirement, setExtraRequirement] = useState('');
  const t = (key: string) => tr(lang, key);
  const getPreviewUrl = (d: any): string | null => {
    if (!d) return null;
    if (d.preview_slug) return `${window.location.protocol}//${window.location.host}/app/${d.preview_slug}/`;
    if (d.preview_url) return d.preview_url;
    if (d.preview_port) return `http://${window.location.hostname}:${d.preview_port}`;
    return null;
  };

  const editableApps = useMemo(() => apps.filter(a => canEditApp(a as any, user)), [apps, user]);
  const currentAppEditable = useMemo(() => canEditApp(currentApp as any, user), [currentApp, user]);
  const autoFixAutoEnabled = useMemo(() => {
    if (!currentApp) return false;
    return (currentApp.current_version || 1) <= 1 || (versions?.length || 0) <= 1;
  }, [currentApp, versions]);
  const canSubmitReview = useMemo(() => {
    if (!currentApp) return false;
    return currentApp.status === 'draft';
  }, [currentApp]);

  const fetchApps = useCallback(async () => {
    setAppsLoading(true);
    try { setApps(await api.listApps()); }
    catch (e) { console.error(e); }
    finally { setAppsLoading(false); }
  }, []);

  const buildLoginUrl = (mode?: 'login') => {
    const p = new URLSearchParams();
    if (mode === 'login') p.set('mode', 'login');
    const redirectParams = new URLSearchParams();
    if (currentApp?.id) {
      redirectParams.set('resumeApp', String(currentApp.id));
      redirectParams.set('tab', 'workspace');
    } else {
      redirectParams.set('tab', activeTab);
    }
    p.set('redirect', `${window.location.pathname}?${redirectParams.toString()}`);
    return `/login?${p.toString()}`;
  };

  useEffect(() => { fetchApps(); }, [fetchApps]);
  useEffect(() => {
    api.me().then(u => {
      setUser(u ?? null);
      if (u) {
        setProfileNick(u.nickname || '');
        setProfileAvatar(u.avatar_url || '');
      }
    }).catch(() => setUser(null));
  }, []);
  useEffect(() => { streamingRef.current = streamingContent; }, [streamingContent]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamingContent]);

  useEffect(() => {
    let timer: any = null;
    const tick = async () => {
      if (!currentApp?.id || !currentAppEditable) {
        setBackendStatus(null);
        return;
      }
      try {
        const s = await api.backendStatus(currentApp.id);
        setBackendStatus({ running: s.running, reachable: s.reachable, apiPort: s.apiPort ?? null });
      } catch {
        setBackendStatus({ running: false, reachable: false, apiPort: null });
      }
    };
    tick();
    if (activeTab === 'workspace' && currentApp?.id) timer = setInterval(tick, 12000);
    return () => { if (timer) clearInterval(timer); };
  }, [currentApp?.id, currentAppEditable, activeTab, previewRefreshKey]);
  useEffect(() => {
    const close = () => setUserMenuOpen(false);
    if (!userMenuOpen) return;
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [userMenuOpen]);

  const openApp = useCallback(async (appId: number) => {
    try {
      const data = await api.getApp(appId);
      const sorted = sortVersionsByEditedTime(data.versions || []);
      setCurrentApp(data);
      setMessages(data.messages || []);
      setVersions(sorted);
      setSelectedVersionId(sorted[0]?.id ?? null);
      setPreviewPort(data.preview_port ?? null);
      setPreviewUrl(getPreviewUrl(data));
      setPreviewRefreshKey(k => k + 1);
      setStreamingContent('');
      setFixStreamingContent('');
      setAppErrors([]);
      setAutoFixCount(0);
      setPreviewTab('preview');
      setActiveTab("workspace");
    } catch (e: any) {
      const msg = String(e?.message || e || 'アプリを開けませんでした');
      alert(msg.includes('権限') || msg.includes('アクセス') ? 'この App は編集権限がありません。先に「自分用に編集」を使ってください。' : msg);
    }
  }, []);

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const tab = qs.get('tab') as TabType | null;
    const resumeApp = qs.get('resumeApp');
    if (tab && ['store', 'market', 'workspace', 'myapps', 'profile'].includes(tab)) {
      setActiveTab(tab);
    }
    if (resumeApp) {
      openApp(Number(resumeApp)).catch(() => {});
    }
  }, [openApp]);

  const runAutoFix = useCallback(async (entry: {type: string; message: string; detail: string; time: string; url?: string}) => {
    if (!currentApp || autoFixing || !currentAppEditable) return;
    const maxRetry = user ? 50 : 80;
    if (autoFixCount >= maxRetry) return;

    setAutoFixing(true);
    setPreviewTab('fix');
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('auto-fix timeout')), 90000);
    });
    try {
      setFixStreamingContent([
        '// 🔧 自動修正フローを開始',
        `// 1) エラー解析: ${entry.type}`,
        `// 2) 失敗箇所特定: ${entry.message}`,
        '// 3) 修正方針生成: UI/状態/API整合を再計算',
        '// 4) パッチ適用中...',
      ].join('\n'));
      let r: any = null;
      let lastErr: any = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          if (attempt > 1) {
            setFixStreamingContent(prev => `${prev}\n// ♻️ 再試行 ${attempt}/2 ...`);
          }
          r = await Promise.race([
            api.autoFixApp(currentApp.id, {
              error: entry.message,
              errorType: entry.type,
              detail: entry.detail,
              url: entry.url,
              retries: autoFixCount,
            }),
            timeoutPromise,
          ]);
          break;
        } catch (e) {
          lastErr = e;
          if (attempt < 2) {
            await new Promise(res => setTimeout(res, 1200));
            continue;
          }
        }
      }
      if (!r) throw lastErr || new Error('auto-fix failed');
      if (r.code) {
        setFixStreamingContent([
          '// ✅ 修正パッチ生成完了',
          '// 5) ビルド・プレビュー再起動',
          '// 6) 動作確認へ移行...',
          '',
          r.code,
        ].join('\n'));
      }
      setAutoFixCount(c => c + 1);
      if (r.previewPort !== undefined) setPreviewPort(r.previewPort ?? null);
      if (r.previewSlug) setPreviewUrl(`${window.location.protocol}//${window.location.host}/app/${r.previewSlug}/`);
      else if (r.previewPath) setPreviewUrl(`${window.location.protocol}//${window.location.host}${r.previewPath}`);
      setPreviewRefreshKey(k => k + 1);
      if (r.versionId) setSelectedVersionId(r.versionId);
      const fresh = await api.getApp(currentApp.id);
      setCurrentApp(fresh);
      setMessages(fresh.messages || []);
      setVersions(sortVersionsByEditedTime(fresh.versions || []));
      setAppErrors([]);
      setPreviewTab('preview');
    } catch (err: any) {
      const msg = String(err?.message || err || 'unknown error');
      setMessages(prev => [...prev, {
        id: Date.now(),
        app_id: currentApp.id,
        role: 'assistant',
        content: `⚠️ 自動修正に失敗: ${msg}`,
        created_at: new Date().toISOString(),
      }]);
      // permission / infra timeout / cooldown errors should not loop auto-fix
      if (
        msg.includes('権限') || msg.includes('アクセス') || msg.includes('403') || msg.includes('permission') ||
        msg.includes('cooldown') || msg.includes('already running') || msg.includes('aborted') || msg.includes('timeout') || msg.includes('timed out')
      ) {
        setAutoFixCount(maxRetry);
      }
      // avoid being stuck on fix panel
      setPreviewTab('preview');
    } finally {
      setAutoFixing(false);
    }
  }, [currentApp, autoFixing, autoFixCount, user, currentAppEditable]);

  // Listen for errors posted from preview iframes
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data?.__funfoError) return;

      const entry = {
        type: e.data.entry?.type || 'RuntimeError',
        message: e.data.entry?.message || 'Unknown error',
        detail: e.data.entry?.detail || '',
        time: e.data.entry?.time || new Date().toISOString(),
        url: e.data.entry?.url || '',
      };

      setAppErrors(prev => [entry, ...prev].slice(0, 50));
      const fatalTypes = ['CompileError', 'RenderError', 'RuntimeError', 'UnhandledRejection'];
      if (activeTab === 'workspace' && fatalTypes.includes(entry.type)) setPreviewTab('errors');

      // Automatic debug/auto-fix is disabled in docker production flow.
      // Keep manual fix path only to avoid long, confusing timeout loops after successful deploy.
      return;
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [runAutoFix, activeTab, currentAppEditable, autoFixAutoEnabled]);

  const buildPlanAndQuestions = async (appId: number, text: string) => {
    const fallbackSteps = [
      `要件を分解: 「${text.slice(0, 40)}」の主要機能を抽出`,
      '画面構成を設計: 一覧 / 詳細 / 操作フローを定義',
      'データモデルを設計: 必要な項目・状態・APIを整理',
      'MVPを実装: 先に使える最小機能を生成',
      '動作検証と自動修正: エラーを検知して修復',
    ];
    const fallbackQs = [
      { id: 'layout', title: 'レイアウトの好み', options: ['シンプル', 'カード中心', 'ダッシュボード'] },
      { id: 'density', title: '情報量', options: ['少なめ', '標準', '多め'] },
      { id: 'tone', title: 'デザイン雰囲気', options: ['ビジネス', 'モダン', '親しみやすい'] },
    ];

    let steps = fallbackSteps;
    let qs = fallbackQs;
    try {
      const r = await api.generatePlan(text);
      if (r?.steps?.length) steps = r.steps;
      if (r?.questionnaire?.length) qs = r.questionnaire;
    } catch {
      // fallback silently
    }

    setPlanSteps(steps);
    setQuestionnaire(qs);

    // planning content is shown in the confirmation card UI (not as a separate chat paragraph)
  };

  const createNewApp = useCallback(async (prompt?: string) => {
    try {
      const app = await api.createApp({ name: '新規アプリ', icon: '✨' });
      setCurrentApp(app);
      setMessages([]);
      setVersions([]);
      setSelectedVersionId(null);
      setPreviewPort(null);
      setPreviewUrl(null);
      setStreamingContent('');
      setFixStreamingContent('');
      setSelectedStoreApp(null);
      setStoreInput('');
      setAppErrors([]);
      setAutoFixCount(0);
      setPreviewTab('preview');
      setActiveTab("workspace");
      if (prompt) setTimeout(() => sendMessage(app.id, prompt), 80);
    } catch (e) {
      alert('サーバーに接続できません。バックエンド (port 3100) が起動しているか確認してください。\n\nターミナルで: node server/index.js');
    }
  }, []);

  const stopStreaming = useCallback((silent = false) => {
    if (streamAbortRef.current) {
      streamAbortRef.current();
      streamAbortRef.current = null;
    }
    if (!silent && isStreaming) {
      setMessages(prev => [...prev, {
        id: Date.now() + 2,
        app_id: currentApp?.id || 0,
        role: 'assistant',
        content: '⏹️ 生成を停止しました。',
        created_at: new Date().toISOString(),
      }]);
    }
    setIsStreaming(false);
    setStreamingContent('');
  }, [isStreaming, currentApp]);

  const sendMessage = useCallback(async (appId: number, text: string) => {
    if (!text.trim() || isStreaming || autoFixing) return;
    // Permission model:
    // - registered owner can edit
    // - guests are allowed to generate from homepage flow
    // - registered non-owners cannot edit others' apps
    const guestHomepageFlow = !user;
    const guestFirstGenerate = canGuestGenerateFirstApp(currentApp, user, versions, messages);
    const isFreshApp = (versions?.length || 0) === 0 && (messages?.length || 0) === 0;
    const allowed = currentAppEditable || guestHomepageFlow || guestFirstGenerate || isFreshApp;
    if (!allowed) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        app_id: appId,
        role: 'assistant',
        content: 'この App は編集権限がありません。ストアで「自分用に編集」を使ってください。',
        created_at: new Date().toISOString(),
      }]);
      return;
    }
    const trimmed = text.trim();
    setPreviewTab('preview');

    // For bug-fix intent, skip confirmation card and start fixing immediately
    if (isFixIntent(trimmed)) {
      setPendingGeneration(null);
      setInputText('');
      startGeneration(appId, trimmed);
      return;
    }

    setPendingGeneration({ appId, text: trimmed });
    setInputText('');
    setShowExtraRequirement(false);
    setExtraRequirement('');
    setPlanning(true);
    try {
      await buildPlanAndQuestions(appId, trimmed);
    } finally {
      setPlanning(false);
    }
  }, [isStreaming, autoFixing, currentAppEditable, currentApp, user, versions, messages]);

  const startGeneration = useCallback(async (appId: number, text: string) => {
    if (!text.trim() || isStreaming || autoFixing) return;
    const selected = questionnaire.filter(q => q.answer).map(q => ({ title: q.title, answer: q.answer! }));
    const qa = selected.map(q => `- ${q.title}: ${q.answer}`).join('\n');
    const pattern = DESIGN_PATTERNS.find(p => p && p.id === designPatternId) || DESIGN_PATTERNS[0];

    const specBlock = [
      '[APP_DEFINITION]',
      `- Core objective: ${text.trim()}`,
      `- Target users: 店舗スタッフ / マネージャー / オーナー（必要に応じて最適化）`,
      `- UX quality bar: production-ready, clear empty/loading/error states`,
      `- UI density rule (strict): no oversized UI; title <= text-2xl, body text-sm, helper text-xs, button height h-9/h-8, input height h-9`,
      `- Polish rule: premium and refined, avoid cheap-looking giant cards/paddings`,
      `- Design paradigm: ${pattern.label}`,
      `- Design guide: ${pattern.guide}`,
      `- Design recipe (must implement): ${pattern.recipe}`,
      `- Design tokens must include: ${(pattern.tokens || []).join(' | ')}`,
      `- Color policy: ${pattern.id === 'glass' ? 'allow cool gradients' : 'avoid indigo/purple/fuchsia unless user explicitly requests'}`,
      '- Design skeleton policy: must keep the same top-level section structure and only replace placeholder blocks with business content.',
      '[Design skeleton JSX - must implement structure]',
      pattern.skeleton,
      '- Required deliverables: complete frontend + complete backend routes + sql when needed',
      '- Acceptance checklist:',
      '  1) All frontend /api requests must have matching backend routes',
      '  2) Main flow can run without mock-only blockers',
      '  3) KPI/data cards, filter flow, and primary actions are complete',
      '  4) Handle no-data / loading / backend-error states gracefully',
      qa ? `[Selected conditions]\n${qa}` : '',
    ].filter(Boolean).join('\n');

    const enriched = `${text.trim()}\n\n${specBlock}`;

    const now = Date.now();
    const userMsg: Message = {
      id: now,
      app_id: appId,
      role: 'user',
      content: `${REQ_CARD_PREFIX}${JSON.stringify({ text: text.trim(), answers: selected })}`,
      created_at: new Date().toISOString(),
    };

    const pmMsgId = now + 11;
    const uiMsgId = now + 12;
    const devMsgId = now + 13;
    const qaMsgId = now + 14;
    const deployMsgId = now + 15;

    const updateStage = (id: number, content: string) => {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, content } : m));
    };

    setMessages(prev => [
      ...prev,
      userMsg,
      { id: pmMsgId, app_id: appId, role: 'assistant', content: '👩‍💼 产品经理策划中…（需求拆解 / 业务流程定义）', created_at: new Date().toISOString() },
    ]);

    setPendingGeneration(null);
    setIsStreaming(true);
    setStreamingContent('');

    try {
      const pm = await api.generatePlan(text.trim());
      const pmLines = (pm.steps || []).slice(0, 8).map((s, i) => `${i + 1}. ${s}`).join('\n');
      updateStage(pmMsgId, `👩‍💼 产品经理策划完成：\n${pmLines || '（已完成需求拆解）'}`);
      if (Array.isArray(pm.questionnaire) && pm.questionnaire.length) {
        setQuestionnaire(pm.questionnaire as any);
      }
    } catch (e: any) {
      updateStage(pmMsgId, `👩‍💼 产品经理策划完成（降级）：使用默认策划流程\n原因: ${e?.message || 'unknown'}`);
    }

    setMessages(prev => [...prev, { id: uiMsgId, app_id: appId, role: 'assistant', content: `🎨 UI设计师设计中…（设计范式：${pattern.label}）`, created_at: new Date().toISOString() }]);

    try {
      const brief = await api.generateDesignBrief(text.trim(), pattern.label);
      const guide = (brief.styleGuide || []).slice(0, 6).map((s: string) => `• ${s}`).join('\n');
      const checklist = (brief.uiChecklist || []).slice(0, 5).map((s: string) => `- ${s}`).join('\n');
      updateStage(uiMsgId, `🎨 UI设计师设计完成（${pattern.label}）：\n概念：${brief.concept || '已确定'}\n${guide}${checklist ? `\n\nUI检查清单\n${checklist}` : ''}`);
    } catch (e: any) {
      updateStage(uiMsgId, `🎨 UI设计师设计完成（降级）：使用范式默认骨架（${pattern.label})`);
    }

    setMessages(prev => [...prev, { id: devMsgId, app_id: appId, role: 'assistant', content: '🧑‍💻 前端/后端工程师开发中…（代码生成进行中）', created_at: new Date().toISOString() }]);

    const abort = api.chat(appId, enriched, { 
      onDelta: d => {
        setStreamingContent(p => p + d);
        updateStage(devMsgId, '🧑‍💻 前端/后端工程师开发中…（正在生成与联调代码）');
      },
      onCode: (_code, versionId, versionNumber, port, _apiPort, _hasBackend, _hasDb, previewSlug, previewPath) => {
        setPreviewPort(port ?? null);
        if (previewSlug) setPreviewUrl(`${window.location.protocol}//${window.location.host}/app/${previewSlug}/`);
        else if (previewPath) setPreviewUrl(`${window.location.protocol}//${window.location.host}${previewPath}`);
        setPreviewRefreshKey(k => k + 1);
        setSelectedVersionId(versionId);
        const v: AppVersion = { id: versionId, app_id: appId, version_number: versionNumber, label: null, code: _code, created_at: new Date().toISOString() };
        setVersions(prev => [v, ...prev.filter(x => x.id !== versionId)]);
      },
      onDone: async () => {
        streamAbortRef.current = null;
        const full = streamingRef.current;
        setIsStreaming(false);
        setStreamingContent('');

        const qaProgressId = qaMsgId;
        const qaUpdate = (content: string) => setMessages(prev => prev.map(m => m.id === qaProgressId ? { ...m, content } : m));

        setMessages(prev => [...prev, { id: qaProgressId, app_id: appId, role: 'assistant', content: '🧪 测试工程师测试中…\n- [ ] 唤醒运行环境\n- [ ] 预览页面可达性\n- [ ] 核心API冒烟\n- [ ] 结果汇总', created_at: new Date().toISOString() }]);

        let qaPassed = false;
        let qaSummary = '';
        try {
          qaUpdate('🧪 测试工程师测试中…\n- [x] 唤醒运行环境\n- [ ] 预览页面可达性\n- [ ] 核心API冒烟\n- [ ] 结果汇总');
          const qa = await api.qaCheck(appId);
          qaPassed = !!qa.passed;
          const details = (qa.checks || []).map(c => `${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('\n');
          qaSummary = `🧪 测试工程师测试完成：${qa.passed ? '通过' : '未通过'}\n${details}`;
          qaUpdate(`🧪 测试工程师测试中…\n- [x] 唤醒运行环境\n- [x] 预览页面可达性\n- [x] 核心API冒烟\n- [x] 结果汇总`);
        } catch (e: any) {
          qaSummary = `🧪 测试工程师测试失败：${e?.message || 'unknown'}`;
          qaUpdate('🧪 测试工程师测试中…\n- [x] 唤醒运行环境\n- [ ] 预览页面可达性\n- [ ] 核心API冒烟\n- [x] 结果汇总（失败）');
        }

        const deployText = qaPassed
          ? '🚀 服务器工程师部署中…\n- [x] QA结果确认\n- [ ] 发布预览容器\n- [ ] 部署后健康检查'
          : '⛔ 服务器工程师已阻止部署（QA未通过，请先修复）';

        setMessages(prev => [...prev,
          { id: Date.now() + 1, app_id: appId, role: 'assistant', content: full, created_at: new Date().toISOString() },
          { id: Date.now() + 2, app_id: appId, role: 'assistant', content: qaSummary, created_at: new Date().toISOString() },
          { id: deployMsgId, app_id: appId, role: 'assistant', content: deployText, created_at: new Date().toISOString() }
        ]);

        if (qaPassed) {
          setMessages(prev => prev.map(m => m.id === deployMsgId ? {
            ...m,
            content: '🚀 服务器工程师部署完成\n- [x] QA结果确认\n- [x] 发布预览容器\n- [x] 部署后健康检查'
          } : m));
          setMessages(prev => [...prev, { id: Date.now() + 3, app_id: appId, role: 'assistant', content: '✅ 团队协作完成：已通过测试并可体验。', created_at: new Date().toISOString() }]);
        } else {
          setMessages(prev => [...prev, { id: Date.now() + 3, app_id: appId, role: 'assistant', content: '⚠️ 当前版本未通过测试，已阻止部署。请继续修复后再发布。', created_at: new Date().toISOString() }]);
        }

        try {
          const d = await api.getApp(appId);
          setCurrentApp(d);
          if (d.preview_port !== undefined) {
            setPreviewPort(d.preview_port ?? null);
            setPreviewUrl(getPreviewUrl(d));
            setPreviewRefreshKey(k => k + 1);
          }
          if (d.versions) setVersions(sortVersionsByEditedTime(d.versions));
          fetchApps();
        } catch (e) {
          console.error('refresh app failed:', e);
          // keep current editor state instead of dropping back
        }
      },
      onError: msg => {
        streamAbortRef.current = null;
        setIsStreaming(false);
        setStreamingContent('');
        setMessages(prev => [...prev, { id: Date.now() + 1, app_id: appId, role: 'assistant', content: `⚠️ エラー: ${msg}`, created_at: new Date().toISOString() }]);
      },
    }, userMsg.content);

    streamAbortRef.current = abort;
  }, [isStreaming, autoFixing, fetchApps, questionnaire, designPatternId]);

  const handleMouseDown = () => {
    const move = (e: MouseEvent) => {
      const w = window.innerWidth - e.clientX;
      if (w >= 300 && w <= window.innerWidth - 350) setPreviewWidth(w);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  const openLoginGate = (action = 'この操作') => {
    setLoginGateAction(action);
    setLoginGateOpen(true);
  };

  const requireLogin = (action = 'この操作') => {
    if (user) return true;
    openLoginGate(action);
    return false;
  };

  const consumeGuestTrial = () => {
    if (user) return true;
    if (guestTrialCount >= 10) {
      openLoginGate('無料試用の上限（10回）');
      return false;
    }
    const next = guestTrialCount + 1;
    setGuestTrialCount(next);
    localStorage.setItem('funfo_guest_trial_count', String(next));
    return true;
  };

  const requireLoginForFullscreen = () => {
    if (user) return true;
    openLoginGate('フルスクリーン実行');
    return false;
  };

  const cloneAndEdit = async (id: number) => {
    if (!requireLogin('アプリの編集')) return;
    const cloned = await api.cloneApp(id);
    await fetchApps();
    await openApp(cloned.id);
  };

  const toggleFavorite = async (app: App) => {
    if (!requireLogin('お気に入り')) return;
    if (app.is_favorite) await api.unfavoriteApp(app.id);
    else await api.favoriteApp(app.id);
    await fetchApps();
  };

  const changeTab = (tab: TabType) => {
    if (isStreaming && tab !== 'workspace') stopStreaming();
    setActiveTab(tab);
    if (tab === 'myapps') fetchApps();
  };

  useEffect(() => {
    const onBeforeUnload = () => {
      if (streamAbortRef.current) streamAbortRef.current();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (streamAbortRef.current) streamAbortRef.current();
    };
  }, []);

  const deleteApp = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('このアプリを削除しますか？')) return;
    await api.deleteApp(id);
    fetchApps();
    if (currentApp?.id === id) setCurrentApp(null);
  };

  const handlePublishConfirm = async (name: string, description: string, icon: string, color: string) => {
    if (!currentApp) return;
    const updated = await api.updateApp(currentApp.id, { name, description, icon, color });
    setCurrentApp({ ...updated, preview_port: previewPort, preview_url: previewUrl });
    fetchApps();
    setPublishOpen(false);
  };

  const restartAppBackend = async () => {
    if (!currentApp?.id || !currentAppEditable || restartingBackend) return;
    setRestartingBackend(true);
    try {
      const r = await api.restartBackend(currentApp.id);
      if (r.apiPort !== undefined) setBackendStatus({ running: !!r.apiPort, reachable: !!r.apiPort, apiPort: r.apiPort ?? null });
      if (r.previewPort !== undefined) {
        setPreviewPort(r.previewPort ?? null);
        if (r.previewSlug) setPreviewUrl(`${window.location.protocol}//${window.location.host}/app/${r.previewSlug}/`);
        else if (r.previewPath) setPreviewUrl(`${window.location.protocol}//${window.location.host}${r.previewPath}`);
        setPreviewRefreshKey(k => k + 1);
      }
      setMessages(prev => [...prev, {
        id: Date.now(),
        app_id: currentApp.id,
        role: 'assistant',
        content: '🛠️ バックエンド/プレビューを再起動しました。',
        created_at: new Date().toISOString(),
      }]);
    } catch (e: any) {
      setMessages(prev => [...prev, {
        id: Date.now(),
        app_id: currentApp.id,
        role: 'assistant',
        content: `⚠️ バックエンド再起動失敗: ${e?.message || e}`,
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setRestartingBackend(false);
    }
  };

  const submitForReview = async () => {
    if (!currentApp) return;
    if (currentApp.status === 'published') {
      alert('このアプリはすでに公開済みです');
      return;
    }
    if (currentApp.status === 'private') {
      alert('このアプリはすでに提審中です（管理側の審査待ち）');
      return;
    }
    const ok = !!currentApp.name?.trim() && !!currentApp.icon?.trim() && !!currentApp.description?.trim();
    if (!ok) {
      alert('先に属性を編集してください（名前・アイコン・説明は必須）');
      return;
    }
    try {
      const updated = await api.updateApp(currentApp.id, { status: 'private' });
      setCurrentApp({ ...updated, preview_port: previewPort, preview_url: previewUrl });
      fetchApps();
      alert('提審しました。管理側の審査をお待ちください。');
    } catch (e: any) {
      alert(e?.message || '提审失败（请确认当前账号有编辑权限）');
    }
  };

  const saveProfile = async () => {
    try {
      setProfileError('');
      setProfileMessage('');
      const updated = await api.updateProfile({ nickname: profileNick, avatar_url: profileAvatar });
      setUser(updated);
      setProfileMessage('プロフィールを更新しました');
    } catch (e: any) {
      setProfileError(e?.message || 'プロフィール更新に失敗しました');
    }
  };

  const savePassword = async () => {
    try {
      setProfileError('');
      setProfileMessage('');
      await api.changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setProfileMessage('パスワードを変更しました');
    } catch (e: any) {
      setProfileError(e?.message || 'パスワード変更に失敗しました');
    }
  };

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">

      {/* ── Header ── */}
      <header className="border-b bg-white sticky top-0 z-50">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white">
                <Sparkles className="w-5 h-5" />
              </div>
              <span className="font-bold text-xl">funfo AI</span>
            </div>
            <nav className="flex items-center gap-1">
              {[
                { id: 'store', icon: Sparkles, label: t('createApp'), auth: false },
                { id: 'market', icon: StoreIcon, label: t('appStore'), auth: false },
                { id: 'workspace', icon: Sparkles, label: t('workspace'), auth: true },
                { id: 'myapps', icon: Folder, label: t('myApps'), auth: true },
              ]
                .filter(t => !t.auth || !!user)
                .map(({ id, icon: Icon, label }) => (
                <Button key={id}
                  variant={activeTab === id ? "default" : "ghost"}
                  onClick={() => changeTab(id as TabType)}
                  className="gap-2">
                  <Icon className="w-4 h-4" /> {label}
                </Button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={lang}
              onChange={e => { const v = e.target.value as AppLang; setLangState(v); setLang(v); }}
              className="h-8 text-xs border border-slate-200 rounded-md px-2 bg-white"
              title="Language"
            >
              <option value="ja">日本語</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
            <Button variant="ghost" size="sm"><FileText className="w-4 h-4 mr-2" />{t('docs')}</Button>
            {user ? (
              <div className="relative" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setUserMenuOpen(v => !v)}
                  className="w-9 h-9 rounded-full bg-slate-300 text-slate-700 text-sm font-semibold flex items-center justify-center overflow-hidden border border-slate-200"
                  title={user.nickname}
                >
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt={user.nickname} className="w-full h-full object-cover" />
                  ) : (
                    (user.nickname || 'U').slice(0, 1).toUpperCase()
                  )}
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-44 rounded-xl border bg-white shadow-lg z-50 p-1">
                    <button
                      className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50"
                      onClick={() => { setActiveTab('profile'); setUserMenuOpen(false); }}
                    >
                      {t('myPage')}
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50 text-red-600"
                      onClick={async () => {
                        await api.logout().catch(() => {});
                        localStorage.removeItem('funfo_token');
                        setUser(null);
                        setCurrentApp(null);
                        setActiveTab('store');
                        setUserMenuOpen(false);
                        fetchApps();
                      }}
                    >
                      {t('logout')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Button size="sm" onClick={() => navigate(buildLoginUrl())}>{t('loginRegister')}</Button>
            )}
          </div>
        </div>
      </header>

      <main className="h-[calc(100vh-73px)]">

        {/* ═══ WORKSPACE ═══════════════════════════════════════════ */}
        {activeTab === "workspace" && (
          !currentApp ? (
            <div className="h-full overflow-y-auto bg-gradient-to-br from-slate-50/50 via-white to-blue-50/30">
              <div className="max-w-7xl mx-auto px-6 py-16">
                <div className="flex items-center justify-between mb-12">
                  <div>
                    <h1 className="text-4xl font-bold mb-3">ワークスペース</h1>
                    <p className="text-muted-foreground">あなたのアプリを管理・編集</p>
                  </div>
                  <Button size="lg" className="gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
                    onClick={() => createNewApp()}>
                    <Plus className="w-5 h-5" /> 新規アプリ作成
                  </Button>
                </div>

                {appsLoading ? (
                  <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
                ) : editableApps.length === 0 ? (
                  <div className="text-center py-24 text-muted-foreground">
                    <div className="text-6xl mb-4">✨</div>
                    <p className="text-lg font-medium mb-2">編集できるアプリがありません</p>
                    <p className="text-sm mb-6">{user ? 'ストアで「自分用に編集」して追加してください' : 'ゲストはストアで生成・試用できます。編集はログイン後に可能です'}</p>
                    <Button onClick={() => user ? setActiveTab('market') : navigate(buildLoginUrl())}>{user ? t('appStore') : t('loginRegister')}</Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {editableApps.map(app => (
                      <Card key={app.id}
                        className="group hover:shadow-xl hover:-translate-y-2 transition-all duration-300 border bg-white relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-purple-500/0 group-hover:from-blue-500/5 group-hover:to-purple-500/5 transition-all duration-300" />
                        <CardContent className="p-6 relative">
                          <div className="flex items-start gap-4 mb-6">
                            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shrink-0 shadow-sm group-hover:scale-110 transition-transform duration-300"
                              style={app.color ? appIconStyle(app.color) : undefined}>
                              {app.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-bold text-xl mb-2 group-hover:text-primary transition-colors truncate">{app.name}</h3>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span>v{app.current_version}</span>
                                <span>·</span>
                                <span>{new Date(app.updated_at).toLocaleDateString('ja-JP')}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mb-6">
                            <Badge variant={app.status === 'published' ? 'default' : 'secondary'}
                              className={cn(
                                app.status === 'published'
                                  ? "bg-green-100 text-green-700 border-green-200"
                                  : app.status === 'private'
                                  ? "bg-blue-100 text-blue-700 border-blue-200"
                                  : "bg-yellow-100 text-yellow-700 border-yellow-200"
                              )}>
                              {app.status === 'published' ? `● ${t('published')}` : app.status === 'private' ? `● ${t('private')}` : `● ${t('draft')}`}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            {getPreviewUrl(app) && (
                              <Button size="sm" className="flex-1 gap-1 bg-indigo-600 hover:bg-indigo-700"
                                onClick={e => {
                                  e.stopPropagation();
                                  const u = getPreviewUrl(app);
                                  if (u) window.open(u, '_blank');
                                }}>
                                <ArrowUp className="w-3 h-3 rotate-45" /> 使用
                              </Button>
                            )}
                            <Button size="sm" variant="outline" className={cn("gap-1", !getPreviewUrl(app) && "flex-1")}
                              disabled={!canEditApp(app as any, user)}
                              title={!canEditApp(app as any, user) ? '編集権限がありません（先に「自分用に編集」）' : undefined}
                              onClick={e => { e.stopPropagation(); openApp(app.id); }}>
                              <Edit3 className="w-3 h-3" /> 編集
                            </Button>
                            <Button size="sm" variant="ghost" onClick={e => deleteApp(app.id, e)}>
                              <Trash2 className="w-4 h-4 text-red-400" />
                            </Button>
                          </div>
                        </CardContent>
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
                      </Card>
                    ))}
                    <Card className="border-2 border-dashed border-muted hover:border-primary/50 bg-white hover:bg-slate-50 transition-all cursor-pointer flex items-center justify-center min-h-[280px]"
                      onClick={() => createNewApp()}>
                      <CardContent className="p-6 text-center">
                        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                          <Plus className="w-8 h-8 text-primary" />
                        </div>
                        <p className="text-muted-foreground font-medium">新規アプリを作成</p>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Editor */
            <div className="h-full flex flex-col">
              {/* Version bar */}
              <div className="border-b bg-white px-6 py-3 flex items-center gap-3 overflow-x-auto shrink-0">
                <Button size="sm" variant="ghost" className="shrink-0" onClick={() => {
                  if (isStreaming) stopStreaming();
                  setCurrentApp(null);
                  setActiveTab('store');
                }}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> 戻る
                </Button>
                <div className="h-4 w-px bg-border mx-2" />
                <span className="text-sm font-semibold text-muted-foreground shrink-0">編集履歴:</span>
                {versions.length === 0
                  ? <span className="text-xs text-muted-foreground italic">まだ生成されていません</span>
                  : versions.map(v => (
                    <div key={v.id} onClick={() => setSelectedVersionId(v.id)}
                      className={cn(
                        "px-4 py-2 rounded-lg cursor-pointer transition-all shrink-0",
                        selectedVersionId === v.id ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted hover:bg-muted/70"
                      )}>
                      <span className="text-sm font-medium whitespace-nowrap">{formatEditedTime(v.created_at)}</span>
                    </div>
                  ))
                }
              </div>

              {/* Chat + Preview */}
              <div className="flex-1 flex overflow-hidden">

                {/* Left: Chat */}
                <div className="flex flex-col bg-white border-r" style={{ width: `calc(100% - ${previewWidth}px)` }}>
                  {/* Chat header */}
                  <div className="border-b px-6 py-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-2xl">{currentApp.icon}</div>
                      <div>
                        <h2 className="font-semibold">{currentApp.name}</h2>
                        <div className="flex items-center gap-2 mt-1">
                          {isStreaming
                            ? <>
                                <span className="flex h-2 w-2">
                                  <span className="animate-ping absolute h-2 w-2 rounded-full bg-green-400 opacity-75" />
                                  <span className="relative rounded-full h-2 w-2 bg-green-500" />
                                </span>
                                <span className="text-xs text-muted-foreground">生成中...</span>
                              </>
                            : previewUrl
                              ? <span className="text-xs text-muted-foreground">実行中 · {previewUrl}</span>
                              : <span className="text-xs text-muted-foreground">編集中</span>
                          }
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {currentAppEditable && (
                        <div className={cn(
                          "text-[11px] px-2 py-1 rounded border flex items-center gap-1.5",
                          backendStatus?.reachable ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
                        )} title={backendStatus?.apiPort ? `api:${backendStatus.apiPort}` : 'no api'}>
                          <span className={cn("w-2 h-2 rounded-full", backendStatus?.reachable ? "bg-emerald-500" : "bg-red-500")} />
                          {backendStatus?.reachable ? t('backendOk') : t('backendNg')}
                        </div>
                      )}
                      {currentAppEditable && (
                        <Button size="sm" variant="outline" className="gap-1" disabled={restartingBackend} onClick={restartAppBackend}>
                          <RotateCw className={cn("w-3.5 h-3.5", restartingBackend && "animate-spin")} />
                          {t('restartBackend')}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost"><Share2 className="w-4 h-4" /></Button>
                      <Button size="sm" variant="outline" className="gap-1"
                        disabled={!currentAppEditable}
                        title={!currentAppEditable ? '編集権限がありません' : '属性（アイコン・色・名前・説明）を編集'}
                        onClick={() => { if (currentAppEditable) setPublishOpen(true); }}>
                        <Edit3 className="w-4 h-4" /> {t('editProps')}
                      </Button>
                      <Button size="sm"
                        disabled={!canSubmitReview}
                        title={!user ? '先にログインしてください' : currentApp.status === 'private' ? 'このアプリはすでに提審中です' : currentApp.status === 'published' ? 'このアプリは公開済みです' : !canSubmitReview ? '属性を先に編集してください（名前・アイコン・説明）' : undefined}
                        className={cn(
                          "gap-1",
                          currentApp.status === 'published' ? 'bg-green-600 hover:bg-green-600' : currentApp.status === 'private' ? 'bg-slate-400 hover:bg-slate-400' : 'bg-amber-500 hover:bg-amber-500',
                          !canSubmitReview && "bg-slate-300 hover:bg-slate-300 text-slate-500 cursor-not-allowed"
                        )}
                        onClick={submitForReview}>
                        <Rocket className="w-4 h-4" />
                        {currentApp.status === 'published' ? t('published') : currentApp.status === 'private' ? '審査中' : t('submitReview')}
                        {currentApp.status !== 'published' && <ArrowUp className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {messages.length === 0 && !isStreaming && !planning && (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold shrink-0 text-xs">AI</div>
                        <Card className="bg-muted/50 max-w-2xl">
                          <CardContent className="p-4 text-sm text-slate-600">
                            {t('msgInput')}
                          </CardContent>
                        </Card>
                      </div>
                    )}

                    {messages.map(msg => (
                      <div key={msg.id} className={cn("flex gap-3", msg.role === 'user' && "justify-end")}>
                        {msg.role === 'assistant' && (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold shrink-0 text-xs">AI</div>
                        )}
                        <div className={cn(
                          "max-w-2xl",
                          msg.role === 'user' && !parseReqCard(msg.content)
                            ? "bg-primary text-primary-foreground rounded-2xl px-4 py-3 text-sm"
                            : ""
                        )}>
                          {(() => {
                            const card = parseReqCard(msg.content);
                            if (card) {
                              return (
                                <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50 to-white shadow-sm">
                                  <CardContent className="p-3 space-y-2">
                                    <div className="flex items-center gap-2 text-indigo-700 text-xs font-semibold">
                                      <Sparkles className="w-3.5 h-3.5" /> 需求已接收
                                    </div>
                                    <p className="text-sm text-slate-800">{card.text}</p>
                                    {card.answers?.length > 0 && (
                                      <details className="group">
                                        <summary className="text-[11px] text-indigo-700 cursor-pointer list-none select-none inline-flex items-center gap-1">
                                          <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" />
                                          条件を表示 / 非表示
                                        </summary>
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                          {card.answers.map((a, i) => (
                                            <span key={i} className="px-2 py-1 rounded-md text-[11px] bg-white border text-slate-700">
                                              {a.title}: <b>{a.answer}</b>
                                            </span>
                                          ))}
                                        </div>
                                      </details>
                                    )}
                                  </CardContent>
                                </Card>
                              );
                            }
                            if (msg.role === 'user') return <p className="leading-relaxed">{msg.content}</p>;
                            return <AssistantMessage content={msg.content} />;
                          })()}
                        </div>
                      </div>
                    ))}

                    {autoFixing && (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white shrink-0">
                          <RotateCw className="w-4 h-4 animate-spin" />
                        </div>
                        <Card className="max-w-2xl border-indigo-200 bg-indigo-50/60">
                          <CardContent className="p-3">
                            <p className="text-xs font-semibold text-indigo-700">funfo AI</p>
                            <p className="text-sm text-slate-700">エラーを解析中...（backend 状態確認 → 必要なら再起動 → AI修復）</p>
                          </CardContent>
                        </Card>
                      </div>
                    )}

                    {planning && (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold shrink-0 text-xs">
                          AI
                        </div>
                        <Card className="max-w-2xl border-indigo-200 bg-indigo-50/60">
                          <CardContent className="p-3 flex items-center gap-3">
                            <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center text-white">
                              <Sparkles className="w-4 h-4 animate-spin" />
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-indigo-700">funfo AI</p>
                              <p className="text-sm text-slate-700">AI正在分析需求，请等待...</p>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    )}

                    {pendingGeneration && !planning && (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold shrink-0 text-xs">AI</div>
                        <Card className="max-w-2xl w-full border-indigo-200 bg-indigo-50/40">
                          <CardContent className="p-3 space-y-3">
                            <div>
                              <p className="text-xs text-slate-500 mb-1">開発ステップ</p>
                              <ol className="text-xs list-decimal list-inside space-y-1 text-slate-700">
                                {planSteps.map((s, i) => <li key={i}>{s}</li>)}
                              </ol>
                            </div>
                            <div>
                              <p className="text-xs text-slate-500 mb-1">生成要求（選択式）</p>
                              <div className="space-y-2">
                                {questionnaire.map(q => (
                                  <div key={q.id}>
                                    <p className="text-xs font-medium text-slate-700 mb-1">{q.title}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {q.options.map(op => (
                                        <button
                                          key={op}
                                          onClick={() => setQuestionnaire(prev => prev.map(x => x.id === q.id ? { ...x, answer: op } : x))}
                                          className={cn(
                                            'px-2.5 py-1 rounded-md text-[11px] border transition',
                                            q.answer === op
                                              ? 'bg-indigo-600 text-white border-indigo-600'
                                              : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-300'
                                          )}
                                        >{op}</button>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <Button size="sm" variant="outline" onClick={() => setShowExtraRequirement(v => !v)}>
                                <Plus className="w-3.5 h-3.5 mr-1" /> 追加要望
                              </Button>
                              <span className="text-[11px] text-slate-500">任意入力</span>
                            </div>
                            {showExtraRequirement && (
                              <textarea
                                value={extraRequirement}
                                onChange={e => setExtraRequirement(e.target.value)}
                                className="w-full min-h-[70px] px-3 py-2 text-xs border rounded-lg bg-white"
                                placeholder="追加したい要望があれば入力してください（任意）"
                              />
                            )}

                            <div className="flex items-center gap-2 flex-wrap">
                              <Button
                                size="sm"
                                className="gap-1"
                                disabled={questionnaire.some(q => !q.answer)}
                                onClick={() => {
                                  const text = extraRequirement.trim()
                                    ? `${pendingGeneration.text}\n\n[追加要望]\n${extraRequirement.trim()}`
                                    : pendingGeneration.text;
                                  startGeneration(pendingGeneration.appId, text);
                                }}
                              >
                                <Sparkles className="w-3 h-3" /> 生成を開始
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  // Skip questionnaire and proceed with AI best-practice defaults.
                                  const text = extraRequirement.trim()
                                    ? `${pendingGeneration.text}\n\n[追加要望]\n${extraRequirement.trim()}\n\n[実行モード]\n直接開発（AI最適プラン）`
                                    : `${pendingGeneration.text}\n\n[実行モード]\n直接開発（AI最適プラン）`;
                                  startGeneration(pendingGeneration.appId, text);
                                }}
                              >
                                直接进行开发
                              </Button>
                              <span className="text-xs text-amber-600">{questionnaire.some(q => !q.answer) ? '未選択でも「直接进行开发」で開始できます' : '準備完了。開始できます'}</span>
                            </div>

                            <div className="flex items-center gap-2 pt-1 border-t">
                              <span className="text-xs text-slate-500">{t('designPattern')}</span>
                              <select
                                value={designPatternId}
                                onChange={e => setDesignPatternId(e.target.value)}
                                className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white"
                              >
                                {DESIGN_PATTERNS.map(p => (
                                  <option key={p.id} value={p.id}>{p.label}</option>
                                ))}
                              </select>
                              <span className="text-[11px] text-slate-400 truncate">{(DESIGN_PATTERNS.find(p => p && p.id === designPatternId) || DESIGN_PATTERNS[0]).guide}</span>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    )}

                    {isStreaming && (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold shrink-0 text-xs">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        </div>
                        <div className="max-w-2xl">
                          {streamingContent ? (
                            // Show only non-code text while streaming (code goes to right panel)
                            <div className="text-sm text-slate-700 space-y-2">
                              {streamingContent
                                .split(/```[\s\S]*?(?:```|$)/)[0]
                                .trim() && (
                                <p className="whitespace-pre-wrap leading-relaxed">
                                  {streamingContent.split(/```[\s\S]*?(?:```|$)/)[0].trim()}
                                </p>
                              )}
                              {streamingContent.includes('```') && (
                                <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 rounded-lg">
                                  {[0,1,2].map(i => (
                                    <span key={i} className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: `${i*0.12}s` }} />
                                  ))}
                                  <span className="text-xs font-mono text-emerald-400">右のエディタでコード生成中...</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                              {[0,1,2].map(i => (
                                <span key={i} className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div ref={chatEndRef} />
                  </div>

                  {/* Input */}
                  <div className="border-t p-4 shrink-0 space-y-3">
                    <div className="flex items-end gap-2">
                      <div className="flex-1 relative">
                        <textarea
                          value={inputText}
                          onChange={e => setInputText(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && inputText.trim() && !pendingGeneration && !planning) {
                              sendMessage(currentApp.id, inputText);
                            }
                          }}
                          placeholder={t('msgInput')}
                          disabled={isStreaming || autoFixing || !!pendingGeneration || planning}
                          className="w-full min-h-[88px] px-4 py-3 border-2 border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-300 text-sm disabled:opacity-50 bg-gradient-to-b from-white to-slate-50/60 shadow-[inset_0_1px_0_rgba(255,255,255,.6)]"
                        />
                        <p className="text-xs text-muted-foreground mt-2">{t('sendHint')}</p>
                      </div>
                      <Button size="icon" onClick={() => sendMessage(currentApp.id, inputText)} disabled={isStreaming || autoFixing || planning || !!pendingGeneration || !inputText.trim()} className="shrink-0">
                        {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Resize handle */}
                <div className="w-1.5 bg-border hover:bg-primary cursor-ew-resize transition-colors relative group shrink-0" onMouseDown={handleMouseDown}>
                  <div className="absolute inset-y-0 -left-2 -right-2 flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-muted rounded-full p-1">
                      <GripVertical className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                </div>

                {/* Right: Preview / Live Code Editor */}
                <div className="flex flex-col shrink-0 overflow-hidden" style={{ width: `${previewWidth}px` }}>
                  {/* Toolbar */}
                  <div className={cn(
                    "border-b px-3 py-1.5 shrink-0 flex items-center justify-between transition-colors",
                    (isStreaming || autoFixing) ? "bg-[#161b22]" : "bg-white"
                  )}>
                    <div className="flex items-center gap-1">
                      {(isStreaming || autoFixing) ? (
                        <span className="text-xs font-mono text-slate-400 px-2 py-1">{autoFixing ? 'AUTO-FIX' : 'EDITOR'}</span>
                      ) : (
                        <>
                          <button
                            onClick={() => setPreviewTab('preview')}
                            className={cn("text-xs px-3 py-1.5 rounded-md font-medium transition-colors",
                              previewTab === 'preview' ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-700")}>
                            プレビュー
                          </button>
                          <button
                            onClick={() => setPreviewTab('fix')}
                            className={cn("text-xs px-3 py-1.5 rounded-md font-medium transition-colors",
                              previewTab === 'fix' ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:text-slate-700")}>
                            修復プロセス
                          </button>
                          <button
                            onClick={() => setPreviewTab('errors')}
                            className={cn("text-xs px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5",
                              previewTab === 'errors' ? "bg-red-50 text-red-700" : "text-slate-500 hover:text-slate-700")}>
                            エラーログ
                            {appErrors.length > 0 && (
                              <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-bold",
                                previewTab === 'errors' ? "bg-red-200 text-red-700" : "bg-red-500 text-white")}>
                                {appErrors.length}
                              </span>
                            )}
                          </button>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {!isStreaming && !autoFixing && (
                        <span className="text-[10px] px-2 py-1 rounded border mr-1 bg-slate-50 text-slate-500 border-slate-200">
                          {`手動修復モード (${autoFixCount}/3)`}
                        </span>
                      )}
                      {!isStreaming && !autoFixing && previewTab === 'preview' && (['mobile', 'laptop', 'desktop'] as DeviceType[]).map(d => (
                        <Button key={d} size="sm" variant={deviceType === d ? "default" : "ghost"}
                          onClick={() => setDeviceType(d)} className="w-8 h-8 p-0">
                          {d === 'mobile' ? <Smartphone className="w-4 h-4" /> : d === 'laptop' ? <Laptop className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                        </Button>
                      ))}
                      {previewUrl && !isStreaming && !autoFixing && previewTab === 'preview' && (
                        <Button size="sm" variant="ghost" className="w-8 h-8 p-0" onClick={() => {
                          if (!requireLoginForFullscreen()) return;
                          window.open(previewUrl, '_blank');
                        }}>
                          <ArrowUp className="w-3 h-3 rotate-45" />
                        </Button>
                      )}
                      {previewTab === 'errors' && appErrors.length > 0 && (
                        <Button size="sm" variant="ghost" className="text-xs h-7 px-2 text-slate-400 hover:text-red-500"
                          onClick={() => setAppErrors([])}>
                          クリア
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Content: code editor / preview / fix process / error log */}
                  {isStreaming ? (
                    <LiveCodeEditor
                      code={extractPartialCode(streamingContent) || '// AIが生成中...'}
                      isStreaming={true}
                    />
                  ) : autoFixing ? (
                    <LiveCodeEditor
                      code={extractPartialCode(fixStreamingContent) || '// 自動修復中...'}
                      isStreaming={true}
                    />
                  ) : previewTab === 'fix' ? (
                    <LiveCodeEditor
                      code={fixStreamingContent || '// まだ修復を実行していません'}
                      isStreaming={false}
                    />
                  ) : previewTab === 'errors' ? (
                    /* ── Error Log Panel ── */
                    <div className="flex-1 overflow-y-auto bg-[#0d1117] p-4">
                      {appErrors.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
                          <div className="text-4xl">✅</div>
                          <p className="text-sm">エラーはありません</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {/* Auto-fix button */}
                          <div className="flex items-center justify-between mb-4">
                            <span className="text-xs text-slate-400">{appErrors.length}件のエラー</span>
                            <Button size="sm"
                              disabled={!currentApp || autoFixing}
                              className="gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs h-7 disabled:opacity-60"
                              onClick={async () => {
                                if (appErrors.length === 0 || autoFixing) return;
                                await runAutoFix(appErrors[0]);
                              }}>
                              🔧 AIで自動修正
                            </Button>
                          </div>
                          {appErrors.map((err, i) => (
                            <div key={i} className="bg-[#1a1a2e] border border-red-900/40 rounded-lg p-3">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <span className={cn("text-xs font-bold px-2 py-0.5 rounded",
                                  err.type === 'NetworkError' ? "bg-orange-900/50 text-orange-400" :
                                  err.type === 'APIError' ? "bg-yellow-900/50 text-yellow-400" :
                                  "bg-red-900/50 text-red-400")}>
                                  {err.type}
                                </span>
                                <span className="text-xs text-slate-600 shrink-0">
                                  {new Date(err.time).toLocaleTimeString('ja-JP')}
                                </span>
                              </div>
                              <p className="text-sm text-red-300 font-mono break-all">{err.message}</p>
                              {err.detail && (
                                <pre className="text-xs text-slate-500 mt-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                                  {err.detail.slice(0, 400)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <AppPreview
                      previewUrl={previewUrl}
                      refreshKey={previewRefreshKey}
                      deviceType={deviceType}
                      onOpenExternal={() => {
                        if (!requireLoginForFullscreen()) return;
                        if (!previewUrl) return;
                        window.open(previewUrl, '_blank');
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          )
        )}

        {/* ═══ STORE ═══════════════════════════════════════════════ */}
        {activeTab === "store" && (
          <div className="h-full overflow-y-auto bg-gradient-to-br from-slate-50/50 via-white to-blue-50/30 relative">
            {/* ── Floating generate button (appears when a card is selected) ── */}
            {selectedStoreApp && storeInput && (
              <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center gap-3 bg-white rounded-2xl shadow-2xl border border-primary/20 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-slate-600 max-w-[300px]">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
                    <span className="truncate font-medium">{selectedStoreApp}</span>
                  </div>
                  <button
                    onClick={() => { setSelectedStoreApp(null); setStoreInput(''); }}
                    className="text-slate-300 hover:text-slate-500 text-sm px-1 transition-colors">✕</button>
                  <Button
                    size="sm"
                    className="gap-2 px-5 shadow-lg"
                    onClick={() => createNewApp(storeInput)}>
                    <Sparkles className="w-4 h-4" /> 生成開始
                  </Button>
                </div>
              </div>
            )}
            <div className="max-w-7xl mx-auto px-6 py-16">
              {/* Hero */}
              <div className="text-center mb-16 space-y-8">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-primary/5 to-blue-500/5 border border-primary/10 animate-pulse">
                  <Sparkles className="w-4 h-4 text-primary animate-spin" style={{ animationDuration: '3s' }} />
                  <span className="text-sm font-medium text-primary">AI Powered</span>
                </div>
                <div className="space-y-4">
                  <h1 className="text-5xl font-bold text-foreground">アプリを言葉で生成</h1>
                  <p className="text-xl text-muted-foreground">説明するだけで、AIが即座に実装</p>
                </div>
                <div className="max-w-3xl mx-auto">
                  <Card className="border shadow-xl hover:shadow-2xl transition-all duration-300 relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    <CardContent className="p-8 relative">
                      <div className="relative">
                        <div className="absolute -top-4 -left-4 w-16 h-16 rounded-xl bg-primary flex items-center justify-center text-white text-xl shadow-md">
                          <span className="animate-pulse text-sm font-bold">AI</span>
                        </div>
                        <textarea
                          ref={storeInputRef}
                          value={storeInput}
                          onChange={e => {
                            setStoreInput(e.target.value);
                            // If user edits the prompt, detach from selected card
                            if (selectedStoreApp && e.target.value !== storeInput) {
                              // keep selection but allow editing
                            }
                          }}
                          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && storeInput.trim()) createNewApp(storeInput); }}
                          placeholder="例：レストランの売上ダッシュボード。店舗別比較とグラフ表示..."
                          className={cn(
                            "w-full min-h-[125px] px-5 py-4 pl-16 border-2 bg-white rounded-xl resize-none focus:outline-none text-base transition-all duration-200",
                            selectedStoreApp
                              ? "border-primary/50 focus:border-primary ring-2 ring-primary/10"
                              : "hover:border-primary/30 focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
                          )}
                        />
                        <div className="flex items-center justify-between mt-4">
                          {selectedStoreApp ? (
                            <div className="flex items-center gap-2 text-sm text-primary font-medium">
                              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                              <span className="truncate max-w-[280px]">{selectedStoreApp}</span>
                              <button
                                onClick={() => { setSelectedStoreApp(null); setStoreInput(''); }}
                                className="ml-1 text-slate-400 hover:text-slate-600 transition-colors text-xs">✕ クリア</button>
                            </div>
                          ) : (
                            <div />
                          )}
                          <Button size="lg" className="gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
                            disabled={!storeInput.trim()} onClick={() => createNewApp(storeInput)}>
                            <Sparkles className="w-5 h-5" /> 生成開始
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  {STORE_TEMPLATES.map(t => (
                    <Button key={t.label} size="sm" variant="outline"
                      className="gap-2 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transform hover:scale-105 transition-all duration-200"
                      onClick={() => {
                        setSelectedStoreApp(t.label);
                        setStoreInput(t.prompt);
                        setTimeout(() => storeInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
                      }}>
                      <span className="text-lg">{t.emoji}</span> {t.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Category filter */}
              <div className="flex items-center justify-center gap-2 mb-12 overflow-x-auto pb-2">
                {[
                  { id: "all",       label: "すべて",  count: ALL_APPS.length },
                  { id: "restaurant",label: "🍜 飲食",  count: ALL_APPS.filter(a=>a.category==="飲食").length },
                  { id: "analytics", label: "📊 分析",  count: ALL_APPS.filter(a=>a.category==="分析").length },
                  { id: "hr",        label: "👥 人事",  count: ALL_APPS.filter(a=>a.category==="人事").length },
                  { id: "finance",   label: "💰 財務",  count: ALL_APPS.filter(a=>a.category==="財務").length },
                  { id: "inventory", label: "📦 在庫",  count: ALL_APPS.filter(a=>a.category==="在庫").length },
                  { id: "customer",  label: "🎯 顧客",  count: ALL_APPS.filter(a=>a.category==="顧客").length },
                ].map(cat => (
                  <Button key={cat.id} size="sm"
                    variant={storeCategory === cat.id ? "default" : "ghost"}
                    onClick={() => {
                      setStoreCategory(cat.id);
                      setSelectedStoreApp(null);
                      setStoreInput('');
                    }}
                    className="shrink-0 gap-1.5 transition-all hover:scale-105">
                    {cat.label}
                    <span className={cn(
                      "text-xs rounded-full px-1.5 py-0.5 leading-none",
                      storeCategory === cat.id
                        ? "bg-white/20 text-white"
                        : "bg-slate-100 text-slate-500"
                    )}>{cat.count}</span>
                  </Button>
                ))}
              </div>

              {/* Featured */}
              {(() => {
                const catMap: Record<string, string> = {
                  all:"すべて", restaurant:"飲食", analytics:"分析",
                  hr:"人事", finance:"財務", inventory:"在庫", customer:"顧客",
                };
                const catLabel = catMap[storeCategory] ?? "すべて";
                const featuredFiltered = storeCategory === "all"
                  ? FEATURED
                  : FEATURED.filter(f => f.category === catLabel);
                if (featuredFiltered.length === 0) return null;
                return (
                  <div className="mb-20">
                    <div className="flex items-center gap-4 mb-8">
                      <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 shadow-sm">
                        <Star className="w-4 h-4 text-yellow-600 fill-yellow-600 animate-pulse" />
                        <span className="text-sm font-semibold text-yellow-700">FEATURED</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                      {featuredFiltered.map((item, i) => {
                        const isSelected = selectedStoreApp === item.name;
                        return (
                          <Card key={i}
                            className={cn(
                              "group hover:shadow-xl hover:scale-105 hover:-translate-y-2 transition-all duration-300 cursor-pointer relative overflow-hidden",
                              isSelected
                                ? "border-2 border-primary shadow-lg scale-105 -translate-y-1 bg-primary/5"
                                : "border-0 bg-white"
                            )}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedStoreApp(null);
                                setStoreInput('');
                              } else {
                                setSelectedStoreApp(item.name);
                                setStoreInput(item.desc);
                                setTimeout(() => storeInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
                              }
                            }}>
                            {isSelected && (
                              <div className="absolute top-2 right-2 z-10 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                <span className="text-white text-xs font-bold">✓</span>
                              </div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-purple-500/0 group-hover:from-blue-500/5 group-hover:to-purple-500/5 transition-all duration-300" />
                            <CardContent className="p-6 relative">
                              <div className="text-5xl mb-4 transform group-hover:scale-110 transition-transform duration-300">{item.icon}</div>
                              <h3 className="font-bold text-lg mb-2">{item.name}</h3>
                              <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{item.desc}</p>
                              <Button size="sm" className="w-full">{isSelected ? "選択中 ✓" : "このテンプレートを使う"}</Button>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* All Templates */}
              {(() => {
                const catMap: Record<string, string> = {
                  all: "すべて", restaurant: "飲食", analytics: "分析",
                  hr: "人事", finance: "財務", inventory: "在庫", customer: "顧客",
                };
                const catLabel = catMap[storeCategory] ?? "すべて";
                const filtered = storeCategory === "all"
                  ? ALL_APPS
                  : ALL_APPS.filter(a => a.category === catLabel);
                return (
                  <div>
                    <div className="flex items-center gap-4 mb-8">
                      <h2 className="text-xl font-bold text-slate-800">
                        {storeCategory === "all" ? "すべてのテンプレート" : `${catLabel}のテンプレート`}
                      </h2>
                      <span className="text-sm text-slate-400 font-medium">{filtered.length}個</span>
                      <div className="flex-1 h-px bg-slate-100" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                      {filtered.map((app, i) => {
                        const isSelected = selectedStoreApp === app.name;
                        return (
                          <Card key={i}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedStoreApp(null);
                                setStoreInput('');
                              } else {
                                setSelectedStoreApp(app.name);
                                setStoreInput(app.desc);
                                setTimeout(() => storeInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
                              }
                            }}
                            className={cn("group hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer relative overflow-hidden", isSelected ? "border-2 shadow-lg -translate-y-1" : "border bg-white")}
                            style={isSelected ? { borderColor: app.color, backgroundColor: app.color + '08' } : {}}>
                            <CardContent className="p-5">
                              <div className="flex items-start gap-4 mb-3">
                                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0" style={{ backgroundColor: app.color + '20', border: `1.5px solid ${app.color}40` }}>{app.icon}</div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-bold text-sm mb-1 leading-snug">{app.name}</h3>
                                  <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ backgroundColor: app.color + '15', color: app.color }}>
                                    {app.publisher.startsWith('✦') ? '✦ 公式' : 'コミュニティ'}
                                  </span>
                                </div>
                              </div>
                              <p className="text-xs text-slate-500 line-clamp-2 mb-4 leading-relaxed">{app.desc}</p>
                              <div className="text-xs text-slate-400 flex items-center justify-between">
                                <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />{app.usage}</span>
                                <span className="flex items-center gap-1"><Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />{app.rating}</span>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ═══ APP STORE ═══════════════════════════════════════════ */}
        {activeTab === "market" && (
          <div className="h-full overflow-y-auto bg-gradient-to-br from-slate-50/50 via-white to-blue-50/30">
            <div className="max-w-7xl mx-auto px-6 py-12">
              <div className="flex items-end justify-between mb-8">
                <div>
                  <h1 className="text-4xl font-bold mb-2">Appストア</h1>
                  <p className="text-muted-foreground">公開済みアプリの試用・お気に入り・自分用カスタマイズ</p>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 mb-10 overflow-x-auto pb-2">
                {[
                  { id: 'all', label: 'すべて' },
                  { id: 'restaurant', label: '🍜 飲食' },
                  { id: 'analytics', label: '📊 分析' },
                  { id: 'hr', label: '👥 人事' },
                  { id: 'finance', label: '💰 財務' },
                  { id: 'inventory', label: '📦 在庫' },
                  { id: 'customer', label: '🎯 顧客' },
                ].map(cat => (
                  <Button key={cat.id} size="sm" variant={storeCategory === cat.id ? 'default' : 'ghost'} onClick={() => setStoreCategory(cat.id)}>
                    {cat.label}
                  </Button>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {apps
                  .filter(a => a.status === 'published')
                  .filter(a => {
                    if (storeCategory === 'all') return true;
                    const map: Record<string, string> = {
                      restaurant: '飲食', analytics: '分析', hr: '人事', finance: '財務', inventory: '在庫', customer: '顧客',
                    };
                    const cat = map[storeCategory];
                    return cat ? (a.description || '').includes(cat) || (a.name || '').includes(cat) : true;
                  })
                  .map(app => (
                    <Card key={app.id} className="border bg-white">
                      <CardContent className="p-5 space-y-4">
                        <div className="flex items-start gap-3">
                          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={appIconStyle(app.color)}>{app.icon}</div>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-bold truncate">{app.name}</h3>
                            <p className="text-xs text-muted-foreground line-clamp-2">{app.description || 'AIで生成されたアプリ'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getPreviewUrl(app) && (
                            <Button size="sm" variant="outline" className="gap-1" onClick={() => {
                              if (!consumeGuestTrial()) return;
                              const u = getPreviewUrl(app);
                              if (u) window.open(u, '_blank');
                            }}>
                              <ArrowUp className="w-3 h-3 rotate-45" /> 試用
                            </Button>
                          )}
                          <Button size="sm" className="gap-1" onClick={() => cloneAndEdit(app.id)}>
                            <Edit3 className="w-3 h-3" /> 自分用に編集
                          </Button>
                          <Button size="sm" variant="ghost" className="gap-1" onClick={() => toggleFavorite(app)}>
                            <Star className={cn('w-4 h-4', app.is_favorite ? 'fill-yellow-400 text-yellow-500' : '')} />
                            {app.is_favorite ? '保存済み' : '保存'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ PROFILE ══════════════════════════════════════════════ */}
        {activeTab === "profile" && user && (
          <div className="h-full overflow-y-auto bg-gradient-to-br from-slate-50/50 via-white to-blue-50/30">
            <div className="max-w-3xl mx-auto px-6 py-12 space-y-6">
              <h1 className="text-4xl font-bold">{t('myPage')}</h1>

              <Card>
                <CardContent className="p-6 space-y-4">
                  <h2 className="font-semibold">プロフィール</h2>
                  <div className="grid gap-3">
                    <div>
                      <p className="text-xs text-slate-500 mb-1">メールアドレス</p>
                      <input disabled value={user.email} className="w-full border border-slate-300 rounded-lg px-3 py-2 bg-slate-50 text-slate-600" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-1">ニックネーム</p>
                      <input value={profileNick} onChange={e => setProfileNick(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-1">アバターURL</p>
                      <input value={profileAvatar} onChange={e => setProfileAvatar(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" placeholder="https://..." />
                    </div>
                    <Button className="w-fit" onClick={saveProfile}>プロフィール保存</Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6 space-y-4">
                  <h2 className="font-semibold">パスワード変更</h2>
                  <input type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" placeholder="現在のパスワード" />
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2" placeholder="新しいパスワード" />
                  <Button onClick={savePassword} disabled={!oldPassword || !newPassword}>パスワード更新</Button>
                </CardContent>
              </Card>

              {profileMessage && <p className="text-sm text-emerald-600">{profileMessage}</p>}
              {profileError && <p className="text-sm text-red-600">{profileError}</p>}
            </div>
          </div>
        )}

        {/* ═══ MY APPS ══════════════════════════════════════════════ */}
        {activeTab === "myapps" && (
          <div className="h-full overflow-y-auto bg-gradient-to-br from-slate-50/50 via-white to-blue-50/30">
            <div className="max-w-6xl mx-auto px-6 py-12">
              <div className="flex items-center justify-between mb-12">
                <div>
                  <h1 className="text-4xl font-bold mb-3">マイアプリ</h1>
                  <p className="text-muted-foreground">すべてのアプリを管理 ({editableApps.length}個)</p>
                </div>
                <Button size="lg" className="gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
                  onClick={() => createNewApp()}>
                  <Plus className="w-5 h-5" /> 新規アプリ作成
                </Button>
              </div>

              {appsLoading ? (
                <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
              ) : editableApps.length === 0 ? (
                <div className="text-center py-24 text-muted-foreground">
                  <div className="text-6xl mb-4">📁</div>
                  <p className="text-lg font-medium mb-4">まだアプリがありません</p>
                  <Button onClick={() => setActiveTab('store')} className="gap-2"><StoreIcon className="w-4 h-4" /> Appストアで生成</Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {editableApps.map(app => (
                    <Card key={app.id}
                      className={cn("hover:shadow-lg transition-all duration-300 border bg-white relative overflow-hidden group", canEditApp(app as any, user) ? "cursor-pointer" : "opacity-90")}
                      onClick={() => { if (canEditApp(app as any, user)) openApp(app.id); }}>
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
                      <CardContent className="p-6">
                        <div className="flex items-start gap-4">
                          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0 shadow-sm"
                            style={app.color ? appIconStyle(app.color) : undefined}>
                            {app.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h3 className="font-bold text-xl mb-2">{app.name}</h3>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
                                  <span>v{app.current_version}</span><span>·</span>
                                  <span>{new Date(app.updated_at).toLocaleDateString('ja-JP')}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 ml-4" onClick={e => e.stopPropagation()}>
                                {getPreviewUrl(app) && (
                                  <Button size="sm" className="gap-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                                    onClick={() => {
                                      const u = getPreviewUrl(app);
                                      if (u) window.open(u, '_blank');
                                    }}>
                                    <ArrowUp className="w-3 h-3 rotate-45" /> 使用
                                  </Button>
                                )}
                                <Button size="sm" variant="outline" className="gap-1"
                                  disabled={!canEditApp(app as any, user)}
                                  title={!canEditApp(app as any, user) ? '編集権限がありません（先に「自分用に編集」）' : undefined}
                                  onClick={() => openApp(app.id)}>
                                  <Edit3 className="w-3 h-3" /> 編集
                                </Button>
                                <Button size="sm" variant="outline" className="gap-1 text-red-600 hover:border-red-300 hover:bg-red-50"
                                  onClick={e => deleteApp(app.id, e)}>
                                  <Trash2 className="w-3 h-3" /> 削除
                                </Button>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 flex-wrap">
                              <Badge variant={app.status === 'published' ? 'default' : 'secondary'}
                                className={cn(
                                  app.status === 'published'
                                    ? "bg-green-100 text-green-700 border-green-200"
                                    : app.status === 'private'
                                    ? "bg-blue-100 text-blue-700 border-blue-200"
                                    : "bg-yellow-100 text-yellow-700 border-yellow-200"
                                )}>
                                {app.status === 'published' ? `● ${t('published')}` : app.status === 'private' ? `● ${t('private')}` : `● ${t('draft')}`}
                              </Badge>
                              {getPreviewUrl(app) && (
                                <span className="text-xs text-muted-foreground font-mono">link:{app.preview_path || `/app/${app.preview_slug || ''}/`}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </main>

      <LoginGateModal
        open={loginGateOpen}
        actionLabel={loginGateAction}
        onClose={() => setLoginGateOpen(false)}
        onConfirm={() => navigate(buildLoginUrl())}
        onLogin={() => navigate(buildLoginUrl('login'))}
      />

      <PublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onConfirm={handlePublishConfirm}
        initialName={currentApp?.name || ''}
        initialDescription={currentApp?.description || ''}
        initialIcon={currentApp?.icon || '✨'}
        initialColor={currentApp?.color || 'indigo'}
      />
    </div>
  );
}
