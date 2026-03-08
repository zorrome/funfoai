# Vibe Coding — UI Design Prompt
> 适用平台：Figma Make / v0.dev / Lovable / Bolt / Base44 / Cursor 等

important! the app is all in japanese

## 🎯 一句话说明（第一句 Prompt）

```
Design an AI app generation platform called "Vibe Coding" — similar to Bolt.new or Base44. It has 3 main screens: a Chat Workspace, an App Store, and My Apps. Tab navigation at the top switches between screens.
```

---

## SCREEN 1 — Chat Workspace（创作工作台）

```
Create the main workspace screen of an AI app builder called "Vibe Coding".

LAYOUT: 3-column layout (left sidebar + center chat + right preview panel)

TOP NAV BAR:
- Logo: small square icon with letter "V" + text "Vibe Coding"
- Nav tabs: "✦ 创作工作台" (active), "⊞ App 商店", "◉ 我的应用"
- Right side: "文档" ghost button + "升级 Pro ↑" primary button

LEFT SIDEBAR (220px wide):
- Header: "版本历史" label + "+" icon button
- Version list with 4 items, each showing:
  - Version name (e.g. "餐厅营收报告")
  - Timestamp ("刚刚", "10 分钟前", "18 分钟前", "25 分钟前")
  - First item has a "LATEST" badge and is visually highlighted

CENTER CHAT PANEL (flex 1):
- Chat header:
  - App icon (small square with emoji 📊) + app name "餐厅每日营收报告"
  - Status indicator: pulsing dot + "运行中 · preview.vibeapp.io/rev-report"
  - Right-side buttons: share icon, deploy icon, "发布到商店 ↑" primary button
- Chat messages (scrollable):
  - AI bubble (left-aligned): "你好！我是 Vibe Coding AI。请告诉我你想创建什么样的应用，我会帮你直接生成 👋"
  - User bubble (right-aligned): "帮我做一个餐厅每日营收报告，需要支持多门店切换，可以按日期范围筛选，显示今日流水和环比变化"
  - AI message containing:
    - Text bubble: "明白了！我来生成一个支持多门店的餐厅营收报告..."
    - Generation status card: loading spinner + step checklist (✓ 分析需求结构, ✓ 生成页面组件, ⟳ 渲染图表模块...)
    - Code preview card: small card showing JSX code snippet with syntax highlighting
  - User bubble: "把图表改成柱状图，同时加上一个各菜品销售额排行榜"
  - AI bubble: "好的！已将折线图改为柱状图，并在页面下方增加了「菜品销售排行榜」模块..."
- Bottom input area:
  - Input box: paperclip attach button (left) + multiline textarea + send button (right)
  - Hint text: "⌘↩ 发送 · 可上传设计图作为参考"

RIGHT PREVIEW PANEL (480px wide):
- Top bar:
  - Device switcher toggle: 📱 / 💻 / 🖥 (laptop active)
  - URL bar: "🔒 preview.vibeapp.io/rev-report"
  - External link icon button
- Preview area: browser window mockup containing a fake dashboard app:
  - Header: "📊 营收报告" title + "实时" badge + "今日 · 全部门店" subtitle
  - 2×2 stats grid:
    - 今日营收: ¥84,320 / ↑12.4% 环比昨日
    - 订单数: 1,247 / ↑8.1%
    - 均单价: ¥67.6 / ↑3.9%
    - 本月累计: ¥1.8M / 达成率 74%
  - Bar chart: "过去7日营收趋势" — 7 bars, last bar (today) is taller and highlighted
  - Table: "菜品排行" — 3 rows: 招牌拉面 ¥12,450 ↑8%, 黑豚叉烧饭 ¥9,820 ↑5%, 味噌汤套餐 ¥7,310 ↓2%
```

---

## SCREEN 2 — App Store（App 商店）

```
Design the App Store screen of "Vibe Coding" AI app builder platform.

HERO SECTION (centered, full width):
- Small pill label: "✦ App 商店"
- Large heading: "发现现成可用的业务应用"
- Subtitle: "由官方精选与社区创作，即装即用，也可基于任意 App 二次改造"
- Search bar: text input placeholder "搜索应用，例如「排班表」「库存管理」..." + "搜索" button

FILTER CHIPS ROW:
- Label: "分类："
- Chips: 全部 (active), 🍜 餐饮管理, 📊 数据分析, 👥 人事行政, 💰 财务工具, 📦 库存物流, 🎯 客户运营

FEATURED HORIZONTAL SCROLL ROW:
- Section title: "官方精选 ⭐ FEATURED"
- 4 cards in a horizontally scrollable row (320px wide each):
  1. 多门店营收看板 📊 — "实时汇总各门店营收、订单量与客单价，支持日期对比与趋势分析" — tag: 官方精选 · 餐饮管理
  2. 智能排班系统 📅 — "AI 辅助排班，自动考虑员工偏好与节假日，一键生成班表" — tag: 官方精选 · 人事行政
  3. 食材库存追踪 📦 — "设定安全库存阈值，低库存自动预警，追踪采购与消耗记录" — tag: 官方精选 · 库存管理
  4. 成本利润计算器 🧾 — "逐菜品计算食材成本、毛利率，帮助优化菜单定价策略" — tag: 官方精选 · 财务工具

APP GRID:
- Section title: "全部应用 (128 个)"
- Responsive grid (3-4 columns), 6 cards:
  Each card:
  - Square app icon with emoji
  - App name (bold) + publisher badge ("✦ 官方" or "社区 · @username")
  - 2-line description
  - Footer: usage count + star rating
  - On hover: "改造" ghost button + "使用" primary button appear

  Cards:
  1. 营收日报 📊 — 官方 — "每日自动生成营收摘要，对比昨日与上周同期数据" — ▲2.4k ★4.9
  2. 员工排班表 👥 — 官方 — "可视化周排班，支持换班申请，自动计算工时" — ▲1.8k ★4.8
  3. 菜单管理工具 📋 — 社区 @ramen_owner — "在线编辑菜单价格与描述，支持图片上传，可导出 PDF" — ▲892 ★4.6
  4. 客评汇总看板 💬 — 官方 — "聚合 Google、食べログ 评价，AI 提炼关键词" — ▲1.1k ★4.7
  5. 食材库存管理 📦 — 社区 @izakaya_pro — "扫码入库出库，低库存自动推送 LINE 通知" — ▲643 ★4.5
  6. 会员积分系统 🎯 — 官方 — "积分发放与兑换管理，会员等级设置，消费记录查询" — ▲2.0k ★4.9
```

---

## SCREEN 3 — My Apps（我的应用）

```
Design the "My Apps" management screen of "Vibe Coding" platform.

HEADER ROW:
- Left: title "我的应用"
- Center: tab switcher: "全部 (8)" (active), "已发布 (3)", "草稿 (5)", "已收藏"
- Right: "＋ 新建应用" primary button

APP LIST (vertical, full width):
4 list items, each row showing:
- Left: square icon with emoji
- Center: app name (bold) + meta (version · last updated · status)
  - Status: "● 已发布" or "● 草稿"
- Right: action buttons

Items:
1. 📊 餐厅每日营收报告 — v4 · 刚刚更新 · ● 已发布 — [编辑] [分享] [查看]
2. 📅 员工排班管理（含假期申请） — v2 · 2天前更新 · ● 草稿 — [编辑] [继续]
3. 🎯 外卖平台数据对比看板 — v1 · 5天前更新 · ● 已发布 — [编辑] [分享] [查看]
4. 🧾 菜品成本核算工具 — v3 · 一周前更新 · ● 已发布 — [编辑] [分享] [查看]
```

---

## 💡 Platform-Specific Tips

**Figma Make：** 逐屏生成，每次加 "Keep the same layout and component style as the previous screen"

**v0.dev：** 每个 Screen 单独发，前缀加 `Create a React component using Tailwind CSS.`

**Lovable / Bolt：** 可一次粘贴全部，补充 `Make it a single-page app with tab navigation between the 3 screens.`

**Cursor / Windsurf：** 当 spec 文档用，按需引用各 Screen 章节

---

*Prompt 版本 v1.1 · 由 Funfo 产品团队整理*
