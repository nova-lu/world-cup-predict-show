# Phase 14 — AI 智能分析引擎与深度比赛报告

> 新功能: 整合所有已有预测数据源，通过大模型 (DeepSeek) 进行综合分析，
> 生成包含深度推理和上下文信息的 AI 比赛报告页面。

---

## 1. 目标

在现有双引擎预测 + 多源赔率融合的基础上，增加一层 **AI 智能分析**:

- 将 Elo、ML、Ensemble、多公司赔率、Polymarket、竞彩网、近期状态等所有数据聚合
- 发送到后端配置的大模型 API (默认 DeepSeek) 进行综合分析
- 生成包含深度推理的 AI 比赛报告，并展示在独立页面中
- 从比赛详情页通过悬浮按钮一键进入


## 1.5 任务依赖与子阶段结构

Phase 14 的 12 项交付物按依赖链拆分为 3 个子阶段，每个子阶段可独立验证交付:

```
子阶段 14.1: AI 后端流水线 (无外部依赖)
  ├─ server/ai/config.js
  ├─ server/ai/data-aggregator.js
  └─ .env.template 修改
  → 验证: 控制台调用 aggregateMatchData() 输出完整聚合结构

子阶段 14.2: Prompt 工程 + LLM 集成 (依赖 14.1)
  ├─ server/ai/prompt-builder.js
  ├─ server/ai/llm-client.js
  ├─ server/routes/ai.js
  └─ server/index.js (路由注册)
  → 验证: curl POST /api/ai/analyze/:t1/:t2 返回结构化 JSON

子阶段 14.3: AI 分析页面 + 入口集成 (依赖 14.2)
  ├─ views/pages/ai-analysis.ejs
  ├─ views/pages/match.ejs (FAB 按钮)
  ├─ public/css/app.css (AI 页面样式)
  ├─ public/js/ai-analysis.js
  └─ server/index.js (页面路由)
  → 验证: 打开 /ai-analysis/:t1/:t2 页面 6 屏内容正常渲染
```

**依赖关系**: 14.1 → 14.2 → 14.3 (单向)

**补充文档**: 见 PHASE14-SUPPLEMENT.md (频率控制/Token 预算/JSON 解析鲁棒性/缓存失效/加载状态精化/边界情况/安全事项/Prompt 动态生成)

---

## 2. 整体架构

```
用户点击 match.ejs 悬浮按钮
  │
  ▼
GET /ai-analysis/:t1/:t2   ← 新页面路由
  │
  ▼
server/routes/ai.js        ← 新 API 路由
  │
  ├─ 1. 聚合所有数据源
  │   ├─ predictionService (Elo)
  │   ├─ mlPredictor (ML)
  │   ├─ ensemblePrediction (集成)
  │   ├─ oddsApi (多公司赔率 + consensus)
  │   ├─ polymarket (预测市场)
  │   ├─ china_sports_lottery (竞彩网)
  │   ├─ dataService (近期状态/排名)
  │   └─ knockoutEngine (加时/点球)
  │
  ├─ 2. 构造 Prompt → 调用 AI_API
  │
  ├─ 3. 解析结构化响应
  │
  └─ 4. 缓存结果 → 返回 JSON

views/pages/ai-analysis.ejs  ← 新页面模板
  ├─ AI 预测摘要 (Hero)
  ├─ 数据源参考 (折叠)
  ├─ AI 深度分析
  ├─ 赛程与实时数据
  ├─ 核心历史与表现
  ├─ 环境与外部变量
  └─ 球队与球员状态
```

---

## 3. 任务拆解

### 3.1 环境变量与配置

文件: `.env.template` (修改), `server/config.js` 或新文件 `server/ai/config.js`

新增环境变量:

| 变量 | 默认值 | 说明 |
|------|--------|------|
| AI_API_KEY | (无, 必填) | DeepSeek (或其他兼容 OpenAI API 格式) 的 API Key |
| AI_MODEL | deepseek-v4-flash | 模型名称 |
| AI_API_BASE | https://api.deepseek.com | API 基础地址 (可切换为其他兼容服务) |
| AI_MAX_TOKENS | 4096 | 最大输出 Token 数 |
| AI_TEMPERATURE | 0.3 | 生成温度 (低 = 更确定性) |
| AI_CACHE_TTL | 3600 | 分析结果缓存时间 (秒) |
| AI_TIMEOUT | 30000 | API 调用超时 (毫秒) |

配置文件: `server/ai/config.js`

```js
export default {
  apiKey: process.env.AI_API_KEY || "",
  model: process.env.AI_MODEL || "deepseek-v4-flash",
  apiBase: process.env.AI_API_BASE || "https://api.deepseek.com",
  maxTokens: parseInt(process.env.AI_MAX_TOKENS) || 4096,
  temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.3,
  cacheTtl: parseInt(process.env.AI_CACHE_TTL) || 3600,
  timeout: parseInt(process.env.AI_TIMEOUT) || 30000,
  enabled: () => !!process.env.AI_API_KEY,
};
```

### 3.2 数据聚合层

文件: `server/ai/data-aggregator.js` (新文件)

核心函数: `aggregateMatchData(t1, t2)`

这个函数负责收集所有与比赛相关的数据，输出统一的供 Prompt 使用的结构化对象。

**数据收集清单:**

```
aggregateMatchData(t1, t2) → {
  // 1. 比赛基本信息
  matchInfo: {
    homeTeam: { slug, name, flagPath },
    awayTeam: { slug, name, flagPath },
    stage, group, date, status
  },

  // 2. ELO 模型数据
  eloPrediction: {
    homeRating, awayRating,
    homeBonus,
    probabilities: { homeWin, draw, awayWin },
    expectedGoals: { home, away }
  },

  // 3. ML 模型数据 (如可用)
  mlPrediction: {
    probabilities,
    expectedGoals,
    topScores: [{ home, away, probability }],
    overUnder: { over2_5, under2_5, over3_5, expectedTotal },
    btts: { yes, no },
    risk: { level, score }
  },

  // 4. 集成模型数据 (如可用)
  ensemblePrediction: {
    probabilities,
    ensembleWeights: { elo, ml },
    dynamicAdjusted: bool
  },

  // 5. 市场赔率数据
  oddsData: {
    consensus: { home, draw, away },
    bookmakerDetails: [{ name, odds }],
    nBookmakers: number,
    divergence: { maxMinSpread, stdDev },
    available: bool
  },

  // 6. Polymarket 数据
  polymarket: {
    probabilities: { homeWin, draw, awayWin },
    volume: number,
    available: bool
  },

  // 7. 竞彩网数据 (如可用)
  chinaSportsLottery: {
    probabilities, odds, returnRate, available: bool
  },

  // 8. 近期状态
  recentForm: {
    home: { last5: [{ opponent, result, gf, ga }], form, daysSince },
    away: { last5: [], form, daysSince }
  },

  // 9. 淘汰赛加时/点球预测 (如适用)
  knockoutPrediction: {
    regWin, etWin, pkWin, available: bool
  },

  // 10. 比赛结果 (已完赛时)
  result: { homeScore, awayScore, status } | null
}
```

数据源调用方式:
- `predictionService.predictMatch()` → Elo 数据
- `mlPredictor.predictMatch()` → ML 数据 (try/catch, 可能不可用)
- `ensemblePrediction()` → 集成数据 (基于 Elo + ML)
- `fetchOddsForMatch()` → 赔率数据
- `fetchWorldCupEvents()` + `getPrematch1X2()` → Polymarket
- `china_sports_lottery.getMatch()` + `normalizeToUnified()` → 竞彩
- `buildRecentContext()` (已存在于 matches.js) → 近期状态
- `knockoutMatchProb()` → 加时/点球 (仅淘汰赛)

**错误处理策略**: 每个数据源单独 try/catch。某个源不可用时，在聚合数据中标记 `available: false`，不影响其他源。

### 3.3 Prompt 构造与 LLM 调用

文件: `server/ai/prompt-builder.js` (新文件)

核心函数: `buildPrompt(aggregatedData)` → 返回 prompt 字符串

**Prompt 模板设计:**

```
# 角色设定
你是顶级的足球比赛数据分析师。请基于以下所有数据源，对这场比赛进行综合分析。
输出严格遵循 JSON 格式，不包含任何其他文字。

# 比赛信息
- 赛事: 2026 FIFA World Cup
- 阶段: {stage} ({stageLabel})
- 日期: {date}
- 球队: {homeName} (主) vs {awayName} (客)

# 数据源 1 - ELO 评分系统
{homeName} ELO: {eloHome}, {awayName} ELO: {eloAway}
Elo 预测概率: 主胜 {eloPHome}%, 平局 {eloPDraw}%, 客胜 {eloPAway}%
Elo 预期进球: {homeName} {xgHome}, {awayName} {xgAway}

# 数据源 2 - 机器学习模型 (XGBoost + RF)
{mlSection}

# 数据源 3 - 集成学习 (Elo + ML 动态加权)
{ensembleSection}

# 数据源 4 - 市场赔率 (多公司共识)
{oddsSection}

# 数据源 5 - Polymarket 预测市场
{polymarketSection}

# 数据源 6 - 竞彩网赔率
{chinaLotterySection}

# 数据源 7 - 近期状态
{formSection}

# 数据源 8 - 淘汰赛加时/点球分析
{knockoutSection}

# 请严格按以下 JSON Schema 输出分析结果:
{
  "probabilities": { "homeWin": 0.XX, "draw": 0.XX, "awayWin": 0.XX },
  "recommendedPick": "home|draw|away",
  "confidence": 0.XX,
  "bestOddsSource": "Bet365|William Hill|...",
  "scorePrediction": { "home": X, "away": Y },
  "overUnder": { "over2_5": 0.XX, "under2_5": 0.XX, "recommendation": "over|under" },
  "expectedGoals": { "home": X.XX, "away": X.XX, "total": X.XX },
  "btts": { "yes": 0.XX, "no": 0.XX },
  "extraTime": { "probability": 0.XX },
  "penaltyShootout": { "probability": 0.XX },
  "reasoning": "3-5句中文分析，说明关键影响因素...",
  "keyFactors": ["因子1", "因子2", "因子3"],
  "riskFactors": ["风险1", "风险2"]
}
```

**LLM 调用函数:** `server/ai/llm-client.js`

```js
export async function callLLM(prompt) {
  const config = await getConfig();
  if (!config.enabled()) throw new Error("AI_API_KEY 未配置");

  const response = await fetch(`${config.apiBase}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: "你是顶级的足球比赛数据分析师。始终以 JSON 格式输出分析结果。" },
        { role: "user", content: prompt },
      ],
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      response_format: { type: "json_object" }, // DeepSeek 支持 JSON mode
    }),
    signal: AbortSignal.timeout(config.timeout),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM API 错误 (${response.status}): ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM 返回空内容");

  return JSON.parse(content);
}
```

### 3.4 API 路由

文件: `server/routes/ai.js` (新文件)

**端点 1: POST /api/ai/analyze/:t1/:t2**

触发 AI 分析并返回结果。

```
请求: POST /api/ai/analyze/argentina/france
      Body: { force: true } // 可选，强制刷新缓存

响应:
{
  success: true,
  match: { t1: "argentina", t2: "france" },
  analysis: {
    // LLM 返回的完整 JSON
    probabilities: { homeWin: 0.52, draw: 0.26, awayWin: 0.22 },
    recommendedPick: "home",
    confidence: 0.74,
    bestOddsSource: "Bet365",
    scorePrediction: { home: 2, away: 1 },
    overUnder: { over2_5: 0.58, under2_5: 0.42, recommendation: "over" },
    expectedGoals: { home: 1.85, away: 1.20, total: 3.05 },
    btts: { yes: 0.62, no: 0.38 },
    extraTime: { probability: 0.12 },
    penaltyShootout: { probability: 0.05 },
    reasoning: "...",
    keyFactors: ["..."],
    riskFactors: ["..."]
  },
  dataSources: {
    elo: true,
    ml: true,
    ensemble: true,
    oddsApi: true,
    polymarket: true,
    chinaLottery: false,
    form: true,
    knockout: true
  },
  generatedAt: "2026-06-30T12:00:00Z",
  cached: false,
  _cache: { hit: false }
}
```

错误响应:
```
{
  success: false,
  error: "AI_API_KEY 未配置，请在 .env 中设置 AI_API_KEY",
  actionable: true // 是否可修复 (如: 配置问题)
}
```

**端点 2: GET /api/ai/status**

检查 AI 功能是否可用。

```
{
  enabled: true,
  model: "deepseek-v4-flash",
  apiBase: "https://api.deepseek.com",
  cacheTtl: 3600,
  // 可选: 测试连通性
  reachable: true
}
```

**缓存逻辑:**

```js
const cacheKey = `ai:analysis:${t1}:${t2}`;
const cached = get(cacheKey, { force });
if (cached.hit) return { ...cached.value, cached: true };

// ... 执行分析 ...

set(cacheKey, result, { ttlMs: config.cacheTtl });
```

### 3.5 AI 分析页面

文件: `views/pages/ai-analysis.ejs` (新文件)

**页面布局设计 (从上到下):**

#### 第1屏: Hero 区 — AI 预测摘要

```
┌──────────────────────────────────────────────────┐
│  ← 返回比赛详情                                  │
│                                                  │
│       阿根廷 🇦🇷   vs   🇫🇷 法国                  │
│             2026世界杯 · 淘汰赛8强                │
│                                                  │
│  ┌──────┐  ┌──────┐  ┌──────┐                    │
│  │ 52.3%│  │ 25.8%│  │ 21.9%│  ← AI 概率         │
│  │ 主胜  │  │ 平局  │  │ 客胜  │                    │
│  └──────┘  └──────┘  └──────┘                    │
│                                                  │
│  AI 推荐: 主胜 (阿根廷)  置信度: 74%             │
│  最佳赔率: Bet365 1.80  🏆 推荐投注              │
│  预测比分: 2-1                                   │
│  大小球: O2.5 (58%)  预期总进球: 3.05            │
│  加时概率: 12%  点球概率: 5%                     │
│                                                  │
│  ⏱ 更新于 2026-06-30 12:00  源数据: 5/6 可用    │
└──────────────────────────────────────────────────┘
```

实现方式:
- 服务端 EJS 预渲染核心数据 (AI 已经过缓存)
- 若无缓存 → 客户端调用 POST /api/ai/analyze 获取结果后渲染
- 显示的"置信度"是 LLM 自我评估值

#### 第2屏: AI 深度分析

```
┌──────────────────────────────────────────────────┐
│  AI 分析推理                                      │
│                                                  │
│  "阿根廷在主场优势和历史交锋记录上占据明显上风，   │
│   近5场3胜1平1负的状态稳定。法国虽然整体实力      │
│   强劲(ELO 2009)，但近期防守端出现松动。市场赔率   │
│   共识和 Polymarket 均倾向于主队不败方向，         │
│   ML 模型也给出了主胜 48% 的概率支持。综合判断     │
│   阿根廷获胜概率最高，推荐主胜方向。"               │
│                                                  │
│  关键因素:                                        │
│  ✅ 主场优势 (墨西哥/美国/加拿大主办)              │
│  ✅ 近期状态: 阿根廷近5场3胜1平1负                │
│  ⚠️ 法国 ELO 评分更高 (2009 vs 1976)              │
│  ✅ 市场赔率共识支持主胜方向                       │
│                                                  │
│  风险因素:                                        │
│  ⚠️ 淘汰赛经验: 法国上届冠军                      │
│  ⚠️ 阿根廷防守中场伤疑                            │
└──────────────────────────────────────────────────┘
```

#### 第3屏: 赛程与实时数据

```
┌──────────────────────────────────────────────────┐
│  赛程与实时数据                                    │
│                                                  │
│  阶段: 淘汰赛8强    开球: 2026-07-04 22:00       │
│  场地: 大都会体育场, 纽约 (中立场地)               │
│  状态: 未开赛                                      │
│  天气: 25°C, 晴 (历史同期数据)                    │
│                                                  │
│  (数据来源: football-data.org API / 本地种子)     │
└──────────────────────────────────────────────────┘
```

#### 第4屏: 核心历史与表现数据

```
┌──────────────────────────────────────────────────┐
│  历史交锋记录                                      │
│  近5次交手: 阿根廷 2胜2平1负                      │
│  最近一次: 2022世界杯决赛 阿根廷 3-3(点球4-2) 法国 │
│                                                  │
│  近期表现 (近5场)                                  │
│  阿根廷: 胜 胜 平 胜 负  进8球失4球               │
│  法国:   胜 胜 胜 负 胜  进10球失3球              │
│                                                  │
│  小组赛表现                                        │
│  阿根廷: D组 第1 (9分, +6净胜球)                  │
│  法国:   B组 第1 (10分, +8净胜球)                 │
│                                                  │
│  ELO 评分: 阿根廷 1976 vs 法国 2009               │
└──────────────────────────────────────────────────┘
```

#### 第5屏: 数据源参考 (折叠/可展开)

```
┌──────────────────────────────────────────────────┐
│  📊 AI 使用的数据源 (点击展开)                     │
│                                                  │
│  ▼ 源1: Elo 模型                                  │
│  阿根廷评分: 1976  法国评分: 2009                  │
│  预期进球: 阿根廷 1.35, 法国 1.65                  │
│  预测概率: 主胜 45% 平局 27% 客胜 28%             │
│                                                  │
│  ▼ 源2: ML 模型 v1                                │
│  预测概率: 主胜 48% 平局 25% 客胜 27%             │
│  Top3比分: 1-1(12%), 1-0(10%), 0-1(8%)           │
│  大小球: O2.5 52%  预期总进球 2.8                 │
│  BTTS: 是 55%  风险: 中                           │
│                                                  │
│  ▼ 源3: 市场赔率共识                                │
│  共识概率: 主胜 50% 平局 27% 客胜 23%             │
│  可用公司: Bet365, William Hill (2家)              │
│  市场分歧: 主胜差 3% (低分歧)                     │
│                                                  │
│  ▼ 源4: Polymarket                                │
│  价格: 主胜 49% 平局 28% 客胜 23%                 │
│                                                  │
│  ▼ 源5: 竞彩网 (不可用)                            │
│                                                  │
│  ▼ 源6: 近期状态                                   │
│  阿根廷近5场: 3胜1平1负  场均进球 1.6             │
│  法国近5场: 4胜0平1负  场均进球 2.0               │
│                                                  │
│  ▼ 源7: 淘汰赛加时/点球分解                        │
│  常规时间: 72%  加时: 18%  点球: 10%              │
└──────────────────────────────────────────────────┘
```

#### 第6屏: 模型对比

```
┌──────────────────────────────────────────────────┐
│  各信源概率对比                                    │
│                                                  │
│  信源          主胜    平局    客胜                │
│  Elo 模型      45.2%   27.1%   27.7%              │
│  ML 模型 v1    48.3%   24.5%   27.2%              │
│  集成模型      47.2%   25.3%   27.5%              │
│  市场共识      50.1%   26.8%   23.1%              │
│  Polymarket    48.5%   28.0%   23.5%              │
│  ──────────────────────────────────               │
│  🤖 AI 分析    52.3%   25.8%   21.9%              │
│                                                  │
│  (AI 综合所有数据源后得出的独立分析)               │
└──────────────────────────────────────────────────┘
```

#### 交互行为:

- 数据源参考区: 默认全部折叠，点击展开每个源
- 模型对比表: 始终可见
- AI 分析页面顶部有"刷新分析"按钮 → 调用 POST 接口重新生成
- 页面底部有"返回比赛详情"链接
- 移动端: 各屏之间可滚动，首屏 Hero 占满视口

### 3.6 match.ejs 悬浮入口按钮

文件: `views/pages/match.ejs` (修改)

在 match.ejs 中增加一个悬浮动作按钮 (FAB):

```html
<!-- AI 分析悬浮按钮 -->
<a href="/ai-analysis/<%= team1Slug %>/<%= team2Slug %>"
   class="ai-fab"
   title="AI 智能分析"
   id="ai-fab">
  <span class="ai-fab-icon">🤖</span>
  <span class="ai-fab-label">AI 分析</span>
</a>
```

CSS 样式 (app.css):

```css
.ai-fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  border: none;
  border-radius: 28px;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
  cursor: pointer;
  text-decoration: none;
  transition: transform 0.2s, box-shadow 0.2s;
}

.ai-fab:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.5);
}

.ai-fab-icon {
  font-size: 1.3rem;
}

.ai-fab-label {
  font-size: 0.85rem;
  font-weight: 600;
}

@media (max-width: 480px) {
  .ai-fab {
    bottom: 16px;
    right: 16px;
    padding: 10px 16px;
  }
  .ai-fab-label {
    display: none; /* 移动端只显示图标 */
  }
}
```

仅在 `/match/:t1/:t2` 页面显示。条件: 当 `AI_API_KEY` 已配置时显示，否则隐藏。

```ejs
<% if (aiEnabled) { %>
  <a href="/ai-analysis/<%= team1Slug %>/<%= team2Slug %>" class="ai-fab">
    <span class="ai-fab-icon">🤖</span>
    <span class="ai-fab-label">AI 分析</span>
  </a>
<% } %>
```

### 3.7 页面路由

文件: `server/index.js` (修改)

```js
// AI 分析页面 (需先检查 AI 配置)
app.get("/ai-analysis/:t1/:t2", async (req, res) => {
  const { t1, t2 } = req.params;
  const aiConfig = await import("./ai/config.js").then(m => m.default);
  const aiEnabled = aiConfig.enabled();

  // 尝试从缓存读取已有分析结果
  let cachedAnalysis = null;
  if (aiEnabled) {
    try {
      const { get } = await import("./middleware/cache.js");
      const cached = get(`ai:analysis:${t1}:${t2}`, { force: false });
      if (cached.hit) cachedAnalysis = cached.value;
    } catch {}
  }

  res.render("pages/ai-analysis", {
    title: `AI 分析 · ${t1} vs ${t2}`,
    page: "ai-analysis",
    team1Slug: t1,
    team2Slug: t2,
    aiEnabled,
    initialAnalysis: cachedAnalysis, // 缓存预填充
  });
});
```

### 3.8 服务端注册

文件: `server/index.js` (修改)

```js
import aiRouter from "./routes/ai.js";
// ...
app.use("/api/ai", aiRouter);
```

---

## 4. 交付物清单

| # | 子阶段 | 文件 | 类型 | 说明 |
|---|--------|------|------|------|
| 1 | 14.1 | .env.template | 修改 | 增加 AI_API_KEY, AI_MODEL, AI_API_BASE 等环境变量 |
| 2 | 14.1 | server/ai/config.js | 新文件 | AI 配置读取与校验 |
| 3 | 14.1 | server/ai/data-aggregator.js | 新文件 | 所有预测数据源的聚合层 |
| 4 | 14.2 | server/ai/prompt-builder.js | 新文件 | Prompt 模板构造 |
| 5 | 14.2 | server/ai/llm-client.js | 新文件 | LLM API 调用客户端 |
| 6 | 14.2 | server/routes/ai.js | 新文件 | /api/ai/analyze + /api/ai/status 端点 |
| 7 | 14.2/14.3 | server/index.js | 修改 | 注册 /api/ai 路由 (14.2) + /ai-analysis/:t1/:t2 页面路由 (14.3) |
| 8 | 14.3 | views/pages/ai-analysis.ejs | 新文件 | AI 分析报告页面 (6屏) |
| 9 | 14.3 | views/pages/match.ejs | 修改 | 增加 AI 悬浮按钮 (FAB) |
| 10 | 14.3 | public/css/app.css | 修改 | AI 页面样式 + FAB 样式 |
| 11 | 14.3 | public/js/ai-analysis.js | 新文件 | AI 页面交互 (展开/刷新/数据源切换) |
| 12 | - | docs/PHASE14-AI-ANALYSIS.md | 当前文档 | Phase 14 总览文档 |

---

## 5. 验收标准

| 指标 | 目标值 | 验证方式 | 所属子阶段 |
|------|--------|---------|-----------|
| AI API 可配置 | 修改 .env 中的 AI_API_KEY 即可启用/禁用 | 设置/移除变量后重启验证 | 14.1 |
| 数据聚合 | 聚合所有 8 个数据源，输出完整结构 | 控制台调用 aggregateMatchData() 验证 | 14.1 |
| Prompt 构造 | 生成包含所有可用数据源的完整 prompt | 开启 debug 日志查看 prompt 内容 | 14.2 |
| LLM 调用 | 成功调用 DeepSeek API 并返回结构化 JSON | 验证返回的 probabilities 之和 ≈ 1.0 | 14.2 |
| 结果缓存 | 相同请求在 TTL 内返回缓存结果 | 连续请求两次，第二次 cached: true | 14.2 |
| API 错误处理 | LLM 不可用时返回用户友好错误 | 断开 API 后 curl 验证 | 14.2 |
| AI 页面渲染 | 6 屏内容均正确展示 | 打开 /ai-analysis/:t1/:t2 验证 | 14.3 |
| FAB 显示 | 仅当 AI_API_KEY 已配置时显示 | 设置/移除 KEY 后刷新 match 页面 | 14.3 |
| FAB 跳转 | 点击 FAB 跳转到 AI 分析页面 | 点击验证 URL 正确 | 14.3 |
| 加载状态 | 加载过程显示分阶段进度提示 | 清除缓存后打开页面观测 | 14.3 |
| 移动端适配 | 375px 视口下 FAB 缩小、页面布局正常 | Chrome DevTools 验证 | 14.3 |

---

## 6. 边界约定

- AI 分析仅使用现有数据源，不引入新的外部数据（如实时伤病 API、天气 API 等）。
  环境与外部变量部分使用静态数据标记（如"待接入"）。
- LLM 调用的解析若失败（返回非 JSON），页面显示原始 LLM 文本 + "解析失败"提示。
- AI 分析结果不替代现有引擎预测，仅作为独立参考展示。
- 首次加载 AI 页面时若无缓存，前端显示"正在生成 AI 分析，请稍候..."并轮询等待。
- AI API 调用超时设置为 30 秒，超时后返回"AI 服务超时，请稍后重试"。
- 不修改现有预测引擎 (Elo/ML/Ensemble/Odds) 的任何逻辑。

---

## 7. 涉及的数据源汇总

| 数据源 | 类型 | 状态 | 在聚合层中的角色 |
|--------|------|------|----------------|
| predictionService (Elo) | Node Module | ✅ 已有 | 核心数据源 1 |
| mlPredictor (ML) | Node Module | ✅ 已有 | 核心数据源 2 (可能不可用) |
| ensemblePrediction | Node Module | ✅ 已有 | 核心数据源 3 |
| fetchOddsForMatch | REST API | ✅ 已有 | 市场赔率源 |
| polymarket (fetchWorldCupEvents) | REST API | ✅ 已有 | 预测市场源 |
| china_sports_lottery | 本地文件 | ✅ 已有 | 竞彩网源 (可能不可用) |
| buildRecentContext | 函数 | ✅ 已有 (matches.js) | 近期状态 |
| knockoutMatchProb | Node Module | ✅ 已有 (knockoutEngine.js) | 加时/点球 (仅淘汰赛) |
| DeepSeek API | REST API (外部) | ❌ 需配置 | AI 分析引擎 |

---

## 8. 交互流程示例

### 首次使用场景:

```
用户打开 /match/argentina/france
  → 页面右下角看到 🤖 AI 分析 悬浮按钮 (紫色渐变)
  → 点击按钮
  → 跳转到 /ai-analysis/argentina/france
  → 页面显示"正在生成 AI 分析..."
  → 前端调用 POST /api/ai/analyze/argentina/france
  → 后端聚合数据 → 调用 DeepSeek → 解析 JSON → 缓存
  → 返回结果 → 页面渲染完整 6 屏内容
  → 用户可浏览 AI 推理、展开数据源、查看模型对比
```

### 已缓存场景:

```
用户再次打开同一比赛的 AI 分析
  → 服务端路由直接从缓存读取 analysis
  → 页面直接渲染，无等待
  → 页面顶部显示"AI 分析 (缓存) · 更新于 30 秒前"
  → 用户点击"刷新分析" → 调用 POST 接口强制刷新
```

### AI 不可用场景:

```
AI_API_KEY 未配置:
  → match.ejs 不显示 FAB 按钮
  → 直接访问 /ai-analysis 页面显示:
    "AI 分析功能未启用。请在 .env 中设置 AI_API_KEY"
```

---

## 9. 页面 SEO / 分享

- AI 分析页面设置 `<meta name="robots" content="noindex">` （内容由 AI 生成，不索引）
- Open Graph 标签复用 match 页面信息

---

## 10. 后续可扩展方向 (不在本 Phase 范围内)

- 支持多轮对话: 用户可以对 AI 分析结果追问（如"如果梅西不上场会怎样？"）
- 流式输出 (SSE): 长分析场景下逐步展示推理过程
- 多模型对比: 同时调用 GPT-4 / Claude / DeepSeek 并对比结果
- 伤病数据接入: 引入实时伤病 API 提升分析质量
- 天气数据接入: 比赛地实时天气影响分析



