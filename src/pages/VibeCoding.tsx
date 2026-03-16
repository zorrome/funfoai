import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { EyeOpenIcon, FileIcon, ChevronRightIcon, ChevronDownIcon, ExclamationTriangleIcon, MixerHorizontalIcon, PaperPlaneIcon, MagicWandIcon, CodeIcon } from "@radix-ui/react-icons";
import { useLocation, useNavigate, useParams } from "react-router";
import {
  Sparkles, Store as StoreIcon, Folder, Send,
  Plus, Smartphone, Laptop, Monitor,
  FileText, ArrowUp, GripVertical, ArrowLeft,
  Trash2, Edit3, Star, Loader2, Rocket,
  Share2, ChevronRight, TrendingUp, RotateCw, Save,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { cn } from "../components/ui/utils";
import AppPreview from "../components/AppPreview";
import PublishDialog from "../components/PublishDialog";
import LoginGateModal from "../components/LoginGateModal";
import AppFeedbackDialog from "../components/ui/app-feedback-dialog";
import { api, App, Message, AppVersion, User, PublishProgress, PublishStep, AppFileNode, PublicAiModel } from "../services/api";
import { AppLang, getLang, setLang, tr } from "../i18n";
import ModeSwitcher, { type WorkspaceMode } from "./VibeCoding/ModeSwitcher";
import MyAppsPanel from "./VibeCoding/MyAppsPanel";

type TabType = "workspace" | "store" | "market" | "myapps" | "profile";
type DeviceType = "mobile" | "laptop" | "desktop";
type GenerateStage = 'analyzing' | 'updating' | 'rendering' | 'finishing';

function tabToPath(tab: TabType, workspaceAppId?: number | null) {
  if (tab === 'workspace') return workspaceAppId ? `/workspace/${workspaceAppId}` : '/workspace';
  if (tab === 'market') return '/market';
  if (tab === 'myapps') return '/my-apps';
  if (tab === 'profile') return '/profile';
  return '/';
}

function pathToTab(pathname: string): TabType {
  if (pathname === '/workspace' || pathname.startsWith('/workspace/') || pathname.startsWith('/studio/')) return 'workspace';
  if (pathname === '/market') return 'market';
  if (pathname === '/my-apps') return 'myapps';
  if (pathname === '/profile') return 'profile';
  return 'store';
}

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

function isPublishedReleaseApp(app: App | null | undefined) {
  if (!app) return false;
  return (app.release_state || 'draft') === 'live' && (app.app_role || 'release') !== 'draft';
}

function getAppGroupKey(app: App | null | undefined) {
  if (!app) return 'unknown';
  if ((app.app_role || 'release') === 'draft' && app.release_app_id) return `release-${app.release_app_id}`;
  return `release-${app.id}`;
}

function isLinkedWorkspaceDraft(app: App | null | undefined, apps?: App[]) {
  if (!app) return false;
  if ((app.app_role || 'release') !== 'draft' || !app.release_app_id) return false;
  const release = (apps || []).find(item => item.id === app.release_app_id);
  return !!release && (release.release_state || 'draft') === 'live' && (release.app_role || 'release') !== 'draft';
}

function isFixIntent(text: string) {
  const t = text.toLowerCase();
  return [
    '修复', '修正', 'バグ', '报错', 'エラー', '直して', 'fix', 'broken', '動かない', 'クラッシュ',
  ].some(k => t.includes(k));
}

function normalizePreviewSubPath(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw || raw === '/' || raw === '//' ) return null;
  return raw;
}

const DESIGN_PATTERNS = [
  {
    id: 'executive',
    label: 'Executive Dashboard',
    guide: 'Business-oriented dashboard with clear priorities, measurable outcomes, and concise summaries.',
    recipe: 'Use strong hierarchy, readable metrics, and clearly separated information groups without forcing a palette.',
    tokens: ['clear KPI hierarchy', 'summary + detail split', 'readable metric grouping'],
    skeleton: ``
  },
  {
    id: 'glass',
    label: 'Glassmorphism Pro',
    guide: 'Layered translucent interface with depth, softness, and premium motion-friendly surfaces.',
    recipe: 'Use translucency and depth only when it improves clarity; avoid hardcoded gradients or default colors.',
    tokens: ['translucent layered surfaces', 'soft depth', 'premium motion-friendly panels'],
    skeleton: ``
  },
  {
    id: 'bento',
    label: 'Bento Grid',
    guide: 'Editorial modular layout with mixed card sizes and intentional rhythm.',
    recipe: 'Use varied module sizes and asymmetry to create hierarchy, not a fixed dashboard template.',
    skeleton: ``
  },
  {
    id: 'mobile-first',
    label: 'Mobile-First',
    guide: 'Thumb-friendly, narrow-first layout with strong focus on essential tasks.',
    recipe: 'Prioritize single-column clarity, sticky actions only when useful, and responsive progression.',
    skeleton: ``
  },
  {
    id: 'data-lab',
    label: 'Data Lab',
    guide: 'Analytical interface with filters, comparisons, drilldowns, and operational depth.',
    recipe: 'Use analytical density where needed, but keep filters, tables, and charts legible and purposeful.',
    skeleton: ``
  },
  {
    id: 'tailwind-native',
    label: 'Tailwind Native',
    guide: 'Utility-first implementation with consistent spacing, clean hierarchy, and flexible visual expression.',
    recipe: 'Use Tailwind utilities directly, but do not force a specific palette, card recipe, or default CTA style.',
    tokens: ['clean spacing rhythm', 'utility-first implementation', 'clear interactive states'],
    skeleton: ``
  },
  {
    id: 'neo-brutal',
    label: 'Neo Brutal UI',
    guide: 'Bold, high-contrast, playful composition with strong identity.',
    recipe: 'Allow expressive contrast and structure, but keep the interface usable and readable.',
    skeleton: ``
  },
  {
    id: 'saas-clean',
    label: 'SaaS Clean',
    guide: 'Restrained, modern, highly readable product interface.',
    recipe: 'Keep the layout practical and polished without defaulting to admin-dashboard sameness or fixed accent colors.',
    skeleton: ``
  }
];

const STORE_TEMPLATES = [
  {
    emoji: "📊",
    label: "売上分析",
    prompt: "飲食店向けの売上分析SaaSを作りたいです。単店舗だけでなく複数店舗にも対応し、日次・週次・月次の売上、客数、客単価、会計件数、時間帯別売上を確認できるようにしてください。トップでは今日の売上、前日比、今月累計、目標達成率を見たいです。グラフは棒グラフ、折线グラフ、時間帯ヒートマップを使い、店舗別比較や曜日別比較も見たいです。期間フィルタ、店舗フィルタ、部門フィルタを用意してください。売上明細一覧も必要で、会計日時、店舗、担当者、注文数、売上金額、値引き、支払方法が見られるようにしてください。飲食店の現場でそのまま使えるように、朝会で確認しやすいKPIカード、異常値アラート、売上の悪い時間帯の気づきコメント、CSV出力も入れてください。全体としては、飲食店オーナーや店長が毎日確認したくなる実用的な経営ダッシュボードにしてください。"
  },
  {
    emoji: "📅",
    label: "シフト管理",
    prompt: "飲食店向けの従業員シフト管理SaaSを作りたいです。1週間・2週間・月間のシフト表を作成でき、キッチン、ホール、レジ、仕込みなどの役割ごとに人を配置できるようにしてください。スタッフごとに希望休、勤務可能時間、スキル、時給、学生/社員区分を持てるようにしたいです。管理者はドラッグ操作またはセル選択で担当者を割り当てられ、同時に人件費見込み、人数不足、長時間勤務、休憩未設定などを警告表示してほしいです。スタッフ一覧、シフト表、日別詳細、承認待ち申請一覧の画面を用意してください。人手不足の時間帯が目立つUIにして、ピーク時間帯の必要人数と実配置人数を比較できるようにしてください。飲食店の店長がそのまま運用できるレベルで、見やすく、修正しやすく、スマホでも確認しやすいシフト管理アプリにしてください。"
  },
  {
    emoji: "📦",
    label: "在庫管理",
    prompt: "飲食店向けの食材・在庫管理SaaSを作りたいです。肉、野菜、米、調味料、ドリンクなどをカテゴリ別に管理し、現在庫数、単位、仕入単価、安全在庫、発注点、最終入庫日、賞味期限を確認できるようにしてください。トップでは低在庫アラート、期限切れ間近、今日の入出庫件数、今週の廃棄ロス金額を見たいです。食材一覧、入庫登録、出庫登録、棚卸し画面、発注候補一覧の画面を作ってください。低在庫は目立つように赤や注意表示を入れて、廃棄ロスや使用量の多い食材を可視化したいです。飲食店の現場スタッフでも使いやすいように、1クリックで入出庫できるボタン、棚卸し差異の確認、発注先メモ、仕入履歴を入れてください。最終的に、店舗運営で本当に役立つ在庫管理SaaSとして、単なる一覧ではなく、発注判断やロス削減に繋がる画面構成にしてください。"
  },
  {
    emoji: "💰",
    label: "経費管理",
    prompt: "飲食店向けの経費管理SaaSを作りたいです。家賃、仕入、人件費、水道光熱費、広告費、消耗品費などを月別に管理し、カテゴリごとの支出推移、予算対比、店舗別比較が見られるようにしてください。トップでは今月の総経費、先月比、予算差異、利益圧迫の大きい項目を表示してください。月別サマリー、経費明細一覧、カテゴリ別分析、承認待ち精算、レシート管理の画面が欲しいです。明細には日付、カテゴリ、店舗、支払先、金額、メモ、添付の有無を表示し、カテゴリでフィルタできるようにしてください。円グラフや積み上げ棒グラフで支出構成を見られるようにし、特に飲食店オーナーが“どこに無駄が出ているか”すぐ把握できる設計にしてください。現場での申請、店長承認、オーナー確認まで想定した、実務向けの経費管理アプリにしてください。"
  },
];

const FEATURED = [
  { icon: "🍽️", name: "テーブル・席管理システム",    desc: "店内レイアウトを見ながら、空席・案内中・会計中・予約席をリアルタイムに把握できる店舗オペレーション向け座席管理SaaS。", category: "飲食" },
  { icon: "📊", name: "多店舗売上ダッシュボード",     desc: "複数店舗の売上・客数・客単価・時間帯別実績を一元比較し、店長と本部が同じ指標で判断できる経営分析ダッシュボード。", category: "分析" },
  { icon: "👥", name: "AI勤務シフト作成",             desc: "希望休・スキル・役割・人件費を踏まえて、現場負担を抑えながら実運用できるシフト案を作成する人員配置アプリ。", category: "人事" },
  { icon: "🧾", name: "月次損益計算書",               desc: "売上・原価・人件費・経費を集計し、飲食店の月次損益を見える化して改善ポイントまで把握できる財務管理SaaS。", category: "財務" },
  { icon: "📦", name: "食材在庫管理",                 desc: "食材・ドリンク・消耗品の在庫をまとめて管理し、発注点・期限切れ・廃棄ロスまで追える在庫最適化アプリ。", category: "在庫" },
  { icon: "🎯", name: "会員ポイントシステム",         desc: "来店履歴や購入金額に応じたポイント付与・会員ランク管理・再来店施策まで一体で扱える顧客育成SaaS。", category: "顧客" },
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
  { icon: "🍽️", name: "テーブル・席管理",        publisher: "✦ 公式",                   desc: "ホール状況を一画面で把握し、空席・予約・案内中・会計中の切り替えを現場オペレーションに合わせて管理できる座席運用アプリ。", usage: "3.1k", rating: "4.9", category: "飲食", color: "#f97316" },
  { icon: "📋", name: "デジタルメニュー作成",      publisher: "✦ 公式",                   desc: "写真・価格・説明・アレルゲン情報を整理し、QRメニューとしてそのまま店頭運用できるメニュー配信アプリ。", usage: "2.7k", rating: "4.8", category: "飲食", color: "#f97316" },
  { icon: "🔔", name: "注文・呼び出しシステム",    publisher: "コミュニティ @sushi_dx",   desc: "テーブル注文とスタッフ呼び出しをデジタル化し、ホールと厨房の連携スピードを上げる店舗オペレーション支援アプリ。", usage: "1.9k", rating: "4.7", category: "飲食", color: "#f97316" },
  { icon: "📅", name: "予約管理カレンダー",        publisher: "✦ 公式",                   desc: "来店予約、人数、時間帯、アレルギー、特記事項をまとめて管理し、日々の予約運営を見やすくする予約管理アプリ。", usage: "2.2k", rating: "4.8", category: "飲食", color: "#f97316" },
  { icon: "🍱", name: "日替わりメニュー計画",      publisher: "コミュニティ @bento_pro",  desc: "ランチや週替わりメニューを営業カレンダーに沿って計画し、販売内容と仕込み計画を連動できるメニュー企画アプリ。", usage: "876",  rating: "4.5", category: "飲食", color: "#f97316" },

  // ── 📊 分析
  { icon: "📊", name: "売上日報ダッシュボード",    publisher: "✦ 公式",                   desc: "日次売上・客数・客単価・会計件数を自動集計し、店長が毎日すぐ確認できる飲食店向け売上分析ダッシュボード。", usage: "4.2k", rating: "4.9", category: "分析", color: "#6366f1" },
  { icon: "📈", name: "時間帯別売上分析",          publisher: "✦ 公式",                   desc: "ピーク時間帯や曜日ごとの売上傾向を可視化し、人員配置や販促の判断に活かせる時系列分析アプリ。", usage: "2.1k", rating: "4.8", category: "分析", color: "#6366f1" },
  { icon: "🏆", name: "メニュー人気ランキング",    publisher: "コミュニティ @izakaya_pro", desc: "注文数・粗利・回転率の観点から人気メニューを比較し、看板商品の育成に役立つメニュー分析アプリ。", usage: "1.6k", rating: "4.7", category: "分析", color: "#6366f1" },
  { icon: "💬", name: "レビュー集計ダッシュボード",publisher: "✦ 公式",                   desc: "Googleやグルメ媒体のレビューをまとめて可視化し、評価傾向や改善ポイントを把握しやすくする顧客評価分析アプリ。", usage: "1.1k", rating: "4.7", category: "分析", color: "#6366f1" },
  { icon: "🔍", name: "食材コスト分析",            publisher: "コミュニティ @ramen_dx",   desc: "食材価格の推移と原価率への影響を見える化し、値上げ判断や仕入れ見直しに使える原価分析アプリ。", usage: "743",  rating: "4.5", category: "分析", color: "#6366f1" },

  // ── 👥 人事
  { icon: "👥", name: "従業員シフト表",            publisher: "✦ 公式",                   desc: "役割・スキル・勤務希望を考慮しながら週間シフトを作成できる、飲食店の現場向けシフト管理アプリ。", usage: "3.8k", rating: "4.9", category: "人事", color: "#3b82f6" },
  { icon: "⏰", name: "勤怠・打刻管理",            publisher: "✦ 公式",                   desc: "スマホや店内端末から出退勤を記録し、遅刻・残業・勤怠集計まで一体で管理できる勤怠管理アプリ。", usage: "2.9k", rating: "4.8", category: "人事", color: "#3b82f6" },
  { icon: "📝", name: "採用・応募管理ボード",      publisher: "✦ 公式",                   desc: "応募者情報、選考状況、面接日程、評価メモをまとめて管理し、採用業務を見える化する採用管理アプリ。", usage: "1.2k", rating: "4.6", category: "人事", color: "#3b82f6" },
  { icon: "🎓", name: "スタッフ研修チェックリスト",publisher: "コミュニティ @staff_mgr", desc: "新人スタッフの研修項目や習熟度を一覧で確認し、店舗ごとの教育進捗を標準化できる研修管理アプリ。", usage: "891",  rating: "4.5", category: "人事", color: "#3b82f6" },
  { icon: "⭐", name: "スタッフ評価シート",        publisher: "✦ 公式",                   desc: "接客・オペレーション・売上貢献などをもとに月次評価を行い、育成面談にも使えるスタッフ評価アプリ。", usage: "1.0k", rating: "4.7", category: "人事", color: "#3b82f6" },

  // ── 💰 財務
  { icon: "🧾", name: "月次損益計算書",            publisher: "✦ 公式",                   desc: "売上・原価・人件費・経費を整理して、飲食店経営に必要な月次損益をわかりやすく把握できる財務アプリ。", usage: "2.6k", rating: "4.9", category: "財務", color: "#22c55e" },
  { icon: "💳", name: "経費精算システム",          publisher: "✦ 公式",                   desc: "店舗経費の申請・承認・証憑管理を一元化し、現場と本部の精算フローを整理できる経費精算アプリ。", usage: "1.8k", rating: "4.7", category: "財務", color: "#22c55e" },
  { icon: "💰", name: "キャッシュフロー予測",      publisher: "✦ 公式",                   desc: "今後の入出金予定をもとに数週間〜数ヶ月先の資金繰りを見通せるキャッシュフロー予測アプリ。", usage: "1.3k", rating: "4.8", category: "財務", color: "#22c55e" },
  { icon: "📊", name: "予算実績管理",              publisher: "コミュニティ @cfo_tool",   desc: "売上・コストの予算と実績を比較し、差異の大きい項目をすぐ確認できる予実管理アプリ。", usage: "967",  rating: "4.6", category: "財務", color: "#22c55e" },
  { icon: "🏦", name: "売掛・買掛管理",            publisher: "コミュニティ @accounting", desc: "取引先別の未収・未払状況や入金予定日を整理し、資金管理を安定させる債権債務管理アプリ。", usage: "734",  rating: "4.5", category: "財務", color: "#22c55e" },

  // ── 📦 在庫
  { icon: "📦", name: "食材在庫管理",              publisher: "✦ 公式",                   desc: "食材の入出庫、安全在庫、期限切れ、発注判断まで管理し、現場のロス削減に直結する在庫管理アプリ。", usage: "3.3k", rating: "4.9", category: "在庫", color: "#f59e0b" },
  { icon: "🥤", name: "ドリンク在庫トラッカー",    publisher: "コミュニティ @bar_system", desc: "ボトルやケース単位で在庫を記録し、発注点を超えたタイミングを逃さないドリンク管理アプリ。", usage: "1.4k", rating: "4.7", category: "在庫", color: "#f59e0b" },
  { icon: "📋", name: "棚卸し管理シート",          publisher: "✦ 公式",                   desc: "月次棚卸しの実績、差異、確認履歴を一元管理し、現場作業とレポート作成を効率化する棚卸しアプリ。", usage: "1.7k", rating: "4.8", category: "在庫", color: "#f59e0b" },
  { icon: "🚚", name: "発注・仕入れ管理",          publisher: "✦ 公式",                   desc: "仕入先別の発注履歴、単価推移、納品状況を管理し、発注業務を標準化できる仕入れ管理アプリ。", usage: "2.0k", rating: "4.8", category: "在庫", color: "#f59e0b" },
  { icon: "⚠️", name: "廃棄ロス記録",              publisher: "コミュニティ @eco_food",   desc: "日々の廃棄量とロス金額を記録し、食材管理やメニュー改善の意思決定に使えるロス分析アプリ。", usage: "892",  rating: "4.6", category: "在庫", color: "#f59e0b" },

  // ── 🎯 顧客
  { icon: "🎯", name: "会員ポイントシステム",      publisher: "✦ 公式",                   desc: "来店や会計データをもとにポイント付与・会員ランク管理・再来店促進施策まで行える会員管理アプリ。", usage: "4.0k", rating: "4.9", category: "顧客", color: "#ec4899" },
  { icon: "📱", name: "LINE友だちCRM",              publisher: "✦ 公式",                   desc: "LINE連携を前提に、誕生日配信・来店促進・セグメント配信まで扱える飲食店向けCRMアプリ。", usage: "2.8k", rating: "4.8", category: "顧客", color: "#ec4899" },
  { icon: "😊", name: "顧客満足度アンケート",      publisher: "✦ 公式",                   desc: "来店後アンケートを収集し、満足度・不満点・店舗改善テーマを見える化するフィードバック管理アプリ。", usage: "1.5k", rating: "4.7", category: "顧客", color: "#ec4899" },
  { icon: "🎁", name: "クーポン・特典管理",        publisher: "コミュニティ @mkt_cafe",   desc: "クーポン配布、利用状況、来店効果までを追跡し、販促施策の成果を見える化する特典管理アプリ。", usage: "1.2k", rating: "4.6", category: "顧客", color: "#ec4899" },
  { icon: "🔄", name: "リピーター分析",            publisher: "✦ 公式",                   desc: "来店頻度や利用金額から優良顧客や離反予兆顧客を把握し、再来店施策に繋げるCRM分析アプリ。", usage: "1.1k", rating: "4.7", category: "顧客", color: "#ec4899" },
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

function GenerationStepCard({ stage }: { stage: GenerateStage }) {
  const steps: Array<{ key: GenerateStage; label: string }> = [
    { key: 'analyzing', label: '分析需求' },
    { key: 'updating', label: '生成代码' },
    { key: 'rendering', label: '渲染预览' },
    { key: 'finishing', label: '收尾并打开预览' },
  ];
  const current = steps.findIndex(s => s.key === stage);

  return (
    <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
      <p className="text-[11px] text-zinc-700 mb-2">正在处理，请稍候…</p>
      <div className="space-y-1.5">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div key={s.key} className="flex items-center gap-2 text-xs">
              <span className={cn(
                'inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold',
                done ? 'bg-zinc-900 text-white' : active ? 'bg-zinc-700 text-white animate-pulse' : 'bg-zinc-200 text-zinc-500'
              )}>
                {done ? '✓' : active ? '…' : i + 1}
              </span>
              <span className={cn(done ? 'text-zinc-900' : active ? 'text-zinc-700 font-medium' : 'text-slate-500')}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
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
    <div className="flex-1 overflow-hidden flex flex-col bg-[linear-gradient(180deg,#0f172a,#111827)]">
      {/* Editor header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950/80 border-b border-white/10 shrink-0 backdrop-blur">
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
  const location = useLocation();
  const params = useParams();
  const [activeTab, setActiveTab] = useState<TabType>(() => pathToTab(window.location.pathname));
  const [workspaceBackTab, setWorkspaceBackTab] = useState<TabType>('workspace');
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
  const [previewWidth, setPreviewWidth] = useState(() => Math.round((typeof window !== 'undefined' ? window.innerWidth : 1400) * 0.6));

  const workspaceRouteAppId = params.appId ? Number(params.appId) : null;
  const workspaceSlugParam = params.workspaceSlug || null;
  const isWorkspaceNewRoute = location.pathname === '/workspace/new';
  const workspacePreviewPath = (() => {
    const raw = new URLSearchParams(location.search).get('previewPath');
    if (!raw) return null;
    const [pathAndSearch, hash = ''] = raw.split('#');
    const [pathname = '/', search = ''] = pathAndSearch.split('?');
    const params = new URLSearchParams(search);
    params.delete('v');
    const cleanSearch = params.toString() ? `?${params.toString()}` : '';
    return `${pathname || '/'}${cleanSearch}${hash ? `#${hash}` : ''}`;
  })();

  const [apps, setApps] = useState<App[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);

  const [currentApp, setCurrentApp] = useState<App | null>(null);
  const [publicModels, setPublicModels] = useState<PublicAiModel[]>([]);
  const [publicDefaultModelKey, setPublicDefaultModelKey] = useState<string>('');
  const [selectedAiModelKey, setSelectedAiModelKey] = useState<string>('');
  const [loadingPublicModels, setLoadingPublicModels] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [previewPort, setPreviewPort] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewSubPath, setPreviewSubPath] = useState<string | null>(null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewTab, setPreviewTab] = useState<'preview' | 'assets' | 'errors'>('preview');
  const [appFiles, setAppFiles] = useState<AppFileNode[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string>('');
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [appErrors, setAppErrors] = useState<Array<{type: string; message: string; detail: string; time: string; url?: string}>>([]);
  const [autoFixing, setAutoFixing] = useState(false);
  const [autoFixCount, setAutoFixCount] = useState(0);
  const [fixStreamingContent, setFixStreamingContent] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);

  const findPreferredFile = (nodes: AppFileNode[], preferred = ['App.jsx', 'server.js', 'schema.sql']): string | null => {
    const flat: string[] = [];
    const walk = (items: AppFileNode[]) => items.forEach((node) => {
      if (node.type === 'file') flat.push(node.path);
      if (node.children?.length) walk(node.children);
    });
    walk(nodes || []);
    for (const name of preferred) {
      const hit = flat.find((p) => p.endsWith(name));
      if (hit) return hit;
    }
    return flat[0] || null;
  };

  const loadAppFiles = useCallback(async (appId: number) => {
    const data = await api.getAppFiles(appId);
    const tree = data.tree || [];
    setAppFiles(tree);
    const preferred = findPreferredFile(tree);
    if (preferred) {
      try {
        const file = await api.getAppFileContent(appId, preferred);
        setSelectedFilePath(preferred);
        setSelectedFileContent(file.content || '');
      } catch {}
    }
  }, []);

  const openAppFile = useCallback(async (appId: number, filePath: string) => {
    const data = await api.getAppFileContent(appId, filePath);
    setSelectedFilePath(filePath);
    setSelectedFileContent(data.content || '');
  }, []);
  const [backendStatus, setBackendStatus] = useState<{ running: boolean; reachable: boolean; apiPort: number | null } | null>(null);
  const [restartingBackend, setRestartingBackend] = useState(false);

  const [inputText, setInputText] = useState('');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('create');
  const [designPatternId, setDesignPatternId] = useState<string>('executive');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [generateStage, setGenerateStage] = useState<GenerateStage>('analyzing');
  const [generateStartedAt, setGenerateStartedAt] = useState<number>(0);
  const streamingRef = useRef('');
  const streamAbortRef = useRef<null | (() => void)>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const lastAutoFixTsRef = useRef(0);
  const lastAutoFixSigRef = useRef('');

  const [storeInput, setStoreInput] = useState('');
  const [selectedStoreApp, setSelectedStoreApp] = useState<string | null>(null); // app name
  const storeInputRef = useRef<HTMLTextAreaElement>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishDialogMode, setPublishDialogMode] = useState<'edit' | 'publish'>('edit');
  const [publishProgressOpen, setPublishProgressOpen] = useState(false);
  const [repairProgressOpen, setRepairProgressOpen] = useState(false);
  const [repairSessionActive, setRepairSessionActive] = useState(false);
  const [publishFlowActive, setPublishFlowActive] = useState(false);
  const [publishingAppId, setPublishingAppId] = useState<number | null>(null);
  const [publishingAppSnapshot, setPublishingAppSnapshot] = useState<App | null>(null);
  const [publishProgress, setPublishProgress] = useState<PublishProgress | null>(null);
  const [publishPendingSince, setPublishPendingSince] = useState<number | null>(null);
  const [repairReadyToRepublish, setRepairReadyToRepublish] = useState(false);
  const [repairReportSummary, setRepairReportSummary] = useState<string[]>([]);
  const [repairingRelease, setRepairingRelease] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState<null | {
    tone: 'info' | 'success' | 'warning' | 'danger';
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    hideCancel?: boolean;
    onConfirm?: () => void | Promise<void>;
  }>(null);
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
  const toAbsoluteUrl = (pathLike?: string | null) => pathLike ? `${window.location.protocol}//${window.location.host}${pathLike}` : null;
  const getPreviewUrl = (d: any): string | null => {
    if (!d) return null;
    if (d.preview_path) return toAbsoluteUrl(d.preview_path);
    if (d.preview_url) return d.preview_url;
    if (d.preview_slug) return `${window.location.protocol}//${window.location.host}/app/${d.preview_slug}/`;
    if (d.preview_port) return `http://${window.location.hostname}:${d.preview_port}`;
    return null;
  };
  const getPublicUrl = (d: any): string | null => {
    if (!d) return null;
    if (d.public_path) return toAbsoluteUrl(d.public_path);
    if (d.public_url) return d.public_url;
    const releaseState = d.release_state || 'draft';
    return ['live', 'rollback'].includes(releaseState) ? getPreviewUrl(d) : null;
  };
  const mergePreviewRuntime = (base: any, patch: any = {}) => {
    const nextPreviewUrl = patch.previewPath
      ? `${window.location.protocol}//${window.location.host}${patch.previewPath}`
      : patch.preview_path
        ? `${window.location.protocol}//${window.location.host}${patch.preview_path}`
        : patch.preview_url ?? base?.preview_url ?? null;
    return {
      ...(base || {}),
      ...(patch || {}),
      preview_port: patch.previewPort ?? patch.preview_port ?? base?.preview_port ?? null,
      preview_slug: patch.previewSlug ?? patch.preview_slug ?? base?.preview_slug ?? null,
      preview_path: patch.previewPath ?? patch.preview_path ?? base?.preview_path ?? null,
      public_path: patch.public_path ?? base?.public_path ?? null,
      preview_url: nextPreviewUrl,
    };
  };

  const editableApps = useMemo(() => apps.filter(a => canEditApp(a as any, user)), [apps, user]);
  const groupAppsByRelease = useCallback((input: App[]) => {
    const grouped = new Map<number, { key: string; release: App | null; draft: App | null; latestUpdatedAt: string }>();
    for (const app of input) {
      const key = getAppGroupKey(app);
      const releaseId = app.app_role === 'draft' && app.release_app_id ? app.release_app_id : app.id;
      const existing = grouped.get(releaseId) || { key, release: null, draft: null, latestUpdatedAt: app.updated_at };
      if ((app.app_role || 'release') === 'draft') existing.draft = app;
      else existing.release = app;
      if (new Date(app.updated_at).getTime() > new Date(existing.latestUpdatedAt).getTime()) existing.latestUpdatedAt = app.updated_at;
      grouped.set(releaseId, existing);
    }
    return Array.from(grouped.values()).sort((a, b) => new Date(b.latestUpdatedAt).getTime() - new Date(a.latestUpdatedAt).getTime());
  }, []);
  const workspaceApps = useMemo(() => editableApps.filter(a => (a.release_state || 'draft') === 'draft'), [editableApps]);
  const workspaceGroups = useMemo(() => groupAppsByRelease(workspaceApps), [groupAppsByRelease, workspaceApps]);
  const myAppsList = useMemo(() => editableApps.filter(a => ['candidate', 'live', 'failed', 'rollback'].includes(a.release_state || 'draft')), [editableApps]);
  const myAppsGroups = useMemo(() => groupAppsByRelease(myAppsList), [groupAppsByRelease, myAppsList]);
  const isCurrentAppPublishing = currentApp?.release_state === 'candidate';
  const publishDialogApp = publishingAppSnapshot || currentApp;
  const getPublishRouteSummary = (app: App | null | undefined) => {
    if (!app) return '保存当前信息后，系统会先完成发布验证，再更新线上版本。';
    const route = app.publish_route || 'unknown';
    if (route === 'failed_to_candidate') return '这是一次失败后的重新发布。系统会重新验证，成功后恢复线上版本。';
    if (route === 'rollback_to_candidate') return '这是一次恢复后的再发布。系统会重新验证，成功后更新线上版本。';
    if (route === 'live_to_candidate') return '这是一次线上版本更新。系统会先验证，再替换当前线上版本。';
    return '这是首次发布。系统会先验证，再正式上线。';
  };

  const getPublishRouteBadge = (app: App | null | undefined) => {
    const route = app?.publish_route || 'unknown';
    if (route === 'failed_to_candidate') return 'Republish';
    if (route === 'rollback_to_candidate') return 'Recover Publish';
    if (route === 'live_to_candidate') return 'Upgrade Publish';
    if (route === 'draft_to_candidate') return 'First Publish';
    return 'Publish Route';
  };
  const getPublishActionLabel = (app: App | null | undefined) => {
    const route = app?.publish_route || 'unknown';
    if (route === 'failed_to_candidate') return '发布类型：失败后重新发布';
    if (route === 'rollback_to_candidate') return '发布类型：恢复后的重新发布';
    if (route === 'live_to_candidate') return '发布类型：线上升级发布';
    return '发布类型：首次发布';
  };
  const getFailedReleaseSummary = (app: App | null | undefined) => {
    if (!app?.last_failure_reason) return [] as string[];
    try {
      const parsed = JSON.parse(app.last_failure_reason);
      const lines: string[] = [];
      if (parsed?.type) lines.push(`失败类型：${parsed.type}`);
      if (parsed?.phase) lines.push(`失败阶段：${parsed.phase}`);
      if (parsed?.message) lines.push(`失败原因：${parsed.message}`);
      return lines.slice(0, 3);
    } catch {
      return [String(app.last_failure_reason)].filter(Boolean).slice(0, 2);
    }
  };

  const getPublishValidation = (app: App | null | undefined) => {
    const items: string[] = [];
    if (!app) return { summary: '未选择 App，暂时不能发布。', items: ['请先进入一个具体 App。'] };
    if (!app.name?.trim()) items.push('缺少 App 名称');
    if (!app.icon?.trim()) items.push('缺少 App 图标');
    if (!app.description?.trim()) items.push('缺少 App 描述');
    const route = app.publish_route || 'draft_to_candidate';
    if (route === 'failed_to_candidate') items.push('系统会基于上次失败结果重新执行发布验证');
    if (route === 'rollback_to_candidate') items.push('系统会基于当前恢复版本重新执行发布验证');
    if (route === 'live_to_candidate') items.push('这是一次线上升级发布，成功后会替换当前线上版本');
    const summary = items.length
      ? (items.some(i => i.startsWith('缺少')) ? '发布前仍有缺失项，建议先补齐再发。' : '当前已可发布，系统会按下列步骤自动完成验证与上线。')
      : '发布条件已基本齐备，可以直接开始发布。';
    return { summary, items };
  };
  const currentAppEditable = useMemo(() => canEditApp(currentApp as any, user), [currentApp, user]);
  const currentAppCanAutoFix = useMemo(() => {
    if (!currentApp) return false;
    if (currentAppEditable) return true;
    const appAny = currentApp as any;
    return !user && !appAny?.owner_user_id && !!appAny?.guest_key && appAny.guest_key === getLocalGuestKey();
  }, [currentApp, currentAppEditable, user]);
  const selectedAiModel = useMemo(() => {
    return publicModels.find(model => model.key === selectedAiModelKey)
      || publicModels.find(model => model.key === currentApp?.ai_model_key)
      || publicModels.find(model => model.isDefault)
      || publicModels[0]
      || null;
  }, [publicModels, selectedAiModelKey, currentApp?.ai_model_key]);
  const autoFixAutoEnabled = useMemo(() => {
    if (!currentApp) return false;
    return (currentApp.current_version || 1) <= 1 || (versions?.length || 0) <= 1;
  }, [currentApp, versions]);
  const canSubmitReview = useMemo(() => {
    if (!currentApp) return false;
    return ['live', 'rollback'].includes(currentApp.release_state || 'draft') && currentApp.review_status !== 'pending';
  }, [currentApp]);
  const isRepairFlowVisibleForCurrentApp = useMemo(() => {
    if (!currentApp) return false;
    if (!repairSessionActive && !repairingRelease && !repairReadyToRepublish) return false;
    if (repairingRelease) return true;
    if ((currentApp.release_state || 'draft') === 'failed' && repairSessionActive) return true;
    if (publishingAppId === currentApp.id && !!publishProgress && repairSessionActive) return true;
    if (repairReadyToRepublish) return true;
    return false;
  }, [currentApp, publishProgress, publishingAppId, repairReadyToRepublish, repairingRelease, repairSessionActive]);
  const isPublishFlowVisibleForCurrentApp = useMemo(() => {
    if (!currentApp) return false;
    if (repairSessionActive) return false;
    return publishingAppId === currentApp.id && !!publishProgress && publishProgress.status !== 'failed';
  }, [currentApp, publishProgress, publishingAppId, repairSessionActive]);
  const currentRepairStep = useMemo(() => {
    const steps = publishProgress?.steps || [];
    return steps.find(step => step.status === 'running') || steps[steps.length - 1] || null;
  }, [publishProgress]);
  const repairInlineSummary = useMemo(() => {
    if (repairingRelease) return '正在分析阻塞问题，并尝试修复后重新跑 verifier。';
    if (repairReadyToRepublish) return '修复已经完成。你现在可以重新发布，继续进入 Candidate → Live。';
    if (publishProgress?.status === 'failed') return publishProgress.error_message || '修复未通过，请继续查看阻塞项。';
    if (currentRepairStep?.detail) return currentRepairStep.detail;
    if ((currentApp?.release_state || 'draft') === 'failed') return '当前 app 处于 Failed 状态，点击“修复发布问题”后，这里会显示修复进度。';
    return '修复状态会在这里持续同步。';
  }, [currentApp?.release_state, currentRepairStep?.detail, publishProgress?.error_message, publishProgress?.status, repairReadyToRepublish, repairingRelease]);

  const suggestedWorkspaceMode = useMemo<WorkspaceMode>(() => {
    const hasVersion = (versions?.length || 0) > 0;
    const hasMessages = (messages?.length || 0) > 0;
    if (!hasVersion && !hasMessages) return 'create';
    return 'edit';
  }, [versions, messages]);

  useEffect(() => {
    setWorkspaceMode(prev => {
      if (prev === 'rewrite') return prev;
      return suggestedWorkspaceMode;
    });
  }, [suggestedWorkspaceMode, currentApp?.id]);

  const getWorkspaceModeMeta = (mode: WorkspaceMode) => {
    if (mode === 'create') return { label: 'Create', hint: '从 0 到 1 生成，不继承旧结构约束' };
    if (mode === 'rewrite') return { label: 'Rewrite', hint: '保留业务目标，但允许重做结构与实现' };
    return { label: 'Edit', hint: '基于现有版本安全迭代，保留兼容性' };
  };

  const getPublishProgressPercent = (progress: PublishProgress | null | undefined) => {
    if (!progress) return 12;
    if (progress.status === 'completed' || progress.status === 'failed') return 100;
    const steps = progress?.steps || [];
    const runningStep = steps.find(step => step.status === 'running');
    const stepId = String(runningStep?.id || progress.current_phase || progress.current_step || '').toLowerCase();
    if (stepId.includes('candidate_prepare') || stepId.includes('frontend') || stepId.includes('backend') || stepId.includes('generate') || stepId.includes('manifest')) return 60;
    if (stepId.includes('candidate_runtime') || stepId.includes('runtime') || stepId.includes('docker') || stepId.includes('health') || stepId.includes('db_check')) return 90;
    if (stepId.includes('verify')) return 95;
    if (stepId.includes('completion')) return 100;
    return 18;
  };

  const getPublishStepVisual = (step: PublishStep) => {
    if (step.status === 'completed') return { icon: '✓', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
    if (step.status === 'running') return { icon: '…', className: 'bg-amber-100 text-amber-700 border-amber-200' };
    if (step.status === 'failed') return { icon: '!', className: 'bg-red-100 text-red-700 border-red-200' };
    if (step.status === 'cancelled') return { icon: '×', className: 'bg-slate-200 text-slate-700 border-slate-300' };
    return { icon: String(step.order), className: 'bg-slate-100 text-slate-500 border-slate-200' };
  };

  const getPublishStatusMeta = (app: App | null | undefined) => {
    if (!app) return { label: '● In Progress', badgeClass: 'bg-slate-100 text-slate-700 border-slate-200', disabled: false };
    if (app.release_state === 'candidate') return { label: '● Publishing', badgeClass: 'bg-amber-100 text-amber-700 border-amber-200', disabled: true };
    if (app.release_state === 'failed') return { label: '● Publish Failed', badgeClass: 'bg-red-100 text-red-700 border-red-200', disabled: false };
    if (app.release_state === 'rollback') return { label: '● Recovered', badgeClass: 'bg-violet-100 text-violet-700 border-violet-200', disabled: false };
    if (app.release_state === 'live') return { label: '● Live', badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-200', disabled: false };
    return { label: '● In Progress', badgeClass: 'bg-yellow-100 text-yellow-700 border-yellow-200', disabled: false };
  };

  const syncAppIntoState = (updated: App) => {
    setApps(prev => prev.map(item => item.id === updated.id ? { ...item, ...updated } : item));
    if (currentApp?.id === updated.id) {
      setCurrentApp(prev => prev ? { ...prev, ...updated, preview_port: updated.preview_port ?? prev.preview_port, preview_url: getPreviewUrl(updated) || prev.preview_url } : prev);
    }
  };

  const syncPublishStateIntoCurrentApp = (updated: App) => {
    setApps(prev => prev.map(item => item.id === updated.id ? { ...item, ...updated } : item));
    if (currentApp?.id === updated.id) {
      setCurrentApp(prev => prev ? {
        ...prev,
        app_role: updated.app_role,
        release_app_id: updated.release_app_id,
        release_state: updated.release_state,
        live_version_id: updated.live_version_id,
        candidate_version_id: updated.candidate_version_id,
        last_failure_reason: updated.last_failure_reason,
        last_failure_at: updated.last_failure_at,
        last_promoted_at: updated.last_promoted_at,
        stage_reason: updated.stage_reason,
        current_version: updated.current_version,
        publish_progress: updated.publish_progress,
        updated_at: updated.updated_at,
      } : prev);
    }
  };

  const fetchApps = useCallback(async () => {
    setAppsLoading(true);
    try {
      const nextApps = await api.listApps();
      setApps(nextApps);
      setCurrentApp(prev => {
        if (!prev?.id) return prev;
        const fresh = nextApps.find(item => item.id === prev.id);
        return fresh
          ? { ...prev, ...fresh, preview_port: fresh.preview_port ?? prev.preview_port, preview_url: getPreviewUrl(fresh) || prev.preview_url }
          : prev;
      });
    }
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
      p.set('redirect', `/workspace/${currentApp.id}?${redirectParams.toString()}`);
    } else {
      redirectParams.set('tab', activeTab);
      p.set('redirect', `${tabToPath(activeTab)}?${redirectParams.toString()}`);
    }
    return `/login?${p.toString()}`;
  };

  useEffect(() => {
    const nextTab = pathToTab(location.pathname);
    setActiveTab(prev => prev === nextTab ? prev : nextTab);
  }, [location.pathname]);

  useEffect(() => { fetchApps(); }, [fetchApps]);
  useEffect(() => {
    api.me().then(u => {
      setUser(u);
      setProfileNick(u.nickname || '');
      setProfileAvatar(u.avatar_url || '');
    }).catch(() => setUser(null));
  }, []);
  useEffect(() => { streamingRef.current = streamingContent; }, [streamingContent]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamingContent]);

  useEffect(() => {
    if (!isStreaming || !generateStartedAt) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - generateStartedAt;
      setGenerateStage(prev => {
        if (prev === 'rendering' || prev === 'finishing') return prev;
        if (elapsed > 18000) return 'finishing';
        if (elapsed > 6000) return 'updating';
        return prev;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isStreaming, generateStartedAt]);

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
    const targetAppId = publishingAppId || currentApp?.id || null;
    const targetPublishing = !!publishingAppId || isCurrentAppPublishing;
    if (!targetAppId || (!publishFlowActive && !publishProgressOpen && !targetPublishing)) {
      if (!targetPublishing && !publishFlowActive) {
        setPublishProgress(null);
        setPublishingAppId(null);
        setPublishingAppSnapshot(null);
      }
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const status = await api.getPublishStatus(targetAppId);
        if (cancelled) return;
        syncPublishStateIntoCurrentApp(status);
        setPublishingAppSnapshot(prev => prev ? { ...prev, ...status } : status);
        setPublishProgress(status.publish_progress || null);
        const done = status.publish_progress?.status === 'completed';
        const failed = status.publish_progress?.status === 'failed';
        const stillPublishing = status.publish_status === 'publishing';
        const graceActive = !!publishPendingSince && (Date.now() - publishPendingSince < 15000);
        if (done || failed) {
          await fetchApps();
          setPublishPendingSince(null);
          if (done) {
             setPublishFlowActive(true);
            setCurrentApp(prev => prev ? {
              ...prev,
              ...status,
              preview_port: status.preview_port ?? prev.preview_port,
              preview_url: getPreviewUrl(status) || prev.preview_url,
            } : prev);
            if (!repairSessionActive) setPublishProgressOpen(true);
          } else if (failed) {
            if (!repairSessionActive) setPublishProgressOpen(true);
          }
          return;
        }
        if (!stillPublishing && !graceActive) {
          await fetchApps();
          setPublishPendingSince(null);
          return;
        }
      } catch (e) {
        console.error('publish status poll failed:', e);
      }
      if (!cancelled) timer = window.setTimeout(tick, 1200);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [publishingAppId, currentApp?.id, publishProgressOpen, publishFlowActive, isCurrentAppPublishing, publishPendingSince, fetchApps]);

  useEffect(() => {
    const close = () => setUserMenuOpen(false);
    if (!userMenuOpen) return;
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [userMenuOpen]);

  const loadPublicModels = useCallback(async () => {
    setLoadingPublicModels(true);
    try {
      const catalog = await api.publicAiModels();
      setPublicModels(catalog.models || []);
      setPublicDefaultModelKey(catalog.defaultModelKey || '');
    } finally {
      setLoadingPublicModels(false);
    }
  }, []);

  useEffect(() => {
    loadPublicModels().catch(console.error);
  }, [loadPublicModels]);

  useEffect(() => {
    if (currentApp?.ai_model_key) {
      setSelectedAiModelKey(currentApp.ai_model_key);
      return;
    }
    if (!selectedAiModelKey && publicDefaultModelKey) {
      setSelectedAiModelKey(publicDefaultModelKey);
    }
  }, [currentApp?.id, currentApp?.ai_model_key, publicDefaultModelKey, selectedAiModelKey]);

  const handleAiModelSelect = useCallback(async (modelKey: string) => {
    setSelectedAiModelKey(modelKey);
    if (!currentApp?.id || !user || !currentAppEditable) return;
    try {
      const updated = await api.updateApp(currentApp.id, { ai_model_key: modelKey });
      setCurrentApp(updated);
      setApps(prev => prev.map(app => app.id === updated.id ? { ...app, ai_model_key: updated.ai_model_key } : app));
    } catch (e) {
      console.warn('save ai model selection failed:', e);
    }
  }, [currentApp?.id, currentAppEditable, user]);

  const openApp = useCallback(async (appId: number, fromTab?: TabType) => {
    try {
      const sourceTab: TabType = fromTab || activeTab || 'workspace';
      setWorkspaceBackTab(sourceTab === 'workspace' ? 'workspace' : sourceTab);
      const data = await api.getApp(appId);
      if (isPublishedReleaseApp(data) && user && canEditApp(data as any, user)) {
        await openWorkspaceDraftForRelease(data.id);
        return;
      }
      const sorted = sortVersionsByEditedTime(data.versions || []);
      setActiveTab('workspace');
      setCurrentApp(data);
      setMessages(data.messages || []);
      setVersions(sorted);
      setSelectedVersionId(sorted[0]?.id ?? null);
      setPreviewPort(data.preview_port ?? null);
      setPreviewUrl(getPreviewUrl(data));
      setPreviewSubPath(normalizePreviewSubPath(workspacePreviewPath));
      setPreviewRefreshKey(k => k + 1);
      setStreamingContent('');
      setFixStreamingContent('');
      setAppErrors([]);
      setAutoFixCount(0);
      setPreviewTab('preview');
      setPendingGeneration(null);
      setPlanSteps([]);
      setQuestionnaire([]);
      setPlanning(false);
      setShowExtraRequirement(false);
      setExtraRequirement('');
      const nextPath = data.workspace_slug ? `/studio/${data.workspace_slug}` : `/workspace/${data.id}`;
      if (location.pathname !== nextPath) navigate(nextPath);
    } catch (e: any) {
      const msg = String(e?.message || e || 'アプリを開けませんでした');
      setFeedbackModal({
        tone: 'warning',
        title: '无法打开应用',
        description: msg.includes('権限') || msg.includes('アクセス') ? '这个 App 当前没有编辑权限。请先使用「自分用に編集」。' : msg,
        confirmText: '知道了',
        hideCancel: true,
      });
    }
  }, [activeTab, user, workspacePreviewPath, location.pathname, navigate]);

  const didHydrateFromQueryRef = useRef(false);
  useEffect(() => {
    if (didHydrateFromQueryRef.current) return;
    didHydrateFromQueryRef.current = true;

    const qs = new URLSearchParams(window.location.search);
    const tab = qs.get('tab') as TabType | null;
    const resumeApp = qs.get('resumeApp');
    const validTab = tab && ['store', 'market', 'workspace', 'myapps', 'profile'].includes(tab) ? tab : null;

    if (resumeApp) {
      api.getApp(Number(resumeApp))
        .then(app => navigate(app.workspace_slug ? `/studio/${app.workspace_slug}` : `/workspace/${Number(resumeApp)}`, { replace: true }))
        .catch(() => navigate(`/workspace/${Number(resumeApp)}`, { replace: true }));
      return;
    }
    if (validTab) {
      navigate(tabToPath(validTab), { replace: true });
    }
  }, [navigate]);



  const runAutoFix = useCallback(async (entry: {type: string; message: string; detail: string; time: string; url?: string}) => {
    if (!currentApp || autoFixing) return;
    if (!currentAppCanAutoFix) {
      setMessages(prev => [...prev, {
        id: Date.now(),
        app_id: currentApp.id,
        role: 'assistant',
        content: '⚠️ この App の自動修正権限がありません。自分の Workspace 草稿でのみ修復できます。',
        created_at: new Date().toISOString(),
      }]);
      return;
    }
    const maxRetry = user ? 50 : 80;
    if (autoFixCount >= maxRetry) return;

    setAutoFixing(true);
    setPreviewTab('errors');
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
      const repairedPreviewState = mergePreviewRuntime(currentApp, r);
      if (r.previewPort !== undefined) setPreviewPort(r.previewPort ?? null);
      setPreviewUrl(getPreviewUrl(repairedPreviewState));
      setPreviewSubPath(null);
      setPreviewRefreshKey(k => k + 1);
      if (r.versionId) setSelectedVersionId(r.versionId);
      const fresh = await api.getApp(currentApp.id);
      setCurrentApp(fresh);
      setMessages(fresh.messages || []);
      setVersions(sortVersionsByEditedTime(fresh.versions || []));
      setAppErrors([]);
      setPreviewPort(fresh.preview_port ?? r.previewPort ?? null);
      setPreviewUrl(getPreviewUrl(mergePreviewRuntime(fresh, r)));
      setPreviewTab('preview');
      setFeedbackModal({
        tone: 'success',
        title: 'AI 修复完成',
        description: `已生成 v${r.versionNumber || 'new'}，刷新当前预览，并完成浏览器验证。右侧现在应该已经是最新修复结果。`,
        confirmText: '知道了',
        hideCancel: true,
      });
    } catch (err: any) {
      const msg = String(err?.message || err || 'unknown error');
      setMessages(prev => [...prev, {
        id: Date.now(),
        app_id: currentApp.id,
        role: 'assistant',
        content: `⚠️ 自動修正に失敗: ${msg}`,
        created_at: new Date().toISOString(),
      }]);
      setFeedbackModal({
        tone: 'danger',
        title: 'AI 修复未通过验证',
        description: msg,
        confirmText: '知道了',
        hideCancel: true,
      });
      // permission / infra timeout / cooldown errors should not loop auto-fix
      if (
        msg.includes('権限') || msg.includes('アクセス') || msg.includes('403') || msg.includes('permission') ||
        msg.includes('cooldown') || msg.includes('already running') || msg.includes('aborted') || msg.includes('timeout') || msg.includes('timed out')
      ) {
        setAutoFixCount(maxRetry);
      }
      setPreviewTab('errors');
    } finally {
      setAutoFixing(false);
    }
  }, [currentApp, autoFixing, autoFixCount, user, currentAppCanAutoFix]);

  // Listen for errors posted from preview iframes
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const previewBasePath = String(currentApp?.preview_path || (currentApp?.preview_slug ? `/app/${currentApp.preview_slug}` : '') || '');
      if (e.data?.__funfoRouteChange && previewBasePath && activeTab === 'workspace') {
        const path = String(e.data.path || '');
        const rawSearch = String(e.data.search || '');
        const hash = String(e.data.hash || '');
        const prefix = previewBasePath.replace(/\/$/, '');
        if (path.startsWith(prefix)) {
          const params = new URLSearchParams(rawSearch.startsWith('?') ? rawSearch.slice(1) : rawSearch);
          params.delete('v');
          const cleanSearch = params.toString() ? `?${params.toString()}` : '';
          const nextSubPath = normalizePreviewSubPath(`${path.slice(prefix.length) || '/'}${cleanSearch}${hash}`);
          setPreviewSubPath(prev => prev === nextSubPath ? prev : nextSubPath);
          const qs = new URLSearchParams(location.search);
          const currentQueryPreviewPath = normalizePreviewSubPath(qs.get('previewPath'));
          if (currentQueryPreviewPath !== nextSubPath) {
            if (!nextSubPath) qs.delete('previewPath');
            else qs.set('previewPath', nextSubPath);
            const nextUrl = `${location.pathname}${qs.toString() ? `?${qs.toString()}` : ''}`;
            const currentUrl = `${location.pathname}${location.search || ''}`;
            if (nextUrl !== currentUrl) {
              navigate(nextUrl, { replace: true });
            }
          }
        }
        return;
      }

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

      return;
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [runAutoFix, activeTab, currentAppEditable, autoFixAutoEnabled, currentApp?.preview_slug, location.pathname, location.search, navigate]);

  const createNewApp = useCallback(async (prompt?: string) => {
    try {
      const app = await api.createApp({ name: '新規アプリ', icon: '✨', ai_model_key: selectedAiModelKey || publicDefaultModelKey || undefined });
      setCurrentApp(app);
      if (app.ai_model_key) setSelectedAiModelKey(app.ai_model_key);
      setMessages([]);
      setVersions([]);
      setSelectedVersionId(null);
      setPreviewPort(null);
      setPreviewUrl(null);
      setPreviewSubPath(null);
      setStreamingContent('');
      setFixStreamingContent('');
      setSelectedStoreApp(null);
      setStoreInput('');
      setAppErrors([]);
      setAutoFixCount(0);
      setPreviewTab('preview');
      setPendingGeneration(null);
      setPlanSteps([]);
      setQuestionnaire([]);
      setPlanning(false);
      setShowExtraRequirement(false);
      setExtraRequirement('');
      navigate(app.workspace_slug ? `/studio/${app.workspace_slug}` : `/workspace/${app.id}`);
      if (prompt) setTimeout(() => sendMessage(app.id, prompt), 80);
    } catch (e) {
      setFeedbackModal({
        tone: 'danger',
        title: '后端连接失败',
        description: '当前无法连接后端。请确认 AI Store 后端已经启动，并且前端代理配置可用。',
        confirmText: '知道了',
        hideCancel: true,
      });
    }
  }, [publicDefaultModelKey, selectedAiModelKey]);

  useEffect(() => {
    if (activeTab !== 'workspace') return;
    if (isWorkspaceNewRoute) {
      if (!currentApp && !appsLoading) createNewApp().catch(console.error);
      return;
    }
    if (workspaceSlugParam) {
      api.getWorkspaceApp(workspaceSlugParam)
        .then(({ app }) => {
          if (app?.id && currentApp?.id !== app.id) openApp(app.id, 'workspace').catch(console.error);
          if (app?.workspace_slug && location.pathname !== `/studio/${app.workspace_slug}`) {
            navigate(`/studio/${app.workspace_slug}${location.search || ''}`, { replace: true });
          }
        })
        .catch(console.error);
      return;
    }
    if (!workspaceRouteAppId || !Number.isFinite(workspaceRouteAppId)) return;
    if (currentApp?.id === workspaceRouteAppId) {
      if (currentApp?.workspace_slug) navigate(`/studio/${currentApp.workspace_slug}${location.search || ''}`, { replace: true });
      return;
    }
    openApp(workspaceRouteAppId, 'workspace').catch(console.error);
  }, [activeTab, isWorkspaceNewRoute, workspaceRouteAppId, workspaceSlugParam, currentApp?.id, currentApp?.workspace_slug, appsLoading, openApp, createNewApp, navigate, location.pathname, location.search]);

  useEffect(() => {
    if (activeTab !== 'workspace' || !currentApp?.preview_slug) return;
    setPreviewSubPath(normalizePreviewSubPath(workspacePreviewPath));
  }, [activeTab, currentApp?.preview_slug, workspacePreviewPath]);

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
    setGenerateStartedAt(0);
  }, [isStreaming, currentApp]);

  const sendMessage = useCallback(async (appId: number, text: string) => {
    if (!text.trim() || isStreaming || autoFixing) return;
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
    setPendingGeneration(null);
    setPlanning(false);
    setPlanSteps([]);
    setQuestionnaire([]);
    setShowExtraRequirement(false);
    setExtraRequirement('');
    setInputText('');

    startGeneration(appId, trimmed, workspaceMode);
  }, [isStreaming, autoFixing, currentAppEditable, currentApp, user, versions, messages, workspaceMode]);

  const startGeneration = useCallback(async (appId: number, text: string, mode: WorkspaceMode) => {
    if (!text.trim() || isStreaming || autoFixing) return;

    const now = Date.now();
    const modeMeta = getWorkspaceModeMeta(mode);
    const userMsg: Message = {
      id: now,
      app_id: appId,
      role: 'user',
      content: text.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setPendingGeneration(null);
    setActiveTab('workspace');
    setPreviewTab('preview');
    setIsStreaming(true);
    setStreamingContent('');
    setGenerateStage('analyzing');
    setMessages(prev => [...prev, {
      id: now + 2,
      app_id: appId,
      role: 'assistant',
      content: `🧭 当前模式：${modeMeta.label}｜${modeMeta.hint}`,
      created_at: new Date().toISOString(),
    }]);
    setGenerateStartedAt(Date.now());

    const abort = api.chat(appId, text.trim(), {
      onDelta: d => {
        setStreamingContent(p => p + d);
        setGenerateStage(prev => (prev === 'analyzing' ? 'updating' : prev));
      },
      onStatus: (_stage, statusMsg) => {
        if (!statusMsg) return;
        setMessages(prev => [...prev, {
          id: Date.now() + Math.floor(Math.random() * 1000),
          app_id: appId,
          role: 'assistant',
          content: statusMsg,
          created_at: new Date().toISOString(),
        }]);
      },
      onCode: (_code, versionId, versionNumber, port, _apiPort, _hasBackend, _hasDb, previewSlug, previewPath) => {
        setGenerateStage('rendering');
        setPreviewTab('preview');
        window.setTimeout(() => setGenerateStage(prev => (prev === 'rendering' ? 'finishing' : prev)), 1200);
        setPreviewPort(port ?? null);
        setPreviewUrl(getPreviewUrl(mergePreviewRuntime(currentApp, { previewPort: port, previewSlug, previewPath })));
        setPreviewSubPath(null);
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
        setGenerateStartedAt(0);

        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          app_id: appId,
          role: 'assistant',
          content: full,
          created_at: new Date().toISOString(),
        }]);

        try {
          const d = await api.getApp(appId);
          const hasWorkspaceVersion = !!(d.versions && d.versions.length > 0);
          const hasPreview = !!(d.preview_port || d.preview_path || d.preview_slug);
          setCurrentApp(d);
          if (d.preview_port !== undefined) {
            setPreviewPort(d.preview_port ?? null);
            setPreviewUrl(getPreviewUrl(d));
            setPreviewSubPath(null);
            if (hasWorkspaceVersion && hasPreview) setPreviewTab('preview');
            setPreviewRefreshKey(k => k + 1);
          }
          if (d.versions) setVersions(sortVersionsByEditedTime(d.versions));
          if (!hasWorkspaceVersion) {
            setMessages(prev => [...prev, {
              id: Date.now() + 3,
              app_id: appId,
              role: 'assistant',
              content: '⚠️ 本次生成没有形成有效前端版本，已阻止进入预览。',
              created_at: new Date().toISOString(),
            }]);
          }
          fetchApps();
        } catch (e) {
          console.error('refresh app failed:', e);
        }
      },
      onError: async (msg, payload) => {
        streamAbortRef.current = null;
        setIsStreaming(false);
        setStreamingContent('');
        setGenerateStartedAt(0);
        if (payload?.needs_workspace_draft && payload?.workspace_draft?.id) {
          setMessages(prev => [...prev, { id: Date.now() + 1, app_id: appId, role: 'assistant', content: '🔀 公開リリースは直接編集できないため、対応するワークスペース下書きへ切り替えます。', created_at: new Date().toISOString() }]);
          await fetchApps();
          await openApp(payload.workspace_draft.id, 'workspace');
          return;
        }
        setMessages(prev => [...prev, { id: Date.now() + 1, app_id: appId, role: 'assistant', content: `⚠️ エラー: ${msg}`, created_at: new Date().toISOString() }]);
      },
    }, userMsg.content, mode, selectedAiModelKey || currentApp?.ai_model_key || publicDefaultModelKey || undefined);

    streamAbortRef.current = abort;
  }, [isStreaming, autoFixing, fetchApps, selectedAiModelKey, currentApp?.ai_model_key, publicDefaultModelKey]);

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

  async function openWorkspaceDraftForRelease(sourceAppId: number) {
    if (!requireLogin('アプリの編集')) return null;
    const draft = await api.ensureWorkspaceDraft(sourceAppId);

    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const s = await api.cloneReady(draft.id);
        if (s.ready) { ready = true; break; }
      } catch {}
      await new Promise(r => setTimeout(r, 250));
    }

    if (!ready) {
      setFeedbackModal({ tone: 'info', title: 'Workspace 仍在准备中', description: '草稿工作区还在准备中，请稍后再试一次。', confirmText: '知道了', hideCancel: true });
      await fetchApps();
      return null;
    }

    await fetchApps();
    await openApp(draft.id, 'workspace');
    return draft;
  }

  const cloneAndEdit = async (id: number) => {
    if (!requireLogin('アプリの編集')) return;
    const cloned = await api.cloneApp(id);

    // Wait until clone files are fully ready before entering workspace.
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const s = await api.cloneReady(cloned.id);
        if (s.ready) { ready = true; break; }
      } catch {}
      await new Promise(r => setTimeout(r, 250));
    }

    if (!ready) {
      setFeedbackModal({ tone: 'info', title: '复制仍在进行中', description: '当前 clone 还没有完成，请稍后再进入编辑器。', confirmText: '知道了', hideCancel: true });
      await fetchApps();
      return;
    }

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
    const nextPath = tabToPath(tab);
    if (location.pathname !== nextPath) navigate(nextPath);
    else setActiveTab(tab);
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
    const target = apps.find(item => item.id === id);
    setFeedbackModal({
      tone: 'danger',
      title: (target?.app_role || 'release') === 'draft' ? '删除 Draft' : '删除应用',
      description: `确定要删除「${target?.name || `App #${id}` }」吗？此操作不可恢复。`,
      confirmText: '确认删除',
      cancelText: '取消',
      onConfirm: async () => {
        try {
          await api.deleteApp(id);
          await fetchApps();
          if (currentApp?.id === id) setCurrentApp(null);
          setFeedbackModal({
            tone: 'success',
            title: (target?.app_role || 'release') === 'draft' ? 'Draft 已删除' : '应用已删除',
            description: '删除操作已完成。',
            confirmText: '知道了',
            hideCancel: true,
          });
        } catch (err: any) {
          setFeedbackModal({
            tone: 'danger',
            title: '删除失败',
            description: err?.message || '删除失败，请稍后重试。',
            confirmText: '知道了',
            hideCancel: true,
          });
        }
      },
    });
  };

  const handlePublishConfirm = async (name: string, description: string, icon: string, color: string) => {
    if (!currentApp) return;
    const updated = await api.updateApp(currentApp.id, { name, description, icon, color });
    const hydrated = { ...updated, preview_port: previewPort, preview_url: previewUrl };
    setCurrentApp(hydrated);
    fetchApps();
    setPublishOpen(false);
    if (publishDialogMode === 'publish') {
      await startPublishFlow(hydrated as App);
    }
  };

  const restartAppBackend = async () => {
    if (!currentApp?.id || !currentAppEditable || restartingBackend) return;
    setRestartingBackend(true);
    try {
      const r = await api.restartBackend(currentApp.id);
      if (r.apiPort !== undefined) setBackendStatus({ running: !!r.apiPort, reachable: !!r.apiPort, apiPort: r.apiPort ?? null });
      if (r.previewPort !== undefined) {
        setPreviewPort(r.previewPort ?? null);
        setPreviewUrl(getPreviewUrl(mergePreviewRuntime(currentApp, r)));
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

  const saveDraft = async () => {
    if (!currentApp || !isLinkedWorkspaceDraft(currentApp)) return;
    try {
      const updated = await api.saveDraft(currentApp.id);
      syncAppIntoState(updated);
      setCurrentApp(prev => prev ? { ...prev, ...updated, preview_port: updated.preview_port ?? prev.preview_port, preview_url: getPreviewUrl(updated) || prev.preview_url } : prev);
      fetchApps();
      setFeedbackModal({ tone: 'success', title: 'Draft 已保存', description: '该 workspace draft 已经保存。', confirmText: '知道了', hideCancel: true });
    } catch (e: any) {
      setFeedbackModal({ tone: 'danger', title: '保存 Draft 失败', description: e?.message || '下書きの保存に失敗しました', confirmText: '知道了', hideCancel: true });
    }
  };

  const handleReleaseRepair = async () => {
    if (!currentApp || repairingRelease) return;
    setRepairSessionActive(true);
    setRepairingRelease(true);
    setPublishFlowActive(true);
    setPublishingAppId(currentApp.id);
    setPublishingAppSnapshot(currentApp);
    setPublishProgress({
      status: 'publishing',
      current_step: null,
      error_message: null,
      steps: [{
        id: 'verify',
        label: '正在修复发布问题',
        order: 1,
        status: 'running',
        detail: '正在执行 release repair，并重新检查 verifier。',
        updated_at: new Date().toISOString(),
      }],
    });
    setRepairProgressOpen(true);
    try {
      const result = await api.releaseRepair(currentApp.id);
      const refreshed = await api.getPublishStatus(currentApp.id).catch(() => currentApp);
      const reportSummary = [
        result.report?.summary,
        ...(result.report?.blockingFailures || []).map(check => check.detail || check.label),
      ].filter((line): line is string => !!line && !!line.trim());
      setRepairReadyToRepublish(!!result.repaired);
      setRepairReportSummary(reportSummary);
      syncPublishStateIntoCurrentApp(refreshed as App);
      setPublishFlowActive(true);
      setPublishingAppId(currentApp.id);
      setPublishingAppSnapshot(refreshed as App);
      if (result.repaired) {
        setPublishProgress({
          status: 'publishing',
          current_step: null,
          error_message: null,
          steps: [{
            id: 'verify',
            label: '发布问题已修复',
            order: 1,
            status: 'completed',
            detail: '修复完成，正在自动重新发布。',
            updated_at: new Date().toISOString(),
          }],
        });
        setRepairProgressOpen(true);
        await startPublishFlow(refreshed as App);
        return;
      }
      setPublishProgress({
        status: 'failed',
        current_step: null,
        error_message: result.error || result.message || '修复未通过 verifier',
        steps: [{
          id: 'verify',
          label: '发布问题修复失败',
          order: 1,
          status: 'failed',
          detail: reportSummary[0] || result.error || result.message || '仍有阻塞问题未修复。',
          updated_at: new Date().toISOString(),
        }],
      });
      setRepairProgressOpen(true);
    } catch (e: any) {
      setRepairReadyToRepublish(false);
      setRepairReportSummary([]);
      setPublishFlowActive(true);
      setPublishingAppId(currentApp.id);
      setPublishingAppSnapshot(currentApp);
      setPublishProgress({
        status: 'failed',
        current_step: null,
        error_message: e?.message || '修复发布问题失败',
        steps: [],
      });
      setRepairProgressOpen(true);
    } finally {
      setRepairingRelease(false);
    }
  };

  const startPublishFlow = async (app: App) => {
    setRepairSessionActive(false);
    setRepairProgressOpen(false);
    if (app.release_state === 'failed') {
      const reset = await api.resetFailedPublish(app.id);
      syncPublishStateIntoCurrentApp(reset);
      app = { ...app, ...reset };
    }
    const publishingApp = { ...app, release_state: 'candidate' as const, publish_status: 'publishing' as const, stage_reason: 'candidate release requested; waiting for pipeline' };
    setPublishFlowActive(true);
    setPublishingAppId(app.id);
    setPublishingAppSnapshot(publishingApp);
    setPublishPendingSince(Date.now());
    syncPublishStateIntoCurrentApp(publishingApp);
    setPublishProgress({
      status: 'publishing',
      current_step: null,
      error_message: null,
      steps: [],
    });
    setPublishProgressOpen(true);
    const updated = await api.publishApp(app.id);
    setPublishingAppSnapshot(updated);
    if (updated.release_state === 'candidate' || updated.publish_status === 'publishing') setPublishPendingSince(null);
    syncPublishStateIntoCurrentApp(updated);
    setPublishProgress(updated.publish_progress || null);
  };

  const publishForUse = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!currentApp) return;
    if (isCurrentAppPublishing) {
      setPublishFlowActive(true);
      setPublishingAppId(currentApp.id);
      setPublishingAppSnapshot(prev => prev || currentApp);
      setPublishProgressOpen(true);
      return;
    }
    const ok = !!currentApp.name?.trim() && !!currentApp.icon?.trim() && !!currentApp.description?.trim();
    if (!ok) {
      setPublishDialogMode('publish');
      setPublishOpen(true);
      return;
    }
    try {
      if (currentApp.release_state === 'failed' && !repairReadyToRepublish) {
        const verifier = await api.verifierReport(currentApp.id).catch(() => null);
        const blockingFailures = verifier?.report?.blockingFailures || [];
        if (blockingFailures.length > 0) {
          setRepairReadyToRepublish(false);
          setRepairReportSummary(blockingFailures.map(check => check.detail || check.label).filter(Boolean));
          setPublishFlowActive(true);
          setPublishingAppId(currentApp.id);
          setPublishingAppSnapshot(currentApp);
          setPublishProgress({
            status: 'failed',
            current_step: null,
            error_message: '当前仍有未修复的发布问题，请先继续修复。',
            steps: [],
          });
          setPublishProgressOpen(true);
          return;
        }
        setRepairReadyToRepublish(true);
      }
      setRepairReadyToRepublish(false);
      setRepairReportSummary([]);
      await startPublishFlow(currentApp);
    } catch (e: any) {
      const failedApp = { ...currentApp, release_state: 'failed' as const, publish_status: 'failed' as const, stage_reason: e?.message || '发布失败' };
      setPublishFlowActive(true);
      setPublishPendingSince(null);
      setPublishingAppSnapshot(failedApp);
      syncAppIntoState(failedApp);
      setPublishProgress({
        status: 'failed',
        current_step: null,
        error_message: e?.message || '发布失败',
        steps: [],
      });
      setPublishProgressOpen(true);
    } finally {
      // overlay closes from polling when publish reaches terminal state
    }
  };

  const submitForReview = async () => {
    if (!currentApp) return;
    if (currentApp.release_state !== 'live' && currentApp.release_state !== 'rollback') {
      setFeedbackModal({ tone: 'warning', title: '当前不可提审', description: '提审仅适用于 Live / Rollback 状态的 app，请先完成发布。', confirmText: '知道了', hideCancel: true });
      return;
    }
    if (currentApp.review_status === 'pending') {
      setFeedbackModal({ tone: 'info', title: '已在提审中', description: '这个 app 已经提交审核，目前正在等待管理侧处理。', confirmText: '知道了', hideCancel: true });
      return;
    }
    try {
      const updated = await api.submitReview(currentApp.id);
      setCurrentApp({ ...updated, preview_port: previewPort, preview_url: previewUrl });
      fetchApps();
      setFeedbackModal({ tone: 'success', title: '提审已提交', description: '已经提交给管理侧审核，请等待审核结果。', confirmText: '知道了', hideCancel: true });
    } catch (e: any) {
      setFeedbackModal({ tone: 'danger', title: '提审失败', description: e?.message || '提审失败（请确认当前账号有编辑权限）', confirmText: '知道了', hideCancel: true });
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

  const workspaceImmersive = activeTab === 'workspace' && !!currentApp;

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">

      {/* ── Header ── */}
      {!workspaceImmersive && <header className="border-b bg-white sticky top-0 z-50">
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
                      onClick={() => { navigate('/profile'); setUserMenuOpen(false); }}
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
                        navigate('/');
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
      </header>}

      <main className={workspaceImmersive ? "h-screen" : "h-[calc(100vh-73px)]"}>

        {/* ═══ WORKSPACE ═══════════════════════════════════════════ */}
        {activeTab === "workspace" && (
          !currentApp ? (
            <div className="h-full overflow-y-auto bg-gradient-to-br from-slate-50/50 via-white to-blue-50/30">
              <div className="max-w-7xl mx-auto px-6 py-16">
                <div className="flex items-end justify-between mb-12 gap-6">
                  <div className="space-y-3">
                    <h1 className="text-4xl font-bold leading-tight">ワークスペース</h1>
                    <p className="text-muted-foreground text-base">あなたのアプリを管理・編集</p>
                  </div>
                  <Button size="lg" className="gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 shrink-0"
                    onClick={() => createNewApp()}>
                    <Plus className="w-5 h-5" /> 新規アプリ作成
                  </Button>
                </div>

                {appsLoading ? (
                  <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
                ) : workspaceGroups.length === 0 ? (
                  <div className="text-center py-24 text-muted-foreground">
                    <div className="text-6xl mb-4">✨</div>
                    <p className="text-lg font-medium mb-2">編集できるアプリがありません</p>
                    <p className="text-sm mb-6">{user ? 'ストアで「自分用に編集」して追加してください' : 'ゲストはストアで生成・試用できます。編集はログイン後に可能です'}</p>
                    <Button onClick={() => user ? navigate('/market') : navigate(buildLoginUrl())}>{user ? t('appStore') : t('loginRegister')}</Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {workspaceGroups.map(group => {
                      const releaseApp = group.release;
                      const draftApp = group.draft;
                      const primaryApp = draftApp || releaseApp;
                      if (!primaryApp) return null;
                      const canOpenPrimary = !!((draftApp && canEditApp(draftApp as any, user)) || (releaseApp && canEditApp(releaseApp as any, user)));
                      const publishMeta = getPublishStatusMeta(releaseApp || draftApp);
                      return (
                        <Card key={group.key}
                          className="group hover:shadow-xl hover:-translate-y-2 transition-all duration-300 border bg-white relative overflow-hidden">
                          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-purple-500/0 group-hover:from-blue-500/5 group-hover:to-purple-500/5 transition-all duration-300" />
                          <CardContent className="p-6 relative space-y-4">
                            <div className="flex items-start gap-4">
                              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shrink-0 shadow-sm group-hover:scale-110 transition-transform duration-300"
                                style={primaryApp.color ? appIconStyle(primaryApp.color) : undefined}>
                                {primaryApp.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="font-bold text-xl mb-2 group-hover:text-primary transition-colors truncate">{primaryApp.name}</h3>
                                <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                                  <span>v{releaseApp?.current_version || draftApp?.current_version || primaryApp.current_version}</span>
                                  <span>·</span>
                                  <span>{new Date(group.latestUpdatedAt).toLocaleDateString('ja-JP')}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant={(releaseApp?.release_state || 'draft') === 'live' ? 'default' : 'secondary'} className={cn(publishMeta.badgeClass)}>
                                {publishMeta.label}
                              </Badge>
                              {draftApp && releaseApp && (
                                <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">Linked Draft</Badge>
                              )}
                            </div>
                            {draftApp && releaseApp && (
                              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                这是与 Release 联动的 Workspace 草稿。编辑完成后，会从 Workspace 进入 Live → Candidate 升级发布。
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              {releaseApp && getPreviewUrl(releaseApp) && (releaseApp.release_state === 'live' || releaseApp.release_state === 'rollback') && (
                                <Button size="sm" className="flex-1 gap-1 bg-indigo-600 hover:bg-indigo-700"
                                  onClick={e => {
                                    e.stopPropagation();
                                    const u = getPreviewUrl(releaseApp);
                                    if (u) { setActiveTab('workspace'); setPreviewTab('preview'); openApp(app.id, 'store'); }
                                  }}>
                                  <ArrowUp className="w-3 h-3 rotate-45" /> 使用
                                </Button>
                              )}
                              <Button size="sm" variant="outline" className="gap-1 flex-1"
                                disabled={!canOpenPrimary || primaryApp.release_state === 'candidate'}
                                title={!canOpenPrimary ? '編集権限がありません（先に「自分用に編集」）' : undefined}
                                onClick={e => {
                                  e.stopPropagation();
                                  if (draftApp) openApp(draftApp.id);
                                  else if (releaseApp && isPublishedReleaseApp(releaseApp)) openWorkspaceDraftForRelease(releaseApp.id);
                                  else if (releaseApp) openApp(releaseApp.id);
                                }}>
                                <Edit3 className="w-3 h-3" /> {draftApp ? 'Draft を編集' : '編集'}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={e => deleteApp(primaryApp.id, e)}>
                                <Trash2 className="w-4 h-4 text-red-400" />
                              </Button>
                            </div>
                          </CardContent>
                          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
                        </Card>
                      );
                    })}
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
            <div className="h-full flex flex-col bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.06),transparent_35%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.04),transparent_28%),#f8fafc]">
              {/* Version bar */}
              <div className="border-b border-slate-200/80 bg-white/80 backdrop-blur px-6 py-3 flex items-center gap-3 overflow-x-auto shrink-0 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                <Button size="sm" variant="ghost" className="shrink-0" onClick={() => {
                  if (isStreaming) stopStreaming();
                  setCurrentApp(null);
                  const target = workspaceBackTab === 'workspace' ? '/workspace' : tabToPath(workspaceBackTab);
                  navigate(target);
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
              <div className="flex-1 flex overflow-hidden px-4 pb-4 gap-4">

                {/* Left: Chat */}
                <div className="flex flex-col rounded-2xl border border-slate-200/80 bg-white/90 backdrop-blur shadow-[0_18px_50px_rgba(15,23,42,0.08)] overflow-hidden" style={{ width: `calc(100% - ${previewWidth}px)` }}>
                  {/* Chat header */}
                  <div className="border-b border-slate-200/80 bg-white/80 backdrop-blur px-6 py-4 flex items-center justify-between shrink-0">
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
                              ? <span className="text-xs text-muted-foreground">Workspace 内プレビュー実行中</span>
                              : <span className="text-xs text-muted-foreground">編集中</span>
                          }
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" type="button" variant="outline" className="gap-1"
                        disabled={!currentAppEditable}
                        title={!currentAppEditable ? '編集権限がありません' : '属性（アイコン・色・名前・説明）を编辑'}
                        onClick={() => { if (currentAppEditable) { setPublishDialogMode('edit'); setPublishOpen(true); } }}>
                        <Edit3 className="w-4 h-4" /> {t('editProps')}
                      </Button>
                      {isLinkedWorkspaceDraft(currentApp, editableApps) && (
                        <Button size="sm" type="button" variant="outline" className="gap-1" onClick={saveDraft}>
                          <Save className="w-4 h-4" />
                          Save
                        </Button>
                      )}
                      {currentApp.release_state === 'failed' && (
                        <Button size="sm" type="button" variant="outline" className="gap-1 border-amber-300 text-amber-700" disabled={repairingRelease} onClick={handleReleaseRepair}>
                          <Sparkles className={`w-4 h-4 ${repairingRelease ? 'animate-spin' : ''}`} />
                          {repairingRelease ? '正在修复发布问题…' : '修复发布问题'}
                        </Button>
                      )}
                      <Button size="sm"
                        type="button"
                        className="gap-1 bg-green-600 hover:bg-green-700"
                        title={currentApp.release_state === 'failed' && !repairReadyToRepublish ? '如果刚修复完但按钮还没解锁，点击这里会自动重新检查后再发布' : undefined}
                        onClick={publishForUse}>
                        <ArrowUp className="w-4 h-4" />
                        {isCurrentAppPublishing
                          ? '查看 Candidate 验证进度'
                          : currentApp.release_state === 'failed'
                            ? '修复后重新发布'
                            : currentApp.release_state === 'rollback'
                              ? 'Rollback → Candidate'
                              : currentApp.release_state === 'live'
                                ? 'Live → Candidate'
                                : 'Draft → Candidate'}
                      </Button>
                    </div>
                  </div>

                  {isPublishFlowVisibleForCurrentApp && (
                    <div className="mx-6 mt-4 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-teal-50 px-4 py-4 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {publishProgress?.status === 'completed' ? (
                              <span className="text-emerald-600">✅</span>
                            ) : (
                              <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
                            )}
                            <div className="text-sm font-semibold text-slate-900">正在发布中</div>
                          </div>
                          <div className="text-xs text-slate-600 leading-6">
                            {currentRepairStep?.detail || '当前正在执行发布流程：生成 Candidate → 启动并检查 Candidate 环境 → 发布验证 → 发布完成。'}
                          </div>
                          {!!(publishProgress?.steps || []).length && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(publishProgress?.steps || []).map(step => (
                                <div key={step.id} className={cn(
                                  'rounded-full border px-2.5 py-1 text-[11px] font-medium',
                                  step.status === 'running' ? 'border-emerald-300 bg-emerald-100 text-emerald-800' :
                                  step.status === 'completed' ? 'border-teal-300 bg-teal-100 text-teal-800' :
                                  step.status === 'failed' ? 'border-red-300 bg-red-100 text-red-800' :
                                  'border-slate-200 bg-white text-slate-600'
                                )}>
                                  {step.label}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 flex flex-wrap gap-2 justify-end">
                          <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setPublishProgressOpen(true)}>
                            打开发布面板
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {isRepairFlowVisibleForCurrentApp && (
                    <div className="mx-6 mt-4 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-orange-50 px-4 py-4 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-3">
                            {repairingRelease || publishProgress?.status === 'publishing' ? (
                              <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
                            ) : publishProgress?.status === 'failed' ? (
                              <span className="text-red-600">⚠️</span>
                            ) : repairReadyToRepublish ? (
                              <span className="text-emerald-600">✅</span>
                            ) : (
                              <span className="text-amber-600">🛠️</span>
                            )}
                            <div className="text-sm font-semibold text-slate-900">
                              {repairingRelease || publishProgress?.status === 'publishing'
                                ? 'AI 正在修复发布问题'
                                : publishProgress?.status === 'failed'
                                  ? '发布问题修复失败'
                                  : repairReadyToRepublish
                                    ? '发布问题已修复'
                                    : 'AI 修复发布问题'}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
                            <div className="text-xs font-semibold text-slate-900 mb-2">问题</div>
                            {!!repairReportSummary.length ? (
                              <ul className="m-0 pl-5 space-y-1 text-xs text-slate-700">
                                {repairReportSummary.slice(0, 3).map(line => <li key={line}>{line}</li>)}
                              </ul>
                            ) : (
                              <div className="text-xs text-slate-600 leading-6">{publishProgress?.error_message || '正在收集当前需要修复的问题…'}</div>
                            )}
                          </div>
                          <div className={cn(
                            'mt-3 rounded-2xl border px-4 py-3 text-xs font-medium',
                            repairingRelease || publishProgress?.status === 'publishing' ? 'border-amber-200 bg-amber-50 text-amber-800' :
                            publishProgress?.status === 'failed' ? 'border-red-200 bg-red-50 text-red-700' :
                            'border-emerald-200 bg-emerald-50 text-emerald-700'
                          )}>
                            {repairingRelease || publishProgress?.status === 'publishing' ? '正在修复…' : publishProgress?.status === 'failed' ? '修复失败' : '修复完成'}
                          </div>
                        </div>
                        <div className="shrink-0 flex flex-wrap gap-2 justify-end">
                          {(repairingRelease || publishProgress?.status === 'publishing' || publishProgress?.status === 'failed' || repairReadyToRepublish) && (
                            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setRepairProgressOpen(true)}>
                              打开 AI 修复面板
                            </Button>
                          )}
                          {repairReadyToRepublish && currentAppEditable && (
                            <Button size="sm" className="rounded-xl bg-emerald-600 hover:bg-emerald-700" onClick={publishForUse}>
                              重新发布
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-[linear-gradient(180deg,rgba(248,250,252,0.8),rgba(255,255,255,0.95))]">
                    {messages.length === 0 && !isStreaming && !planning && (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm flex items-center justify-center font-semibold shrink-0 text-xs">AI</div>
                        <Card className="max-w-2xl border border-slate-200 bg-white/95 shadow-sm rounded-2xl">
                          <CardContent className="p-4 text-sm text-slate-600">
                            {t('msgInput')}
                          </CardContent>
                        </Card>
                      </div>
                    )}

                    {messages.map(msg => (
                      <div key={msg.id} className={cn("flex gap-3", msg.role === 'user' && "justify-end")}>
                        {msg.role === 'assistant' && (
                          <div className="w-8 h-8 rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm flex items-center justify-center font-semibold shrink-0 text-xs">AI</div>
                        )}
                        <div className={cn(
                          "max-w-2xl",
                          msg.role === 'user' && !parseReqCard(msg.content)
                            ? "rounded-2xl px-4 py-3 text-sm border border-zinc-800 bg-zinc-950 text-white"
                            : ""
                        )}>
                          {(() => {
                            const card = parseReqCard(msg.content);
                            if (card) {
                              return (
                                <Card className="border border-slate-200 bg-white/95 text-slate-900 shadow-sm rounded-2xl">
                                  <CardContent className="p-3 space-y-2">
                                    <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold">
                                      <Sparkles className="w-3.5 h-3.5" /> 需求已接收
                                    </div>
                                    <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{card.text}</p>
                                    {card.answers?.length > 0 && (
                                      <details className="group">
                                        <summary className="text-[11px] text-zinc-400 cursor-pointer list-none select-none inline-flex items-center gap-1">
                                          <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" />
                                          条件を表示 / 非表示
                                        </summary>
                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                          {card.answers.map((a, i) => (
                                            <span key={i} className="px-2 py-1 rounded-md text-[11px] bg-slate-100 border border-slate-200 text-slate-700">
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
                            if (msg.role === 'user') return <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>;
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
                        <Card className="max-w-2xl border border-slate-200 bg-white/95 shadow-sm rounded-2xl">
                          <CardContent className="p-3">
                            <p className="text-xs font-semibold text-sky-700">funfo AI</p>
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
                          <CardContent className="p-4 flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl border border-sky-200 bg-sky-50 text-sky-700 flex items-center justify-center shadow-sm">
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
                        <Card className="max-w-2xl w-full border border-slate-200 bg-white/95 shadow-sm rounded-2xl">
                          <CardContent className="p-4 space-y-4">
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500 mb-2 font-semibold">開発ステップ</p>
                              <ol className="text-xs space-y-2 text-slate-700">
                                {planSteps.map((s, i) => <li key={i} className="list-none flex items-start gap-2"><span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 border border-slate-200">{i+1}</span><span>{s}</span></li>)}
                              </ol>
                            </div>
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500 mb-2 font-semibold">生成要求</p>
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
                                            'px-3 py-1.5 rounded-full text-[11px] border transition shadow-sm',
                                            q.answer === op
                                              ? 'bg-slate-900 text-white border-slate-900'
                                              : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400 hover:bg-slate-50'
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
                                <MixerHorizontalIcon className="w-3.5 h-3.5 mr-1" /> 追加要望
                              </Button>
                              <span className="text-[11px] text-slate-500">任意入力</span>
                            </div>
                            {showExtraRequirement && (
                              <textarea
                                value={extraRequirement}
                                onChange={e => setExtraRequirement(e.target.value)}
                                className="w-full min-h-[88px] px-3 py-3 text-xs border border-slate-200 rounded-xl bg-slate-50/70 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
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
                                <MagicWandIcon className="w-3 h-3" /> 生成を開始
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
                                <CodeIcon className="w-3 h-3 mr-1" /> 直接进行开发
                              </Button>
                              <span className="text-xs text-slate-500">{questionnaire.some(q => !q.answer) ? '未選択でも「直接进行开发」で開始できます' : '準備完了。開始できます'}</span>
                            </div>

                            <div className="flex items-center gap-2 pt-3 border-t border-slate-200">
                              <span className="text-xs text-slate-500">{t('designPattern')}</span>
                              <select
                                value={designPatternId}
                                onChange={e => setDesignPatternId(e.target.value)}
                                className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white shadow-sm"
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
                                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-zinc-200 rounded-lg">
                                  {[0,1,2].map(i => (
                                    <span key={i} className="w-1.5 h-1.5 rounded-full bg-zinc-900 animate-bounce" style={{ animationDelay: `${i*0.12}s` }} />
                                  ))}
                                  <span className="text-xs font-mono text-zinc-900">右のエディタでコード生成中...</span>
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
                          <GenerationStepCard stage={generateStage} />
                        </div>
                      </div>
                    )}

                    <div ref={chatEndRef} />
                  </div>

                  {/* Input */}
                  <div className="border-t border-slate-200/80 bg-white/85 backdrop-blur p-4 shrink-0 space-y-3">
                    <ModeSwitcher
                      value={workspaceMode}
                      onChange={setWorkspaceMode}
                      getMeta={getWorkspaceModeMeta}
                      disabled={isStreaming || autoFixing || planning || !!pendingGeneration}
                    />
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="text-xs font-medium text-slate-500">生成模型</div>
                      <select
                        value={selectedAiModel?.key || ''}
                        onChange={e => handleAiModelSelect(e.target.value)}
                        disabled={isStreaming || autoFixing || planning || !!pendingGeneration || loadingPublicModels || publicModels.length === 0}
                        className="border border-slate-200 rounded-lg px-3 py-2 bg-white text-sm min-w-[220px]"
                      >
                        {publicModels.length === 0 && <option value="">暂无可用模型</option>}
                        {publicModels.map(model => (
                          <option key={model.key} value={model.key}>{model.providerLabel} / {model.name}</option>
                        ))}
                      </select>
                      <span className="text-[11px] text-slate-400">
                        {loadingPublicModels ? '正在同步平台模型…' : selectedAiModel ? `${selectedAiModel.providerLabel} / ${selectedAiModel.name}` : '平台尚未开放模型'}
                      </span>
                    </div>
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
                        {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <PaperPlaneIcon className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Resize handle */}
                <div className="w-2 rounded-full bg-slate-200/80 hover:bg-sky-400 cursor-ew-resize transition-colors relative group shrink-0 my-8" onMouseDown={handleMouseDown}>
                  <div className="absolute inset-y-0 -left-2 -right-2 flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-muted rounded-full p-1">
                      <GripVertical className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                </div>

                {/* Right: Preview / Live Code Editor */}
                <div className="flex flex-col shrink-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 backdrop-blur shadow-[0_18px_50px_rgba(15,23,42,0.08)]" style={{ width: `${previewWidth}px` }}>
                  {/* Toolbar */}
                  <div className={cn(
                    "border-b px-3 py-2 shrink-0 flex items-center justify-between transition-colors",
                    (isStreaming || autoFixing) ? "bg-[#161b22]" : "bg-white"
                  )}>
                    <div className="flex items-center gap-2">
                      {(isStreaming || autoFixing) ? (
                        <span className="text-xs font-mono text-slate-400 px-2 py-1">EDITOR</span>
                      ) : (
                        <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50/90 p-1 shadow-sm">
                          <button
                            onClick={() => setPreviewTab('preview')}
                            className={cn("text-xs px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5",
                              previewTab === 'preview' ? "bg-white text-slate-900 shadow-sm border border-slate-200" : "text-slate-500 hover:text-slate-700")}>
                            <EyeOpenIcon className="w-3.5 h-3.5" /> 视觉
                          </button>
                          <button
                            onClick={async () => {
                              setPreviewTab('assets');
                              if (currentApp) await loadAppFiles(currentApp.id);
                            }}
                            className={cn("text-xs px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5",
                              previewTab === 'assets' ? "bg-white text-slate-900 shadow-sm border border-slate-200" : "text-slate-500 hover:text-slate-700")}>
                            <FileIcon className="w-3.5 h-3.5" /> 文件
                          </button>
                          <button
                            onClick={() => setPreviewTab('errors')}
                            className={cn("text-xs px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5",
                              previewTab === 'errors' ? "bg-white text-red-700 shadow-sm border border-red-200" : "text-slate-500 hover:text-slate-700")}>
                            <ExclamationTriangleIcon className="w-3.5 h-3.5" /> 错误
                            {appErrors.length > 0 && (
                              <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-bold",
                                previewTab === 'errors' ? "bg-red-200 text-red-700" : "bg-red-500 text-white")}>
                                {appErrors.length}
                              </span>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {!isStreaming && !autoFixing && previewTab === 'preview' && (['mobile', 'laptop', 'desktop'] as DeviceType[]).map(d => (
                        <Button key={d} size="sm" variant={deviceType === d ? "default" : "ghost"}
                          onClick={() => setDeviceType(d)} className="w-9 h-9 p-0 rounded-xl border border-transparent">
                          {d === 'mobile' ? <Smartphone className="w-4 h-4" /> : d === 'laptop' ? <Laptop className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                        </Button>
                      ))}
                      {previewUrl && !isStreaming && !autoFixing && previewTab === 'preview' && (
                        <Button size="sm" variant="ghost" className="w-8 h-8 p-0" onClick={() => {
                          if (!requireLoginForFullscreen()) return;
                          setActiveTab('workspace'); setPreviewTab('preview');
                        }}>
                          <ArrowUp className="w-3 h-3 rotate-45" />
                        </Button>
                      )}
                      {previewTab === 'errors' && appErrors.length > 0 && (
                        <Button size="sm" variant="ghost" className="text-xs h-8 px-3 rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50"
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
                  ) : previewTab === 'assets' ? (
                    <div className="flex-1 min-h-0 flex flex-col bg-white">
                      <div className="flex-1 min-h-0 grid grid-cols-[300px_minmax(0,1fr)]">
                          <div className="border-r border-slate-200/80 overflow-auto p-3 text-sm bg-slate-50/70">
                            {appFiles.length === 0 ? <div className="text-slate-500 text-xs">暂无文件</div> : null}
                            {(() => {
                              const renderNode = (node: AppFileNode, depth = 0): any => {
                                const isDir = node.type === 'dir';
                                const expanded = !!expandedDirs[node.path];
                                return <div key={node.path}>
                                  <button className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 transition" style={{ paddingLeft: `${10 + depth * 14}px` }} onClick={async () => {
                                    if (isDir) setExpandedDirs(prev => ({ ...prev, [node.path]: !expanded }));
                                    else if (currentApp) await openAppFile(currentApp.id, node.path);
                                  }}>
                                    {isDir ? (expanded ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />) : <FileIcon className="w-3.5 h-3.5 text-slate-400" />}
                                    <span className={cn('truncate', !isDir && selectedFilePath === node.path ? 'text-sky-700 font-medium' : 'text-slate-700')}>{node.name}</span>
                                  </button>
                                  {isDir && expanded && (node.children || []).map(child => renderNode(child, depth + 1))}
                                </div>;
                              };
                              return appFiles.map(node => renderNode(node));
                            })()}
                          </div>
                          <div className="min-w-0 overflow-auto bg-white">
                            <div className="border-b border-slate-200/80 px-4 py-3 bg-slate-50/80 backdrop-blur">
                              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500 font-semibold">Current file</div>
                              <div className="mt-1 text-sm font-medium text-slate-900 truncate">{selectedFilePath || 'No file selected'}</div>
                            </div>
                            <pre className="text-xs text-slate-700 p-4 whitespace-pre-wrap break-words font-mono leading-relaxed">{selectedFilePath ? selectedFileContent || '// empty file' : '请选择左侧文件查看详情'}</pre>
                          </div>
                        </div>
                    </div>
                  ) : previewTab === 'errors' ? (
                    /* ── Error Log Panel ── */
                    <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4">
                      {appErrors.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3 rounded-2xl border border-dashed border-slate-200 bg-white/80">
                          <div className="text-4xl">✅</div>
                          <p className="text-sm font-medium">エラーはありません</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500 font-semibold">Diagnostics</div>
                              <div className="mt-1 text-sm font-medium text-slate-900">{appErrors.length} 件のエラー</div>
                            </div>
                            <Button size="sm"
                              disabled={!currentAppCanAutoFix || autoFixing}
                              className="gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs h-8 rounded-xl disabled:opacity-60"
                              title={!currentAppCanAutoFix ? 'この Workspace の所有者のみ自動修正できます' : undefined}
                              onClick={async () => {
                                if (appErrors.length === 0 || autoFixing || !currentAppCanAutoFix) return;
                                await runAutoFix(appErrors[0]);
                              }}>
                              <MagicWandIcon className="w-3.5 h-3.5" /> AIで自動修正
                            </Button>
                          </div>
                          {appErrors.map((err, i) => (
                            <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full border",
                                  err.type === 'NetworkError' ? "bg-orange-50 text-orange-700 border-orange-200" :
                                  err.type === 'APIError' ? "bg-amber-50 text-amber-700 border-amber-200" :
                                  "bg-red-50 text-red-700 border-red-200")}>
                                  {err.type}
                                </span>
                                <span className="text-xs text-slate-400 shrink-0">
                                  {new Date(err.time).toLocaleTimeString('ja-JP')}
                                </span>
                              </div>
                              <p className="text-sm text-slate-900 font-medium break-all">{err.message}</p>
                              {err.detail && (
                                <pre className="text-xs text-slate-500 mt-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed rounded-xl bg-slate-50 border border-slate-200 p-3">
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
                      previewSubPath={previewSubPath}
                      refreshKey={previewRefreshKey}
                      deviceType={deviceType}
                      onOpenExternal={() => {
                        if (!requireLoginForFullscreen()) return;
                        if (!previewUrl) return;
                        setActiveTab('workspace'); setPreviewTab('preview');
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
                          <div className="flex items-center gap-3 flex-wrap">
                            {selectedStoreApp ? (
                              <div className="flex items-center gap-2 text-sm text-primary font-medium">
                                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                <span className="truncate max-w-[280px]">{selectedStoreApp}</span>
                                <button
                                  onClick={() => { setSelectedStoreApp(null); setStoreInput(''); }}
                                  className="ml-1 text-slate-400 hover:text-slate-600 transition-colors text-xs">✕ クリア</button>
                              </div>
                            ) : null}
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-slate-500">模型</span>
                              <select
                                value={selectedAiModel?.key || ''}
                                onChange={e => handleAiModelSelect(e.target.value)}
                                disabled={loadingPublicModels || publicModels.length === 0}
                                className="border border-slate-200 rounded-lg px-3 py-2 bg-white text-sm min-w-[220px]"
                              >
                                {publicModels.length === 0 && <option value="">暂无可用模型</option>}
                                {publicModels.map(model => (
                                  <option key={model.key} value={model.key}>{model.providerLabel} / {model.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <Button size="lg" className="gap-2 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
                            disabled={!storeInput.trim() || publicModels.length === 0} onClick={() => createNewApp(storeInput)}>
                            <Sparkles className="w-5 h-5" /> 生成開始
                          </Button>
                        </div>
                        <div className="mt-3 text-[11px] text-slate-400 text-left">
                          {loadingPublicModels ? '正在同步平台模型…' : selectedAiModel ? `当前将使用 ${selectedAiModel.providerLabel} / ${selectedAiModel.name}` : '平台管理员尚未开放生成模型'}
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
            <div className="max-w-7xl mx-auto px-6 py-16">
              <div className="flex items-end justify-between mb-12 gap-6">
                <div className="space-y-3">
                  <h1 className="text-4xl font-bold leading-tight">Appストア</h1>
                  <p className="text-muted-foreground text-base">这里是公开中的 SaaS App 平台。你可以直接进入并使用已审核通过的 App。</p>
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
                  .filter(a => (a.release_state || 'draft') === 'live')
                  .filter(a => (a.review_status || 'none') === 'approved')
                  .filter(a => (a.status || 'draft') === 'published')
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
                            <Button size="sm" className="gap-1 w-full" onClick={() => {
                              if (!consumeGuestTrial()) return;
                              const u = getPreviewUrl(app);
                              if (u) {
                                window.open(u, '_blank', 'noopener,noreferrer');
                              }
                            }}>
                              <ArrowUp className="w-3 h-3 rotate-45" /> 使用 app
                            </Button>
                          )}
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
          <MyAppsPanel
            appsLoading={appsLoading}
            myAppsGroups={myAppsGroups}
            user={user}
            currentApp={currentApp}
            setApps={setApps}
            setCurrentApp={setCurrentApp}
            setActiveTab={setActiveTab}
            createNewApp={() => createNewApp()}
            openApp={openApp}
            openWorkspaceDraftForRelease={openWorkspaceDraftForRelease}
            deleteApp={deleteApp}
            canEditApp={canEditApp}
            isPublishedReleaseApp={isPublishedReleaseApp}
            getPreviewUrl={getPreviewUrl}
            getPublishStatusMeta={getPublishStatusMeta}
            appIconStyle={appIconStyle}
          />
        )}

      </main>

      {repairProgressOpen && currentApp && (
        <div className="fixed inset-0 z-[88] bg-slate-950/35 backdrop-blur-[3px] flex items-center justify-center px-6">
          <Card className="w-full max-w-xl border-0 shadow-2xl overflow-hidden">
            <CardContent className="p-0">
              <div className="bg-gradient-to-r from-amber-50 via-white to-orange-50 px-6 py-5 border-b border-amber-200">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2">
                    {repairingRelease || publishProgress?.status === 'publishing' ? <Loader2 className="w-5 h-5 text-amber-600 animate-spin" /> : publishProgress?.status === 'failed' ? <span className="text-red-600 text-lg">⚠️</span> : repairReadyToRepublish ? <span className="text-emerald-600 text-lg">✅</span> : <span className="text-amber-600 text-lg">🛠️</span>}
                    <h3 className="text-lg font-semibold text-slate-900">
                      {repairingRelease || publishProgress?.status === 'publishing' ? 'AI 正在修复发布问题' : publishProgress?.status === 'failed' ? '发布问题修复失败' : repairReadyToRepublish ? '发布问题已修复' : 'AI 修复发布问题'}
                    </h3>
                  </div>
                  <Button type="button" variant="outline" className="rounded-xl" onClick={() => setRepairProgressOpen(false)}>关闭</Button>
                </div>
              </div>
              <div className="px-6 py-5 space-y-4 bg-white">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-sm font-semibold text-slate-900 mb-2">问题</div>
                  {!!repairReportSummary.length ? (
                    <ul className="m-0 pl-5 space-y-1 text-sm text-slate-700">
                      {repairReportSummary.map(line => <li key={line}>{line}</li>)}
                    </ul>
                  ) : (
                    <div className="text-sm text-slate-600">{publishProgress?.error_message || '正在收集当前需要修复的问题…'}</div>
                  )}
                </div>

                <div className={cn(
                  'rounded-2xl border px-4 py-3 text-sm font-medium',
                  repairingRelease || publishProgress?.status === 'publishing' ? 'border-amber-200 bg-amber-50 text-amber-800' :
                  publishProgress?.status === 'failed' ? 'border-red-200 bg-red-50 text-red-700' :
                  'border-emerald-200 bg-emerald-50 text-emerald-700'
                )}>
                  {repairingRelease || publishProgress?.status === 'publishing' ? '正在修复…' : publishProgress?.status === 'failed' ? '修复失败' : '修复完成'}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  {repairReadyToRepublish && currentAppEditable && (
                    <Button type="button" className="rounded-xl bg-emerald-600 hover:bg-emerald-700" onClick={() => { setRepairProgressOpen(false); publishForUse(); }}>
                      重新发布
                    </Button>
                  )}
                  {publishProgress?.status === 'failed' && currentAppEditable && (
                    <Button type="button" variant="outline" className="rounded-xl" disabled={repairingRelease} onClick={handleReleaseRepair}>
                      再试一次修复
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {publishProgressOpen && publishDialogApp && (
        <div className="fixed inset-0 z-[90] bg-slate-950/45 backdrop-blur-[2px] flex items-center justify-center px-6">
          <Card className="w-full max-w-lg border-0 shadow-2xl">
            <CardContent className="p-7">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-2xl text-2xl flex items-center justify-center" style={appIconStyle(publishDialogApp.color)}>{publishDialogApp.icon || '🚀'}</div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      {publishProgress?.status === 'failed' ? (
                        <span className="text-red-600 text-lg">⚠️</span>
                      ) : publishProgress?.status === 'completed' ? (
                        <span className="text-emerald-600 text-lg">✅</span>
                      ) : (
                        <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
                      )}
                      <h3 className="text-lg font-semibold text-slate-900">
                        {publishProgress?.status === 'failed' ? '发布失败' : publishProgress?.status === 'completed' ? '发布完成' : '正在发布应用'}
                      </h3>
                    </div>
                    {publishProgress?.status !== 'failed' && publishProgress?.status !== 'completed' && (
                      <Button type="button" variant="outline" className="h-9 rounded-xl" onClick={() => { setPublishFlowActive(false); setPublishProgressOpen(false); }}>
                        后台执行
                      </Button>
                    )}
                  </div>
                  <div className="mb-4 space-y-2">
                    <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                      {getPublishRouteBadge(publishDialogApp)}
                    </div>
                    <p className="text-sm text-slate-600">
                      {publishProgress?.status === 'failed'
                        ? `${publishDialogApp.name} 的 Candidate 发布失败了。下面显示必要的失败信息。`
                        : publishProgress?.status === 'completed'
                          ? `${publishDialogApp.name} 已完成 Candidate → Live 发布。现在可以立即试用并确认结果。`
                          : `${publishDialogApp.name} 正在进入 Candidate 发布流程。这里展示 V10 发布进度。`}
                    </p>
                  </div>
                  {!publishProgress && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                      发布任务已启动，正在等待状态同步…
                    </div>
                  )}
                  <div className="space-y-3">
                    {!!(publishProgress?.steps || []).length && (
                      <>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-amber-400 via-orange-500 to-emerald-500 transition-all duration-500" style={{ width: `${getPublishProgressPercent(publishProgress)}%` }} />
                        </div>
                        <div className="space-y-2">
                      {(publishProgress?.steps || []).map((step, idx) => {
                        const visual = getPublishStepVisual(step);
                        const emphasized = idx < 2;
                        return (
                          <div key={step.id} className={cn('flex items-start gap-3 border bg-white transition-colors', emphasized ? 'rounded-2xl px-4 py-4 min-h-[108px]' : 'rounded-xl px-3 py-2.5', 'border-slate-200')}>
                            <div className={cn('w-6 h-6 rounded-full border text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5', visual.className)}>
                              {visual.icon}
                            </div>
                            <div className="min-w-0">
                              <div className={cn(emphasized ? 'text-base font-semibold text-slate-900' : 'text-sm font-medium text-slate-800')}>{step.label}</div>
                              <div className="text-xs text-slate-500">{step.detail || (step.id === 'candidate_prepare' ? '正在准备 Candidate 所需产物（frontend / backend / sql）' : step.id === 'candidate_runtime' ? '正在启动并检查 Candidate 环境（数据库 / 运行环境 / 可访问性）' : step.id === 'verify' ? '正在执行发布验证，确认 Candidate 可进入 Live' : step.id === 'completion' ? '正在完成发布并更新公开状态' : (step.status === 'pending' ? '待機中' : step.status === 'running' ? '処理中…' : step.status === 'completed' ? '完了' : '失敗'))}</div>
                            </div>
                          </div>
                        );
                      })}
                        </div>
                      </>
                    )}
                    {publishProgress?.error_message && (
                      <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {publishProgress.error_message}
                      </div>
                    )}
                    {publishDialogApp.release_state === 'failed' && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900 space-y-2">
                        <div>当前是 Failed 状态。按新的 V10 / prompts 逻辑，发布流程不会在 release 阶段偷偷修复；请先点击“修复发布问题”，修完后再重新发布。</div>
                        {!!getFailedReleaseSummary(publishDialogApp).length && (
                          <ul className="m-0 pl-5 space-y-1">
                            {getFailedReleaseSummary(publishDialogApp).map(line => <li key={line}>{line}</li>)}
                          </ul>
                        )}
                      </div>
                    )}
                    {repairReadyToRepublish && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-800 space-y-2">
                        <div className="font-semibold">修复已完成，当前可以重新发布</div>
                        <div>现在请点击上方绿色按钮，重新进入 Candidate 发布流程。</div>
                        {!!repairReportSummary.length && (
                          <ul className="m-0 pl-5 space-y-1 text-emerald-900/90">
                            {repairReportSummary.map(line => <li key={line}>{line}</li>)}
                          </ul>
                        )}
                      </div>
                    )}
                    {publishProgress?.status === 'completed' && (
                      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-blue-50 px-4 py-4 space-y-4">
                        <div className="flex items-start gap-3">
                          <div className="w-11 h-11 rounded-2xl bg-emerald-100 text-2xl flex items-center justify-center shrink-0">🎉</div>
                          <div>
                            <div className="text-base font-semibold text-slate-900">{repairReadyToRepublish ? '发布问题已修复' : '恭喜发布完成'}</div>
                            <div className="text-sm text-slate-600 mt-1">{repairReadyToRepublish ? '当前 verifier / repair 已通过。下一步请重新发布，让它重新进入 Candidate → Live。' : '你的 App 已经发布成功。你可以立即试用、分享给好友，或者前往我的 App 查看。'}</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {getPublicUrl(publishDialogApp) && (
                            <Button type="button" className="gap-2 bg-emerald-600 hover:bg-emerald-700" onClick={() => {
                              const u = getPublicUrl(publishDialogApp);
                              setPublishFlowActive(false); setPublishProgressOpen(false); setPublishingAppId(null); setPublishingAppSnapshot(null);
                              setActiveTab('myapps');
                              navigate('/my-apps');
                              if (u) window.open(u, '_blank');
                            }}>
                              <ArrowUp className="w-4 h-4 rotate-45" /> 立即试用
                            </Button>
                          )}
                          {getPublicUrl(publishDialogApp) && (
                            <Button type="button" variant="outline" className="gap-2" onClick={async () => {
                              const u = getPublicUrl(publishDialogApp);
                              if (!u) return;
                              try {
                                if (navigator.share) {
                                  await navigator.share({ title: publishDialogApp.name, text: `我刚发布了 ${publishDialogApp.name}，快试试。`, url: u });
                                } else {
                                  await navigator.clipboard.writeText(u);
                                  setFeedbackModal({ tone: 'success', title: '分享链接已复制', description: '链接已经复制到剪贴板，现在可以发给好友。', confirmText: '知道了', hideCancel: true });
                                }
                              } catch {
                                try {
                                  await navigator.clipboard.writeText(u);
                                  setFeedbackModal({ tone: 'success', title: '分享链接已复制', description: '链接已经复制到剪贴板，现在可以发给好友。', confirmText: '知道了', hideCancel: true });
                                } catch {
                                  setFeedbackModal({ tone: 'info', title: '请手动复制链接', description: u, confirmText: '知道了', hideCancel: true });
                                }
                              }
                            }}>
                              <Share2 className="w-4 h-4" /> 分享给好友
                            </Button>
                          )}
                          <Button type="button" variant="outline" className="gap-2" onClick={() => {
                            setPublishFlowActive(false); setPublishProgressOpen(false); setPublishingAppId(null); setPublishingAppSnapshot(null); setActiveTab('myapps'); navigate('/my-apps');
                          }}>
                            <ChevronRight className="w-4 h-4" /> 前往我的 App
                          </Button>
                        </div>
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      {publishProgress?.status === 'failed' || publishProgress?.status === 'completed' ? (
                        <Button type="button" variant="outline" onClick={() => { setPublishFlowActive(false); setPublishProgressOpen(false); setPublishingAppId(null); setPublishingAppSnapshot(null); }}>关闭</Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <LoginGateModal
        open={loginGateOpen}
        actionLabel={loginGateAction}
        onClose={() => setLoginGateOpen(false)}
        onConfirm={() => navigate(buildLoginUrl())}
        onLogin={() => navigate(buildLoginUrl('login'))}
      />

      <PublishDialog
        open={publishOpen}
        mode={publishDialogMode}
        routeSummary={getPublishRouteSummary(currentApp)}
        actionLabel={getPublishActionLabel(currentApp)}
        validationSummary={getPublishValidation(currentApp).summary}
        validationItems={getPublishValidation(currentApp).items}
        onClose={() => setPublishOpen(false)}
        onConfirm={handlePublishConfirm}
        initialName={currentApp?.name || ''}
        initialDescription={currentApp?.description || ''}
        initialIcon={currentApp?.icon || '✨'}
        initialColor={currentApp?.color || 'indigo'}
      />
      <AppFeedbackDialog
        open={!!feedbackModal}
        tone={feedbackModal?.tone || 'info'}
        title={feedbackModal?.title || ''}
        description={feedbackModal?.description || ''}
        confirmText={feedbackModal?.confirmText || '确定'}
        cancelText={feedbackModal?.cancelText || '取消'}
        hideCancel={feedbackModal?.hideCancel}
        onCancel={() => setFeedbackModal(null)}
        onConfirm={async () => {
          const handler = feedbackModal?.onConfirm;
          if (!handler) {
            setFeedbackModal(null);
            return;
          }
          await handler();
        }}
      />
    </div>
  );
}
